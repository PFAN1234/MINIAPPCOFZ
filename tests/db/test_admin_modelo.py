"""Testes da migration do modelo 3D pelo site de administração (fase 3).

O admin envia o .frag para `modelos` em <obra_id>/<SIGLA>/<hash16>.frag e registra com
`admin_registrar_modelo`; os participantes continuam lendo pela tabela `modelo` e pela política
`modelos_select`. Plano: tasks/plano-admin.md ("Fase 3: modelo (IFC)").
"""
import json
import uuid

import pytest

psycopg = pytest.importorskip('psycopg', reason='psycopg não instalado')
from psycopg import errors  # noqa: E402

from conftest import sessao  # noqa: E402


@pytest.fixture(autouse=True)
def admins_limpos(dsn):
    with sessao(dsn, papel=None) as cur:
        cur.execute('delete from public.admin_app')


def sql(c, comando, params=(), papel='authenticated', usuario=None):
    with sessao(c.dsn, usuario, papel=papel) as cur:
        cur.execute(comando, params)
        return cur.fetchall() if cur.description else None


def tornar_admin(c, *usuarios):
    with sessao(c.dsn, papel=None) as cur:
        for u in usuarios:
            cur.execute('insert into public.admin_app (usuario_id) values (%s) on conflict do nothing', (u,))


def slug(c, obra):
    with sessao(c.dsn, papel=None) as cur:
        cur.execute('select slug from public.obra where id = %s', (obra,))
        return cur.fetchone()[0]


def subir(c, nome, tamanho=None):
    """Objeto no bucket `modelos` (como o Storage deixa ao fim do upload)."""
    meta = None if tamanho is None else json.dumps({'size': tamanho, 'mimetype': 'application/octet-stream'})
    with sessao(c.dsn, papel=None) as cur:
        cur.execute('insert into storage.objects (bucket_id, name, metadata) values (%s, %s, %s::jsonb) '
                    'on conflict (bucket_id, name) do update set metadata = excluded.metadata',
                    ('modelos', nome, meta))


def payload(obra, sigla='ARQ', hash_='a', bytes_=1000, **extra):
    h = (hash_ * 16)[:16]
    return {'sigla': sigla, 'revisao': 'R01', 'caminho': f'{obra}/{sigla}/{h}.frag', 'hash': h,
            'bytes': bytes_, 'origem': 'ifc', 'arquivo_nome': f'{sigla}-R01.ifc', 'ifc_bytes': 5000, **extra}


def registrar(c, usuario, obra, p):
    return sql(c, 'select public.admin_registrar_modelo(%s, %s::jsonb)', (slug(c, obra), json.dumps(p)),
               usuario=usuario)[0][0]


def listar(c, usuario, obra):
    return sql(c, 'select public.admin_listar_modelos(%s)', (slug(c, obra),), usuario=usuario)[0][0]


def modelos(c, obra):
    with sessao(c.dsn, papel=None) as cur:
        cur.execute('select sigla, revisao, caminho, bytes, hash from public.modelo where obra_id = %s order by sigla',
                    (obra,))
        return cur.fetchall()


def historico(c, obra):
    with sessao(c.dsn, papel=None) as cur:
        cur.execute('select count(*) from public.publicacao_modelo where obra_id = %s', (obra,))
        return cur.fetchone()[0]


@pytest.fixture
def admin(cenario):
    """O admin (sem_obra, "Usuário 3") não participa de nenhuma obra."""
    tornar_admin(cenario, cenario.sem_obra)
    return cenario.sem_obra


# --- Acesso ------------------------------------------------------------------------------------

RPCS = [
    ("select public.admin_registrar_modelo('x', '{}'::jsonb)", ()),
    ("select public.admin_listar_modelos('x')", ()),
    ("select public.admin_retirar_modelo('x', 'ARQ')", ()),
]


@pytest.mark.parametrize('comando,params', RPCS)
def test_nao_admin_recebe_42501(cenario, comando, params):
    tornar_admin(cenario, cenario.gestor_b)
    with pytest.raises(errors.InsufficientPrivilege) as e:
        sql(cenario, comando, params, usuario=cenario.gestor_a)
    assert e.value.sqlstate == '42501'


@pytest.mark.parametrize('comando,params', RPCS)
def test_anon_nao_executa(cenario, comando, params):
    with pytest.raises(errors.InsufficientPrivilege):
        sql(cenario, comando, params, papel='anon')


def test_sem_sessao_recebe_28000(cenario):
    with pytest.raises(psycopg.Error) as e:
        sql(cenario, "select public.admin_listar_modelos('x')")
    assert e.value.sqlstate == '28000'


def test_cliente_nao_le_publicacao_direto(cenario, admin):
    with pytest.raises(errors.InsufficientPrivilege):
        sql(cenario, 'select * from public.publicacao_modelo', usuario=admin)


def test_obra_inexistente(cenario, admin):
    with pytest.raises(psycopg.Error) as e:
        sql(cenario, "select public.admin_listar_modelos('nao-existe')", usuario=admin)
    assert e.value.sqlstate == 'P0002'


# --- Storage -----------------------------------------------------------------------------------

def inserir_objeto(c, usuario, nome):
    sql(c, "insert into storage.objects (bucket_id, name) values ('modelos', %s)", (nome,), usuario=usuario)


def test_admin_grava_le_e_atualiza(cenario, admin):
    nome = f'{cenario.obra_a}/ARQ/{"0123456789abcdef"}.frag'
    inserir_objeto(cenario, admin, nome)
    assert sql(cenario, "select name from storage.objects where bucket_id = 'modelos' and name = %s", (nome,),
               usuario=admin) == [(nome,)]
    # update (upsert do Storage) também é permitido ao admin
    sql(cenario, "update storage.objects set owner_id = 'x' where bucket_id = 'modelos' and name = %s", (nome,),
        usuario=admin)
    # sem delete: a linha continua lá
    sql(cenario, "delete from storage.objects where bucket_id = 'modelos' and name = %s", (nome,), usuario=admin)
    with sessao(cenario.dsn, papel=None) as cur:
        cur.execute("select owner_id from storage.objects where bucket_id = 'modelos' and name = %s", (nome,))
        assert cur.fetchall() == [('x',)]


@pytest.mark.parametrize('nome', [
    '{obra}/ARQ.frag',                 # caminho antigo do script (só service role)
    'sem-uuid/ARQ/{h}.frag',
    '{obra}/arq/{h}.frag',
    '{obra}/A/{h}.frag',
    '{obra}/ARQUI/{h}.frag',
    '{obra}/ARQ/{h}0.frag',
    '{obra}/ARQ/0123456789ABCDEF.frag',
    '{obra}/ARQ/{h}.ifc',
    '{obra}/ARQ/x/{h}.frag',
    '{outra}/ARQ/{h}.frag',            # obra inexistente
])
def test_admin_nao_grava_fora_do_padrao(cenario, admin, nome):
    nome = nome.format(obra=cenario.obra_a, outra=uuid.uuid4(), h='0123456789abcdef')
    with pytest.raises(errors.InsufficientPrivilege):
        inserir_objeto(cenario, admin, nome)


def test_nao_admin_nao_grava_e_participante_le(cenario, admin):
    nome = f'{cenario.obra_a}/ARQ/{"b" * 16}.frag'
    # gestor_a é gestor da obra A, mas não é admin
    with pytest.raises(errors.InsufficientPrivilege):
        inserir_objeto(cenario, cenario.gestor_a, nome)
    subir(cenario, nome, 10)
    subir(cenario, f'{cenario.obra_b}/ARQ/{"b" * 16}.frag', 10)
    consulta = "select name from storage.objects where bucket_id = 'modelos' and name like %s order by name"
    # A leitura dos participantes continua pela `modelos_select`; outra obra não aparece.
    assert sql(cenario, consulta, ('%',), usuario=cenario.equipe_a) == [(nome,)]
    assert sql(cenario, consulta, (f'{cenario.obra_a}/%',), usuario=cenario.gestor_b) == []
    # O admin lê tudo, mesmo sem participar das obras.
    assert len(sql(cenario, consulta, ('%',), usuario=admin)) >= 2
    with pytest.raises(errors.InsufficientPrivilege):
        sql(cenario, "select name from storage.objects where bucket_id = 'modelos'", papel='anon')


# --- Registrar ---------------------------------------------------------------------------------

@pytest.mark.parametrize('mudar,estado', [
    (lambda p: p.update(sigla='arq'), '22023'),
    (lambda p: p.update(sigla='ARQUI'), '22023'),
    (lambda p: p.update(sigla=None), '22023'),
    (lambda p: p.update(revisao='R 01'), '22023'),
    (lambda p: p.update(revisao=7), '22023'),
    (lambda p: p.update(hash='A' * 16), '22023'),
    (lambda p: p.update(hash='a' * 15), '22023'),
    (lambda p: p.update(bytes=0), '22023'),
    (lambda p: p.update(bytes=10.5), '22023'),
    (lambda p: p.update(bytes='1000'), '22023'),
    (lambda p: p.pop('bytes'), '22023'),
    (lambda p: p.update(origem='rvt'), '22023'),
    (lambda p: p.pop('origem'), '22023'),
    (lambda p: p.update(arquivo_nome='x' * 201), '22023'),
    (lambda p: p.update(arquivo_nome=12), '22023'),
    (lambda p: p.update(ifc_bytes=-1), '22023'),
    (lambda p: p.update(caminho=p['caminho'].replace('/ARQ/', '/EST/')), '22023'),
    (lambda p: p.update(caminho=p['caminho'].rsplit('/', 1)[0] + '.frag'), '22023'),
    (lambda p: p.update(caminho=f'{uuid.uuid4()}/ARQ/{p["hash"]}.frag'), '22023'),
    (lambda p: p.update(bytes=999), '22023'),          # tamanho diferente do Storage
    (lambda p: p.update(hash='c' * 16, caminho=p['caminho'][:-21] + 'c' * 16 + '.frag'), 'P0002'),  # ausente
])
def test_registrar_invalido(cenario, admin, mudar, estado):
    p = payload(cenario.obra_a)
    subir(cenario, p['caminho'], 1000)
    mudar(p)
    with pytest.raises(psycopg.Error) as e:
        registrar(cenario, admin, cenario.obra_a, p)
    assert e.value.sqlstate == estado
    assert modelos(cenario, cenario.obra_a) == [] and historico(cenario, cenario.obra_a) == 0


def test_registrar_sem_tamanho_no_storage(cenario, admin):
    p = payload(cenario.obra_a)
    subir(cenario, p['caminho'])  # metadata ainda vazio
    with pytest.raises(psycopg.Error) as e:
        registrar(cenario, admin, cenario.obra_a, p)
    assert e.value.sqlstate == '22023' and 'tamanho' in str(e.value)


def test_registrar_cria_e_atualiza(cenario, admin):
    obra = cenario.obra_a
    p1 = payload(obra, bytes_=1000)
    subir(cenario, p1['caminho'], 1000)
    r1 = registrar(cenario, admin, obra, p1)
    assert {k: v for k, v in r1.items() if k != 'atualizado_em'} == {
        'sigla': 'ARQ', 'revisao': 'R01', 'caminho': p1['caminho'], 'bytes': 1000, 'hash': 'a' * 16}
    assert r1['atualizado_em']
    assert modelos(cenario, obra) == [('ARQ', 'R01', p1['caminho'], 1000, 'a' * 16)]

    # Nova versão da mesma sigla: upsert (uma linha por sigla), sem revisão, .frag enviado pronto.
    p2 = payload(obra, hash_='d', bytes_=3_000_000_000, revisao=None, origem='frag', arquivo_nome=None)
    p2.pop('ifc_bytes')
    subir(cenario, p2['caminho'], 3_000_000_000)
    r2 = registrar(cenario, admin, obra, p2)
    assert r2['revisao'] is None and r2['bytes'] == 3_000_000_000 and r2['atualizado_em'] > r1['atualizado_em']
    assert modelos(cenario, obra) == [('ARQ', None, p2['caminho'], 3_000_000_000, 'd' * 16)]
    assert historico(cenario, obra) == 2

    lista = listar(cenario, admin, obra)
    assert [h['hash'] for h in lista['historico']] == ['d' * 16, 'a' * 16]
    assert lista['historico'][0]['publicado_por_nome'] == 'Usuário 3'
    assert lista['historico'][0]['origem'] == 'frag' and lista['historico'][0]['arquivo_nome'] is None
    assert lista['historico'][0]['ifc_bytes'] is None
    assert lista['historico'][1]['origem'] == 'ifc' and lista['historico'][1]['arquivo_nome'] == 'ARQ-R01.ifc'
    assert lista['historico'][1]['ifc_bytes'] == 5000


def test_registrar_substitui_caminho_antigo_do_script(cenario, admin):
    obra = cenario.obra_a
    with sessao(cenario.dsn, papel=None) as cur:
        cur.execute("insert into public.modelo (obra_id, sigla, revisao, caminho, bytes, hash) "
                    "values (%s, 'EST', 'R02', %s, 50, 'antigo')", (obra, f'{obra}/EST.frag'))
    assert listar(cenario, admin, obra)['modelos'][0]['caminho'] == f'{obra}/EST.frag'
    p = payload(obra, sigla='EST', hash_='e', bytes_=70)
    subir(cenario, p['caminho'], 70)
    registrar(cenario, admin, obra, p)
    assert modelos(cenario, obra) == [('EST', 'R01', p['caminho'], 70, 'e' * 16)]


def test_participante_ve_o_modelo(cenario, admin):
    p = payload(cenario.obra_a)
    subir(cenario, p['caminho'], 1000)
    registrar(cenario, admin, cenario.obra_a, p)
    consulta = 'select sigla, caminho, hash from public.modelo'
    assert sql(cenario, consulta, usuario=cenario.equipe_a) == [('ARQ', p['caminho'], 'a' * 16)]
    assert sql(cenario, consulta, usuario=cenario.gestor_b) == []


# --- Retirar e listar --------------------------------------------------------------------------

def test_retirar_e_listar(cenario, admin):
    obra = cenario.obra_a
    for sigla, h, n in (('HID', 'b', 20), ('ARQ', 'a', 10), ('EST', 'c', 30)):
        p = payload(obra, sigla=sigla, hash_=h, bytes_=n)
        subir(cenario, p['caminho'], n)
        registrar(cenario, admin, obra, p)

    sql(cenario, 'select public.admin_retirar_modelo(%s, %s)', (slug(cenario, obra), 'HID'), usuario=admin)
    assert [m[0] for m in modelos(cenario, obra)] == ['ARQ', 'EST']
    assert sorted(sql(cenario, 'select sigla from public.modelo', usuario=cenario.equipe_a)) == [('ARQ',), ('EST',)]
    # o arquivo fica no Storage
    with sessao(cenario.dsn, papel=None) as cur:
        cur.execute("select count(*) from storage.objects where bucket_id = 'modelos' and name = %s",
                    (f'{obra}/HID/{"b" * 16}.frag',))
        assert cur.fetchone()[0] == 1

    lista = listar(cenario, admin, obra)
    assert [m['sigla'] for m in lista['modelos']] == ['ARQ', 'EST']
    assert set(lista['modelos'][0]) == {'sigla', 'revisao', 'caminho', 'bytes', 'hash', 'atualizado_em'}
    assert [(h['acao'], h['sigla']) for h in lista['historico']] == [
        ('retirado', 'HID'), ('publicado', 'EST'), ('publicado', 'ARQ'), ('publicado', 'HID')]
    retirada = lista['historico'][0]
    assert retirada['publicado_por_nome'] == 'Usuário 3'
    assert retirada['hash'] == 'b' * 16 and retirada['bytes'] == 20 and retirada['origem'] is None
    assert set(retirada) == {'id', 'acao', 'sigla', 'revisao', 'bytes', 'hash', 'origem', 'arquivo_nome',
                             'ifc_bytes', 'publicado_em', 'publicado_por_nome'}

    # Outra obra: listas vazias.
    assert listar(cenario, admin, cenario.obra_b) == {'modelos': [], 'historico': []}


def test_retirar_sigla_inexistente(cenario, admin):
    with pytest.raises(psycopg.Error) as e:
        sql(cenario, 'select public.admin_retirar_modelo(%s, %s)', (slug(cenario, cenario.obra_a), 'ARQ'),
            usuario=admin)
    assert e.value.sqlstate == 'P0002'
    assert historico(cenario, cenario.obra_a) == 0


def test_historico_limitado_a_100(cenario, admin):
    obra = cenario.obra_a
    with sessao(cenario.dsn, papel=None) as cur:
        cur.execute("insert into public.publicacao_modelo (obra_id, acao, sigla, publicado_em) "
                    "select %s, 'publicado', 'ARQ', now() - make_interval(mins => i) "
                    "from generate_series(1, 105) i", (obra,))
    h = listar(cenario, admin, obra)['historico']
    assert len(h) == 100
    datas = [x['publicado_em'] for x in h]
    assert datas == sorted(datas, reverse=True)
