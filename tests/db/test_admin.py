"""Testes da migration do site de administração (fase 1). Plano: tasks/plano-admin.md; docs/admin.md."""
import hashlib
import json
import re
import uuid
from pathlib import Path

import pytest

psycopg = pytest.importorskip('psycopg', reason='psycopg não instalado')
from psycopg import errors  # noqa: E402

from conftest import RAIZ, sessao  # noqa: E402

SEED = RAIZ / 'supabase' / 'seed'


@pytest.fixture(autouse=True)
def admins_limpos(dsn):
    """O banco é compartilhado na sessão: cada teste começa sem admins e sem links."""
    with sessao(dsn, papel=None) as cur:
        cur.execute('delete from public.admin_app')
        cur.execute('delete from privado.admin_entrada')


def sql(c, comando, params=(), papel='authenticated', usuario=None):
    with sessao(c.dsn, usuario, papel=papel) as cur:
        cur.execute(comando, params)
        return cur.fetchall() if cur.description else None


def tornar_admin(c, *usuarios):
    with sessao(c.dsn, papel=None) as cur:
        for u in usuarios:
            cur.execute('insert into public.admin_app (usuario_id) values (%s) on conflict do nothing', (u,))


def rpc(c, usuario, comando, params=()):
    """Executa como `usuario` (authenticated) e devolve o primeiro valor da primeira linha."""
    r = sql(c, comando, params, usuario=usuario)
    return r[0][0] if r else None


def slug_novo(prefixo='obra'):
    return f'{prefixo}-{uuid.uuid4().hex[:8]}'


def hash_de(token):
    return hashlib.sha256(token.encode()).hexdigest()


# --- Acesso ------------------------------------------------------------------------------------

RPCS_ADMIN = [
    ('select * from public.admin_listar_obras()', ()),
    ("select public.admin_obter_obra('x')", ()),
    ("select public.admin_salvar_obra('{\"slug\": \"nova-x\", \"nome\": \"X\"}'::jsonb)", ()),
    ("select public.admin_salvar_pavimentos('x', '[]'::jsonb)", ()),
    ("select public.admin_salvar_config('x', '{}'::jsonb)", ()),
    ("select public.admin_exportar_obra('x')", ()),
    ('select * from public.admin_listar_admins()', ()),
    ('select public.admin_incluir_admin(%s)', (str(uuid.uuid4()),)),
    ('select public.admin_remover_admin(%s)', (str(uuid.uuid4()),)),
    ('select * from public.admin_listar_usuarios()', ()),
]


@pytest.mark.parametrize('comando,params', RPCS_ADMIN)
def test_nao_admin_recebe_42501(cenario, comando, params):
    c = cenario
    tornar_admin(c, c.gestor_b)  # existe admin, mas não é quem chama
    with pytest.raises(errors.InsufficientPrivilege) as e:
        sql(c, comando, params, usuario=c.gestor_a)
    assert e.value.sqlstate == '42501'


@pytest.mark.parametrize('comando,params', RPCS_ADMIN + [('select public.sou_admin()', ())])
def test_anon_nao_executa_rpcs_de_admin(cenario, comando, params):
    with pytest.raises(errors.InsufficientPrivilege):
        sql(cenario, comando, params, papel='anon')


def test_sem_sessao_recebe_28000(cenario):
    with pytest.raises(errors.Error) as e:
        sql(cenario, 'select * from public.admin_listar_obras()')
    assert e.value.sqlstate == '28000'


def test_sou_admin(cenario):
    c = cenario
    tornar_admin(c, c.gestor_a)
    assert rpc(c, c.gestor_a, 'select public.sou_admin()') is True
    assert rpc(c, c.equipe_a, 'select public.sou_admin()') is False
    assert sql(c, 'select public.sou_admin()') == [(False,)]  # sem usuário


@pytest.mark.parametrize('tabela', ['public.admin_app', 'public.obra_config', 'privado.admin_entrada'])
def test_authenticated_nao_le_as_tabelas_direto(cenario, tabela):
    c = cenario
    tornar_admin(c, c.gestor_a)
    for papel in ('authenticated', 'anon'):
        with pytest.raises(errors.InsufficientPrivilege):
            sql(c, f'select * from {tabela}', usuario=c.gestor_a if papel == 'authenticated' else None, papel=papel)
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, f'delete from {tabela}', usuario=c.gestor_a)


# --- Obras ---------------------------------------------------------------------------------------

def salvar_obra(c, usuario, dados):
    return rpc(c, usuario, 'select public.admin_salvar_obra(%s::jsonb)', (json.dumps(dados),))


def test_admin_cria_e_edita_obra_e_slug_nao_muda(cenario):
    c = cenario
    tornar_admin(c, c.sem_obra)
    slug = slug_novo()
    criada = salvar_obra(c, c.sem_obra, {'slug': slug, 'nome': '  Obra Nova ', 'ordem': 3})
    assert criada['slug'] == slug and criada['nome'] == 'Obra Nova' and criada['ordem'] == 3

    editada = salvar_obra(c, c.sem_obra, {'id': criada['id'], 'nome': 'Obra Renomeada', 'ordem': 1})
    assert (editada['id'], editada['slug'], editada['nome'], editada['ordem']) == (
        criada['id'], slug, 'Obra Renomeada', 1)
    # mesmo slug na edição é aceito; slug diferente não
    assert salvar_obra(c, c.sem_obra, {'id': criada['id'], 'slug': slug, 'nome': 'X'})['nome'] == 'X'
    with pytest.raises(errors.Error) as e:
        salvar_obra(c, c.sem_obra, {'id': criada['id'], 'slug': 'outro-slug', 'nome': 'X'})
    assert e.value.sqlstate == '22023'

    obras = sql(c, 'select slug, ordem, pavimentos, ambientes_ativos, status from public.admin_listar_obras()',
                usuario=c.sem_obra)
    assert (slug, 1, [], 0, None) in obras


@pytest.mark.parametrize('dados,estado', [
    ({'slug': 'Maiuscula', 'nome': 'X'}, '22023'),
    ({'slug': 'com espaco', 'nome': 'X'}, '22023'),
    ({'slug': 'sem-nome'}, '22023'),
    ({'slug': 'nome-vazio', 'nome': '   '}, '22023'),
    ({'slug': 'ordem-texto', 'nome': 'X', 'ordem': 'a'}, '22023'),
    ({'id': str(uuid.uuid4()), 'nome': 'X'}, 'P0002'),
    ({'id': 'nao-uuid', 'nome': 'X'}, '22023'),
])
def test_salvar_obra_valida(cenario, dados, estado):
    c = cenario
    tornar_admin(c, c.sem_obra)
    with pytest.raises(errors.Error) as e:
        salvar_obra(c, c.sem_obra, dados)
    assert e.value.sqlstate == estado


def test_salvar_obra_com_slug_existente_falha(cenario):
    c = cenario
    tornar_admin(c, c.sem_obra)
    with sessao(c.dsn, papel=None) as cur:
        cur.execute('select slug from public.obra where id = %s', (c.obra_a,))
        slug = cur.fetchone()[0]
    with pytest.raises(errors.UniqueViolation):
        salvar_obra(c, c.sem_obra, {'slug': slug, 'nome': 'Outra'})


def test_obter_obra(cenario):
    c = cenario
    tornar_admin(c, c.sem_obra)
    with sessao(c.dsn, papel=None) as cur:
        cur.execute('select slug from public.obra where id = %s', (c.obra_a,))
        slug = cur.fetchone()[0]
    d = rpc(c, c.sem_obra, 'select public.admin_obter_obra(%s)', (slug,))
    assert d['obra']['slug'] == slug and d['obra']['telegram_vinculado'] is False
    assert [(p['codigo'], p['ambientes'], p['ambientes_ativos'], p['plantas']) for p in d['pavimentos']] == [
        ('terreo', 2, 2, 0)]
    assert d['config'] is None
    with pytest.raises(errors.Error) as e:
        rpc(c, c.sem_obra, 'select public.admin_obter_obra(%s)', ('nao-existe',))
    assert e.value.sqlstate == 'P0002'


# --- Pavimentos ----------------------------------------------------------------------------------

def salvar_pavs(c, usuario, slug, lista):
    return rpc(c, usuario, 'select public.admin_salvar_pavimentos(%s, %s::jsonb)', (slug, json.dumps(lista)))


def test_admin_cria_edita_e_apaga_pavimento_vazio(cenario):
    c = cenario
    tornar_admin(c, c.sem_obra)
    slug = slug_novo()
    salvar_obra(c, c.sem_obra, {'slug': slug, 'nome': 'Obra'})
    r = salvar_pavs(c, c.sem_obra, slug, [{'codigo': 'terreo', 'nome': 'Térreo', 'ordem': 1},
                                          {'codigo': '1pav', 'nome': '1º pavimento'}])
    assert r == [{'codigo': 'terreo', 'nome': 'Térreo', 'ordem': 1}, {'codigo': '1pav', 'nome': '1º pavimento', 'ordem': 2}]
    r = salvar_pavs(c, c.sem_obra, slug, [{'codigo': 'terreo', 'nome': 'Pavimento térreo', 'ordem': 5}])
    assert r == [{'codigo': 'terreo', 'nome': 'Pavimento térreo', 'ordem': 5}]


def test_nao_apaga_pavimento_com_ambientes(cenario):
    c = cenario
    tornar_admin(c, c.sem_obra)
    with sessao(c.dsn, papel=None) as cur:
        cur.execute('select slug from public.obra where id = %s', (c.obra_a,))
        slug = cur.fetchone()[0]
    with pytest.raises(errors.ForeignKeyViolation) as e:
        salvar_pavs(c, c.sem_obra, slug, [{'codigo': 'novo', 'nome': 'Novo'}])
    assert 'terreo' in str(e.value) and 'ambientes' in str(e.value)
    # nada mudou (a transação inteira foi desfeita)
    d = rpc(c, c.sem_obra, 'select public.admin_obter_obra(%s)', (slug,))
    assert [p['codigo'] for p in d['pavimentos']] == ['terreo']


@pytest.mark.parametrize('lista', [
    {'codigo': 'x'},
    [{'codigo': 'Térreo', 'nome': 'X'}],
    [{'codigo': 'a b', 'nome': 'X'}],
    [{'codigo': 'ok', 'nome': ''}],
    [{'codigo': 'ok'}],
    [{'codigo': 'ok', 'nome': 'A'}, {'codigo': 'ok', 'nome': 'B'}],
])
def test_salvar_pavimentos_valida(cenario, lista):
    c = cenario
    tornar_admin(c, c.sem_obra)
    slug = slug_novo()
    salvar_obra(c, c.sem_obra, {'slug': slug, 'nome': 'Obra'})
    with pytest.raises(errors.Error) as e:
        salvar_pavs(c, c.sem_obra, slug, lista)
    assert e.value.sqlstate == '22023'


# --- Configuração e exportação -------------------------------------------------------------------

def test_admin_salva_config_e_grava_quem(cenario):
    c = cenario
    tornar_admin(c, c.sem_obra)
    slug = slug_novo()
    salvar_obra(c, c.sem_obra, {'slug': slug, 'nome': 'Obra'})
    config = {'status': 'revisado', 'nomes_fixos': {'DML': 'DML'}, 'categorias': {'WC': 'banheiro'},
              'prancha': {'recorte_edificio': [0, 0, 1, 1]}}
    r = rpc(c, c.sem_obra, 'select public.admin_salvar_config(%s, %s::jsonb)', (slug, json.dumps(config)))
    assert r['config'] == config
    with sessao(c.dsn, papel=None) as cur:
        cur.execute('select c.config, c.atualizado_por from public.obra_config c join public.obra o on o.id = c.obra_id '
                    'where o.slug = %s', (slug,))
        assert cur.fetchone() == (config, c.sem_obra)
    # segunda gravação substitui
    rpc(c, c.sem_obra, 'select public.admin_salvar_config(%s, %s::jsonb)', (slug, json.dumps({'status': 'revisado'})))
    d = rpc(c, c.sem_obra, 'select public.admin_obter_obra(%s)', (slug,))
    assert d['config'] == {'status': 'revisado'} and d['config_atualizada_por'] == 'Usuário 3'
    obras = sql(c, 'select slug, status from public.admin_listar_obras()', usuario=c.sem_obra)
    assert (slug, 'revisado') in obras


@pytest.mark.parametrize('config', [
    '[]', '"texto"', '1', 'null',
    '{"status": "outro"}',
    '{"nomes_fixos": []}',
    '{"categorias": {"WC": 1}}',
])
def test_salvar_config_valida(cenario, config):
    c = cenario
    tornar_admin(c, c.sem_obra)
    slug = slug_novo()
    salvar_obra(c, c.sem_obra, {'slug': slug, 'nome': 'Obra'})
    with pytest.raises(errors.Error) as e:
        rpc(c, c.sem_obra, 'select public.admin_salvar_config(%s, %s::jsonb)', (slug, config))
    assert e.value.sqlstate == '22023'


def test_exportar_obra(cenario):
    c = cenario
    tornar_admin(c, c.sem_obra)
    with sessao(c.dsn, papel=None) as cur:
        cur.execute('select slug from public.obra where id = %s', (c.obra_a,))
        slug = cur.fetchone()[0]
    rpc(c, c.sem_obra, 'select public.admin_salvar_config(%s, %s::jsonb)', (slug, '{"status": "revisado"}'))
    e = rpc(c, c.sem_obra, 'select public.admin_exportar_obra(%s)', (slug,))
    assert e['formato'] == 'miniappcofz-obra' and e['versao'] == 1
    assert e['obra'] == {'slug': slug, 'nome': 'Obra a', 'ordem': 0}
    assert e['pavimentos'] == [{'codigo': 'terreo', 'nome': 'Térreo', 'ordem': 0}]
    assert e['config'] == {'status': 'revisado'}
    assert sorted(a['codigo'] for a in e['ambientes']) == ['amb0', 'amb1']
    assert all(a['pavimento'] == 'terreo' and a['ativo'] is True for a in e['ambientes'])
    assert e['plantas'] == []


# --- Admins --------------------------------------------------------------------------------------

def test_incluir_listar_e_remover_admins(cenario):
    c = cenario
    tornar_admin(c, c.gestor_a)
    rpc(c, c.gestor_a, 'select public.admin_incluir_admin(%s)', (c.equipe_a,))
    rpc(c, c.gestor_a, 'select public.admin_incluir_admin(%s)', (c.equipe_a,))  # idempotente
    admins = sql(c, 'select usuario_id, criado_por_nome from public.admin_listar_admins()', usuario=c.gestor_a)
    assert sorted(admins, key=str) == sorted([(c.gestor_a, None), (c.equipe_a, 'Usuário 0')], key=str)
    usuarios = {u[0]: u[4] for u in sql(c, 'select * from public.admin_listar_usuarios()', usuario=c.gestor_a)}
    assert usuarios[c.equipe_a] is True and usuarios[c.sem_obra] is False

    rpc(c, c.equipe_a, 'select public.admin_remover_admin(%s)', (c.gestor_a,))
    assert rpc(c, c.gestor_a, 'select public.sou_admin()') is False


def test_incluir_admin_exige_usuario_existente(cenario):
    c = cenario
    tornar_admin(c, c.gestor_a)
    with pytest.raises(errors.Error) as e:
        rpc(c, c.gestor_a, 'select public.admin_incluir_admin(%s)', (str(uuid.uuid4()),))
    assert e.value.sqlstate == 'P0002'


def test_nao_remove_o_ultimo_admin(cenario):
    c = cenario
    tornar_admin(c, c.gestor_a)
    with pytest.raises(errors.Error) as e:
        rpc(c, c.gestor_a, 'select public.admin_remover_admin(%s)', (c.gestor_a,))
    assert e.value.sqlstate == '22023' and 'último admin' in str(e.value)
    with pytest.raises(errors.Error) as e:
        rpc(c, c.gestor_a, 'select public.admin_remover_admin(%s)', (c.equipe_a,))
    assert e.value.sqlstate == 'P0002'
    assert rpc(c, c.gestor_a, 'select public.sou_admin()') is True


# --- Links de entrada (service_role) ----------------------------------------------------------

CRIAR = 'select public.admin_entrada_criar(%s, %s)'
CONSUMIR = 'select usuario_id, email, nome from public.admin_entrada_consumir(%s)'


def test_link_de_entrada_uso_unico(cenario):
    c = cenario
    tornar_admin(c, c.gestor_a)
    h = hash_de('token-1')
    expira = sql(c, CRIAR + ' > now() + interval \'110 seconds\'', (c.gestor_a, h), papel='service_role')
    assert expira == [(True,)]
    with sessao(c.dsn, papel=None) as cur:
        cur.execute('select count(*) from privado.admin_entrada where token_hash = %s', (h,))
        assert cur.fetchone()[0] == 1
    assert sql(c, CONSUMIR, (h,), papel='service_role') == [(c.gestor_a, f'{c.gestor_a}@teste.invalid', 'Usuário 0')]
    assert sql(c, CONSUMIR, (h,), papel='service_role') == []  # reutilizado
    assert sql(c, CONSUMIR, (hash_de('outro'),), papel='service_role') == []


def test_link_de_entrada_expirado_e_limpeza(cenario):
    c = cenario
    tornar_admin(c, c.gestor_a)
    velho, novo = hash_de('velho'), hash_de('novo')
    sql(c, CRIAR, (c.gestor_a, velho), papel='service_role')
    with sessao(c.dsn, papel=None) as cur:
        cur.execute("update privado.admin_entrada set expira_em = now() - interval '1 second' where token_hash = %s",
                    (velho,))
    assert sql(c, CONSUMIR, (velho,), papel='service_role') == []
    # criar outro apaga os expirados
    with sessao(c.dsn, papel=None) as cur:
        cur.execute("insert into privado.admin_entrada values (%s, %s, now() - interval '1 minute')",
                    (hash_de('abandonado'), c.gestor_a))
    sql(c, CRIAR, (c.gestor_a, novo), papel='service_role')
    with sessao(c.dsn, papel=None) as cur:
        cur.execute('select token_hash from privado.admin_entrada')
        assert cur.fetchall() == [(novo,)]


def test_link_de_entrada_so_para_admin_e_admin_atual(cenario):
    c = cenario
    tornar_admin(c, c.gestor_a, c.equipe_a)
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, CRIAR, (c.sem_obra, hash_de('x')), papel='service_role')
    with pytest.raises(errors.Error) as e:
        sql(c, CRIAR, (c.gestor_a, 'nao-hex'), papel='service_role')
    assert e.value.sqlstate == '22023'
    # deixou de ser admin entre criar e trocar: o link não vale
    h = hash_de('y')
    sql(c, CRIAR, (c.equipe_a, h), papel='service_role')
    rpc(c, c.gestor_a, 'select public.admin_remover_admin(%s)', (c.equipe_a,))
    assert sql(c, CONSUMIR, (h,), papel='service_role') == []


@pytest.mark.parametrize('comando,params', [
    (CRIAR, (str(uuid.uuid4()), 'a' * 64)),
    (CONSUMIR, ('a' * 64,)),
    ('select * from public.admin_por_telegram(1)', ()),
])
def test_funcoes_da_edge_function_negadas_ao_cliente(cenario, comando, params):
    c = cenario
    tornar_admin(c, c.gestor_a)
    for papel, usuario in (('authenticated', c.gestor_a), ('anon', None)):
        with pytest.raises(errors.InsufficientPrivilege):
            sql(c, comando, params, papel=papel, usuario=usuario)


def test_admin_por_telegram(cenario):
    c = cenario
    tornar_admin(c, c.gestor_a)
    with sessao(c.dsn, papel=None) as cur:
        cur.execute('select telegram_id from public.usuario where id = %s', (c.gestor_a,))
        tg_admin = cur.fetchone()[0]
        cur.execute('select telegram_id from public.usuario where id = %s', (c.equipe_a,))
        tg_outro = cur.fetchone()[0]
    q = 'select usuario_id, email from public.admin_por_telegram(%s)'
    assert sql(c, q, (tg_admin,), papel='service_role') == [(c.gestor_a, f'{c.gestor_a}@teste.invalid')]
    assert sql(c, q, (tg_outro,), papel='service_role') == []
    assert sql(c, q, (999,), papel='service_role') == []


# --- Seeds de dados (HTO, COFZ, configuração e primeiros admins) -------------------------------

def _sem_transacao(texto):
    return re.sub(r'^\s*(begin|commit);\s*$', '', texto, flags=re.MULTILINE | re.IGNORECASE)


def test_seeds_de_configuracao_e_admins(dsn):
    """Aplica os seeds numa transação desfeita no fim: config de HTO e COFZ e os dois admins."""
    with psycopg.connect(dsn) as conn:
        try:
            with conn.cursor() as cur:
                cur.execute("delete from public.obra where slug in ('hto', 'cofz')")
                for nome in ('hto.sql', 'cofz.sql', 'admin_config.sql', 'admin_config.sql'):  # idempotente
                    cur.execute(_sem_transacao((SEED / nome).read_text()))
                cur.execute("select o.slug, c.config from public.obra_config c join public.obra o on o.id = c.obra_id "
                            "where o.slug in ('hto', 'cofz') order by o.slug")
                configs = dict(cur.fetchall())
                original = json.loads((RAIZ / 'data' / 'hto' / 'obra.json').read_text())
                assert configs['hto']['nomes_fixos'] == original['nomes_fixos']
                assert configs['hto']['status'] == 'revisado' and configs['cofz']['status'] == 'aguardando_revisao_humana'
                assert 'slug' not in configs['hto'] and 'nome' not in configs['hto']
                assert configs['cofz']['pavimentos'] == [
                    {'codigo': 'terreo', 'pdf': 'CE01-01PE02-ARQ-DE009-R06.pdf', 'pagina': 1}]

                # Admins: só entram os que já existem em `usuario` (e de novo sem erro).
                cur.execute('delete from public.usuario where telegram_id in (1362893349, 669804829)')
                uid = uuid.uuid4()
                cur.execute('insert into auth.users (id, email) values (%s, %s)', (uid, 'tg1362893349@telegram.invalid'))
                cur.execute("insert into public.usuario (id, telegram_id, nome) values (%s, 1362893349, 'Patrício')",
                            (uid,))
                cur.execute(_sem_transacao((SEED / 'admins.sql').read_text()))
                cur.execute(_sem_transacao((SEED / 'admins.sql').read_text()))
                cur.execute('select usuario_id from public.admin_app')
                assert cur.fetchall() == [(uid,)]
        finally:
            conn.rollback()


def test_seed_admin_config_e_gerado_pelo_script():
    texto = (SEED / 'admin_config.sql').read_text()
    assert texto.startswith('-- Gerado por scripts/importar_config_obras.py')
    assert Path(RAIZ / 'scripts' / 'importar_config_obras.py').exists()
