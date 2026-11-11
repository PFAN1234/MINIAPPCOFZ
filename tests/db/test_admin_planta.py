"""Testes da migration da planta pelo site de administração (fase 2).

`admin_publicar_revisao` deve ter o mesmo efeito do seed de scripts/gerar_seed.py nos
pavimentos publicados; as políticas de Storage deixam só admins gravarem em `originais` e
`plantas`. Plano: tasks/plano-admin.md; docs/admin.md ("Planta").
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


class Obra:
    """Obra nova com dois pavimentos (terreo, 1pav), sem ambientes."""

    def __init__(self, c):
        self.c = c
        self.id = uuid.uuid4()
        self.slug = f'pl-{uuid.uuid4().hex[:8]}'
        with sessao(c.dsn, papel=None) as cur:
            cur.execute('insert into public.obra (id, slug, nome) values (%s, %s, %s)', (self.id, self.slug, 'Obra planta'))
            for ordem, (codigo, nome) in enumerate((('terreo', 'Térreo'), ('1pav', '1º pavimento')), start=1):
                cur.execute('insert into public.pavimento (obra_id, codigo, nome, ordem) values (%s, %s, %s, %s)',
                            (self.id, codigo, nome, ordem))

    def subir(self, bucket, nome):
        with sessao(self.c.dsn, papel=None) as cur:
            cur.execute('insert into storage.objects (bucket_id, name) values (%s, %s) on conflict do nothing',
                        (bucket, nome))

    def pavimento(self, codigo, revisao, ambientes, sha='a', subir=True):
        """Bloco de um pavimento do payload (e os arquivos no Storage, se `subir`)."""
        sha = (sha * 64)[:64]
        base = f'{self.id}/{revisao}/{codigo}/'
        if subir:
            self.subir('originais', f'{base}{sha}.pdf')
            for nome in ['planta.webp', 'planta-hd.webp', *[f'ambientes/{a["codigo"]}.webp' for a in ambientes]]:
                self.subir('plantas', base + nome)
        return {
            'codigo': codigo, 'revisao': revisao,
            'pdf': {'path': f'{base}{sha}.pdf', 'sha256': sha, 'nome': f'X-{revisao}.pdf', 'pagina': 1},
            'pagina_pt': [1000.0, 500.0], 'recorte_pt': [0.0, 0.0, 1000.0, 500.0],
            'imagem': {'largura': 2400, 'altura': 1200}, 'imagem_hd': {'largura': 4096, 'altura': 2048},
            'detalhes': {a['codigo']: {'recorte_pt': [1.0, 2.0, 221.0, 127.0], 'largura': 881, 'altura': 501}
                         for a in ambientes},
            'resumo': {'diferencas': {'novos': []}},
        }

    def publicar(self, usuario, pavimentos, ambientes, removidos=(), **extra):
        p = {'pavimentos': pavimentos, 'ambientes': ambientes, 'ambientes_removidos': list(removidos), **extra}
        return sql(self.c, 'select public.admin_publicar_revisao(%s, %s::jsonb)', (self.slug, json.dumps(p)),
                   usuario=usuario)[0][0]

    def ambientes(self):
        with sessao(self.c.dsn, papel=None) as cur:
            cur.execute('select a.codigo, p.codigo, a.nome_operacional, a.area_m2, a.revisao_planta, a.ativo, a.ordem '
                        'from public.ambiente a join public.pavimento p on p.id = a.pavimento_id '
                        'where a.obra_id = %s order by a.codigo', (self.id,))
            return {r[0]: r[1:] for r in cur.fetchall()}

    def plantas(self):
        with sessao(self.c.dsn, papel=None) as cur:
            cur.execute('select p.codigo, pl.revisao, pl.ativa, pl.imagem_path, '
                        '(select count(*) from public.planta_detalhe d where d.planta_id = pl.id) '
                        'from public.planta pl join public.pavimento p on p.id = pl.pavimento_id '
                        'where pl.obra_id = %s order by p.codigo, pl.revisao', (self.id,))
            return cur.fetchall()

    def publicacoes(self):
        with sessao(self.c.dsn, papel=None) as cur:
            cur.execute('select count(*) from public.publicacao_planta where obra_id = %s', (self.id,))
            return cur.fetchone()[0]


def amb(codigo, pav='terreo', nome=None, area=10.0, x=0.5, y=0.5):
    return {'codigo': codigo, 'pavimento': pav, 'nome_operacional': nome or codigo.split('-', 1)[1].title(),
            'nome_planta': (nome or codigo).upper(), 'categoria': 'area_comum', 'area_m2': area,
            'marcadores': [{'x': x, 'y': y, 'rotulo_bbox': [x, y, x, y]}]}


R01 = [amb('terreo-copa', area=15.16), amb('terreo-dml', area=2.9), amb('terreo-recepcao', area=20.49)]
R02 = [amb('terreo-cozinha', area=15.16), amb('terreo-recepcao', area=21.0), amb('terreo-sala-nova', area=9.0)]
SALA_1PAV = [amb('1pav-sala', pav='1pav')]


@pytest.fixture
def obra(cenario):
    tornar_admin(cenario, cenario.sem_obra)
    return Obra(cenario)


# --- Acesso ------------------------------------------------------------------------------------

RPCS = [
    ("select public.admin_publicar_revisao('x', '{}'::jsonb)", ()),
    ("select public.admin_editor_planta('x')", ()),
    ("select * from public.admin_listar_publicacoes('x')", ()),
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


def test_cliente_nao_le_publicacao_direto(cenario):
    tornar_admin(cenario, cenario.gestor_a)
    with pytest.raises(errors.InsufficientPrivilege):
        sql(cenario, 'select * from public.publicacao_planta', usuario=cenario.gestor_a)


# --- Publicação --------------------------------------------------------------------------------

def test_publicacao_r01_e_r02(obra, cenario):
    admin = cenario.sem_obra
    r = obra.publicar(admin, [obra.pavimento('terreo', 'R01', R01), obra.pavimento('1pav', 'R01', SALA_1PAV)],
                      R01 + SALA_1PAV)
    assert r['ambientes_ativos'] == 4 and r['inativados'] == 0
    assert [p['pavimento'] for p in r['publicacoes']] == ['terreo', '1pav']
    ambs = obra.ambientes()
    assert {k: v[4] for k, v in ambs.items()} == {
        'terreo-copa': True, 'terreo-dml': True, 'terreo-recepcao': True, '1pav-sala': True}
    # ordem global: térreo antes do 1º pavimento, na ordem da lista
    assert [k for k, v in sorted(ambs.items(), key=lambda kv: kv[1][5])] == [
        'terreo-copa', 'terreo-dml', 'terreo-recepcao', '1pav-sala']
    assert ambs['terreo-copa'][3] == 'R01'

    r = obra.publicar(admin, [obra.pavimento('terreo', 'R02', R02, sha='b')], R02,
                      removidos=['terreo-copa', 'terreo-dml'])
    assert r['inativados'] == 2
    ambs = obra.ambientes()
    assert not ambs['terreo-copa'][4] and not ambs['terreo-dml'][4]
    assert ambs['terreo-recepcao'][2] == 21.0 and ambs['terreo-recepcao'][3] == 'R02'
    assert ambs['terreo-cozinha'][4] and ambs['terreo-sala-nova'][4]
    assert ambs['1pav-sala'][4] and ambs['1pav-sala'][3] == 'R01'
    ativos = sorted((v[5], k) for k, v in ambs.items() if v[4])
    assert [o for o, _ in ativos] == [1, 2, 3, 4]
    assert [k for _, k in ativos] == ['terreo-cozinha', 'terreo-recepcao', 'terreo-sala-nova', '1pav-sala']

    plantas = obra.plantas()
    assert plantas == [
        ('1pav', 'R01', True, f'{obra.id}/R01/1pav/planta.webp', 1),
        ('terreo', 'R01', False, f'{obra.id}/R01/terreo/planta.webp', 3),
        ('terreo', 'R02', True, f'{obra.id}/R02/terreo/planta.webp', 3),
    ]
    assert obra.publicacoes() == 3


def test_publicar_um_pavimento_nao_mexe_no_outro(obra, cenario):
    admin = cenario.sem_obra
    obra.publicar(admin, [obra.pavimento('terreo', 'R01', R01), obra.pavimento('1pav', 'R01', SALA_1PAV)],
                  R01 + SALA_1PAV)
    # Só o térreo, sem remover nada explícito: a copa sai por estar fora da lista do térreo.
    lista = [a for a in R01 if a['codigo'] != 'terreo-copa']
    r = obra.publicar(admin, [obra.pavimento('terreo', 'R01', lista)], lista)
    assert r['inativados'] == 1
    ambs = obra.ambientes()
    assert not ambs['terreo-copa'][4]
    assert ambs['1pav-sala'][4]
    assert ('1pav', 'R01', True, f'{obra.id}/R01/1pav/planta.webp', 1) in obra.plantas()


def test_idempotente(obra, cenario):
    admin = cenario.sem_obra
    pav = obra.pavimento('terreo', 'R01', R01)
    obra.publicar(admin, [pav], R01)
    antes = (obra.ambientes(), obra.plantas())
    r = obra.publicar(admin, [pav], R01)
    assert r['inativados'] == 0
    assert (obra.ambientes(), obra.plantas()) == antes
    assert obra.publicacoes() == 2  # histórico: uma linha por publicação


def test_registro_da_publicacao_e_editor(obra, cenario):
    admin = cenario.sem_obra
    obra.publicar(admin, [obra.pavimento('terreo', 'R01', R01, sha='c')], R01)
    obra.publicar(admin, [obra.pavimento('terreo', 'R02', R02, sha='d')], R02, removidos=['terreo-copa'])
    pubs = sql(cenario, 'select pavimento, revisao, publicado_por_nome, pdf_path, pdf_sha256, pdf_nome, pagina, resumo '
               'from public.admin_listar_publicacoes(%s)', (obra.slug,), usuario=admin)
    assert [(p[0], p[1]) for p in pubs] == [('terreo', 'R02'), ('terreo', 'R01')]
    assert pubs[0][2] == 'Usuário 3'
    assert pubs[0][3] == f'{obra.id}/R02/terreo/{"d" * 64}.pdf' and pubs[0][4] == 'd' * 64
    assert pubs[0][5] == 'X-R02.pdf' and pubs[0][6] == 1
    assert pubs[0][7] == {'diferencas': {'novos': []}, 'ambientes': 3}

    ed = sql(cenario, 'select public.admin_editor_planta(%s)', (obra.slug,), usuario=admin)[0][0]
    assert ed['obra']['id'] == str(obra.id)
    terreo = next(p for p in ed['pavimentos'] if p['codigo'] == 'terreo')
    assert terreo['planta']['revisao'] == 'R02'
    assert terreo['ultimo_pdf']['path'] == pubs[0][3] and terreo['ultimo_pdf']['revisao'] == 'R02'
    um = next(p for p in ed['pavimentos'] if p['codigo'] == '1pav')
    assert um['planta'] is None and um['ultimo_pdf'] is None
    ativos = {a['codigo']: a['ativo'] for a in ed['ambientes']}
    assert ativos['terreo-copa'] is False and ativos['terreo-dml'] is False and ativos['terreo-cozinha'] is True


def test_config_com_trava_otimista(obra, cenario):
    admin = cenario.sem_obra
    pav = obra.pavimento('terreo', 'R01', R01)
    config = {'status': 'revisado', 'revisao': 'R01', 'prancha': {'recorte_edificio': [0, 0, 1, 1]}}
    obra.publicar(admin, [pav], R01, config=config, config_atualizada_em=None)
    ed = sql(cenario, 'select public.admin_editor_planta(%s)', (obra.slug,), usuario=admin)[0][0]
    assert ed['config']['revisao'] == 'R01'
    assert ed['config']['status'] == 'aguardando_revisao_humana'  # publicação exige nova conferência
    # Carimbo antigo (alguém gravou no meio): recusa sem mudar nada.
    with pytest.raises(psycopg.Error) as e:
        obra.publicar(admin, [pav], R01, config={**config, 'revisao': 'R09'}, config_atualizada_em=None)
    assert e.value.sqlstate == '40001'
    obra.publicar(admin, [pav], R01, config={**config, 'revisao': 'R02'},
                  config_atualizada_em=ed['config_atualizada_em'])
    ed2 = sql(cenario, 'select public.admin_editor_planta(%s)', (obra.slug,), usuario=admin)[0][0]
    assert ed2['config']['revisao'] == 'R02'


@pytest.mark.parametrize('mudar,estado', [
    (lambda p, a: p[0]['detalhes'].pop('terreo-copa'), '22023'),
    (lambda p, a: p[0].update(codigo='nao-existe'), '22023'),
    (lambda p, a: p[0].update(revisao='R 01'), '22023'),
    (lambda p, a: p[0]['pdf'].update(path='outra/obra.pdf'), '22023'),
    (lambda p, a: a[0]['marcadores'][0].update(x=1.5), '22023'),
    (lambda p, a: a[0].update(marcadores=[]), '22023'),
    (lambda p, a: a[0].update(nome_operacional=' '), '22023'),
    (lambda p, a: a.append(dict(a[0])), '22023'),
    (lambda p, a: a.append(amb('1pav-sala', pav='1pav')), '22023'),
    (lambda p, a: p[0].update(imagem={'largura': 0, 'altura': 10}), '22023'),
    (lambda p, a: p[0]['pdf'].update(sha256='e' * 64, path=p[0]['pdf']['path'][:-68] + 'e' * 64 + '.pdf'), 'P0002'),
])
def test_payload_invalido(obra, cenario, mudar, estado):
    pavs = [obra.pavimento('terreo', 'R01', R01)]
    ambs = json.loads(json.dumps(R01))
    mudar(pavs, ambs)
    with pytest.raises(psycopg.Error) as e:
        obra.publicar(cenario.sem_obra, pavs, ambs)
    assert e.value.sqlstate == estado
    assert obra.ambientes() == {}


def test_removido_na_lista_e_imagem_faltando(obra, cenario):
    admin = cenario.sem_obra
    with pytest.raises(psycopg.Error) as e:
        obra.publicar(admin, [obra.pavimento('terreo', 'R01', R01)], R01, removidos=['terreo-copa'])
    assert e.value.sqlstate == '22023'
    pav = obra.pavimento('terreo', 'R03', R01, subir=False)
    obra.subir('originais', pav['pdf']['path'])
    with pytest.raises(psycopg.Error) as e:
        obra.publicar(admin, [pav], R01)
    assert e.value.sqlstate == 'P0002' and 'planta.webp' in str(e.value)


# --- Storage -----------------------------------------------------------------------------------

def inserir_objeto(c, usuario, bucket, nome):
    sql(c, 'insert into storage.objects (bucket_id, name) values (%s, %s)', (bucket, nome), usuario=usuario)


def test_buckets(dsn):
    with sessao(dsn, papel=None) as cur:
        cur.execute("select id, public, file_size_limit, allowed_mime_types from storage.buckets "
                    "where id in ('originais', 'plantas') order by id")
        assert cur.fetchall() == [('originais', False, 52428800, ['application/pdf']),
                                  ('plantas', False, 5242880, ['image/webp'])]


def test_admin_grava_e_le_originais(obra, cenario):
    admin = cenario.sem_obra
    nome = f'{obra.id}/R01/terreo/{"f" * 64}.pdf'
    inserir_objeto(cenario, admin, 'originais', nome)
    assert sql(cenario, "select name from storage.objects where bucket_id = 'originais' and name = %s", (nome,),
               usuario=admin) == [(nome,)]
    # update (upsert do Storage) também é permitido ao admin
    sql(cenario, "update storage.objects set owner_id = 'x' where bucket_id = 'originais' and name = %s", (nome,),
        usuario=admin)


@pytest.mark.parametrize('nome', [
    'sem-uuid/R01/terreo/{sha}.pdf',
    '{obra}/R01/terreo/arquivo.pdf',
    '{obra}/R01/terreo/{sha}.png',
    '{outra}/R01/terreo/{sha}.pdf',
    '{obra}/R 01/terreo/{sha}.pdf',
])
def test_admin_nao_grava_originais_fora_do_padrao(obra, cenario, nome):
    nome = nome.format(obra=obra.id, outra=uuid.uuid4(), sha='f' * 64)
    with pytest.raises(errors.InsufficientPrivilege):
        inserir_objeto(cenario, cenario.sem_obra, 'originais', nome)


def test_nao_admin_nao_grava_nem_le_originais(obra, cenario):
    # gestor_a é participante (gestor) da obra A, mas não é admin
    nome = f'{cenario.obra_a}/R01/terreo/{"f" * 64}.pdf'
    with pytest.raises(errors.InsufficientPrivilege):
        inserir_objeto(cenario, cenario.gestor_a, 'originais', nome)
    obra.subir('originais', nome)
    assert sql(cenario, "select name from storage.objects where bucket_id = 'originais' and name = %s", (nome,),
               usuario=cenario.gestor_a) == []
    with pytest.raises(errors.InsufficientPrivilege):
        sql(cenario, "select name from storage.objects where bucket_id = 'originais'", papel='anon')


def test_plantas_admin_grava_outros_nao(obra, cenario):
    admin = cenario.sem_obra
    inserir_objeto(cenario, admin, 'plantas', f'{obra.id}/R01/terreo/planta.webp')
    with pytest.raises(errors.InsufficientPrivilege):
        inserir_objeto(cenario, admin, 'plantas', f'{uuid.uuid4()}/R01/terreo/planta.webp')
    with pytest.raises(errors.InsufficientPrivilege):
        inserir_objeto(cenario, cenario.gestor_a, 'plantas', f'{cenario.obra_a}/R01/terreo/planta.webp')
    # A leitura dos participantes continua como antes.
    obra.subir('plantas', f'{cenario.obra_a}/R01/terreo/planta-hd.webp')
    assert sql(cenario, "select name from storage.objects where bucket_id = 'plantas' and name like %s",
               (f'{cenario.obra_a}/%',), usuario=cenario.equipe_a) == [(f'{cenario.obra_a}/R01/terreo/planta-hd.webp',)]
