"""Testes da migration da base do boletim (20261113150000_boletim_base.sql).

Com a parte 3 (20261114120000_boletim_emissao.sql), as estações do INMET viram as do Observatório
(`estacao`/`estacao_reserva`) e saem `inmet_estacao`, `clima_dia` e `admin_sugerir_estacoes`.

Contrato: docs/contrato-boletim.md ("Banco"). Cada cenário tem uma etapa própria (`c.etapa`, sem
sigla) com as obras A (gestor_a, equipe_a) e B (gestor_b); `sem_obra` vira admin quando preciso.
"""
import json
import uuid
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

psycopg = pytest.importorskip('psycopg', reason='psycopg não instalado')
from psycopg import errors  # noqa: E402

from conftest import sessao  # noqa: E402

CABECALHO = ['COMANDO DA AERONÁUTICA', 'DIRETORIA DE INFRAESTRUTURA DA AERONÁUTICA',
             'COMISSÃO DE OBRAS DE FORTALEZA (CO-FZ)']
LOCALIZACAO = {'latitude': -3.761, 'longitude': -38.5297, 'fuso': 'America/Fortaleza'}
CONTRATO = {
    'endereco': 'Av. Borges de Melo, s/n', 'estacao': '8836', 'estacao_reserva': '9281',
    'boletim_horario': '22:15', 'objeto': 'Construção do campus', 'local': 'Fortaleza\nCE',
    'contratante': 'COMAER', 'contrato': '120/2025 - SOP', 'contratada': 'Construtora X',
    'contratada_cnpj': '12.345.678/0001-90', 'os_numero': 'OS 01', 'os_data': '2025-01-31',
    'vigencia_meses': 13, 'valor_original': 79499000, 'area_construida_m2': 86102.17,
}
FALTANDO_TODOS = ['sigla', 'localizacao', 'estacao', 'objeto', 'local', 'contratante', 'contrato',
                  'contratada', 'contratada_cnpj', 'os_numero', 'os_data', 'vigencia_meses', 'valor_original',
                  'area_construida_m2', 'responsaveis']


@pytest.fixture(autouse=True)
def limpo(dsn):
    """O banco é compartilhado na sessão: cada teste começa sem admins."""
    with sessao(dsn, papel=None) as cur:
        cur.execute('delete from public.admin_app')


def sql(c, comando, params=(), papel='authenticated', usuario=None):
    with sessao(c.dsn, usuario, papel=papel) as cur:
        cur.execute(comando, params)
        return cur.fetchall() if cur.description else None


def su(c, comando, params=()):
    return sql(c, comando, params, papel=None)


def rpc(c, usuario, comando, params=()):
    r = sql(c, comando, params, usuario=usuario)
    return r[0][0] if r else None


def tornar_admin(c, *usuarios):
    for u in usuarios:
        su(c, 'insert into public.admin_app (usuario_id) values (%s) on conflict do nothing', (u,))


def sigla_nova():
    return uuid.uuid4().hex[:8].upper()


def slug_etapa(c, etapa=None):
    return su(c, 'select slug from public.etapa where id = %s', (etapa or c.etapa,))[0][0]


def salvar_etapa(c, dados, usuario=None):
    return rpc(c, usuario or c.sem_obra, 'select public.admin_salvar_etapa(%s::jsonb)', (json.dumps(dados),))


def obter_etapa(c, etapa=None):
    return rpc(c, c.sem_obra, 'select public.admin_obter_etapa(%s)', (slug_etapa(c, etapa),))


def criar_etapa(c, **extra):
    """Etapa nova pelo site (admin = sem_obra), com os obrigatórios."""
    dados = {'slug': f'et-{uuid.uuid4().hex[:8]}', 'nome': 'Etapa nova', 'sigla': sigla_nova(), **LOCALIZACAO,
             **extra}
    return salvar_etapa(c, dados)


def estado(excinfo):
    return excinfo.value.sqlstate


def novo_usuario(c, nome='Pessoa'):
    uid = uuid.uuid4()
    su(c, 'insert into auth.users (id, email) values (%s, %s)', (uid, f'{uid}@teste.invalid'))
    su(c, 'insert into public.usuario (id, telegram_id, nome) values (%s, %s, %s)',
       (uid, uuid.uuid4().int % 10**15, nome))
    return uid


def boletim(c, etapa, dia, revisao=0):
    su(c, "insert into public.boletim (etapa_id, data, revisao, numero, snapshot) values (%s, %s, %s, %s, '{}')",
       (etapa, dia, revisao, f'T{uuid.uuid4().hex}'))


# --- Migração e colunas ------------------------------------------------------------------------------

def test_migracao_completa_a_2a_etapa_e_a_organizacao(cenario):
    c = cenario
    assert su(c, "select sigla, fuso, boletim_horario::text from public.etapa where slug = '2a-etapa'") == [
        ('2', 'America/Fortaleza', '23:30:00')]
    # defaults das etapas sem cadastro
    assert su(c, 'select sigla, fuso, boletim_horario::text from public.etapa where id = %s', (c.etapa,)) == [
        (None, 'America/Sao_Paulo', '23:30:00')]
    assert su(c, 'select cabecalho from public.organizacao') == [(CABECALHO,)]
    assert su(c, "select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'boletins'") == [
        (False, 10485760, ['application/pdf', 'image/png'])]


@pytest.mark.parametrize('coluna,valor', [
    ('sigla', 'ab'), ('sigla', 'A' * 11), ('sigla', ''), ('sigla', 'A-1'),
    ('endereco', 'x' * 301), ('latitude', 7), ('longitude', -20), ('fuso', 'Europe/Lisbon'),
    ('estacao', 'A305'), ('estacao_reserva', '12'), ('objeto', 'x' * 601), ('local', 'x' * 301),
    ('contratante', 'x' * 201), ('contrato', 'x' * 61), ('contratada', 'x' * 201),
    ('contratada_cnpj', '12345678000190'), ('os_numero', 'x' * 41), ('vigencia_meses', 0),
    ('vigencia_meses', 241), ('valor_original', -1), ('area_construida_m2', 0),
])
def test_regras_das_colunas_da_etapa(cenario, coluna, valor):
    c = cenario
    extra = {'latitude': ', longitude = -38.5', 'longitude': ', latitude = -3.7'}.get(coluna, '')  # as duas juntas
    with pytest.raises(errors.CheckViolation):
        su(c, f'update public.etapa set {coluna} = %s{extra} where id = %s', (valor, c.etapa))


def test_coordenadas_juntas_estacoes_diferentes_e_sigla_unica(cenario):
    c = cenario
    with pytest.raises(errors.CheckViolation):
        su(c, 'update public.etapa set latitude = -3.7 where id = %s', (c.etapa,))
    with pytest.raises(errors.CheckViolation):
        su(c, "update public.etapa set estacao = '8836', estacao_reserva = '8836' where id = %s",
           (c.etapa,))
    with pytest.raises(errors.NotNullViolation):
        su(c, 'update public.etapa set fuso = null where id = %s', (c.etapa,))
    with pytest.raises(errors.UniqueViolation):
        su(c, "update public.etapa set sigla = '2' where id = %s", (c.etapa,))
    su(c, 'update public.etapa set latitude = -34, longitude = -28, contratada_cnpj = %s where id = %s',
       ('12.345.678/0001-90', c.etapa))


@pytest.mark.parametrize('valor', ['cp patricio', ' CP', 'CP ', 'CP  PATRICIO', 'X' * 61, '', 'CP\tPATRICIO'])
def test_regra_do_nome_de_exibicao(cenario, valor):
    with pytest.raises(errors.CheckViolation):
        su(cenario, 'update public.usuario set nome_exibicao = %s where id = %s', (valor, cenario.equipe_a))


@pytest.mark.parametrize('valor', [['a'] * 5, [''], ['x' * 101], [' a'], [None]])
def test_regra_do_cabecalho(cenario, valor):
    with pytest.raises(errors.CheckViolation):
        su(cenario, 'update public.organizacao set cabecalho = %s', (valor,))


# --- Funções auxiliares --------------------------------------------------------------------------

@pytest.mark.parametrize('nome,codigo', [
    ('CO-FZ', 'COFZ'), ('1º BEC', '1BEC'), ('Comissão de Obras – Fortaleza', 'COMISSAODEOBRASFORTALEZA'),
    ('ÁÉÍÓÚ àâêôãõç ü', 'AEIOUAAEOAOCU'), ('', ''),
])
def test_codigo_om(cenario, nome, codigo):
    assert su(cenario, 'select privado.codigo_om(%s)', (nome,)) == [(codigo,)]


def test_numero_boletim(cenario):
    c = cenario
    dois = su(c, "select id from public.etapa where slug = '2a-etapa'")[0][0]
    nome_org = su(c, 'select nome from public.organizacao')[0][0]
    su(c, "update public.organizacao set nome = 'CO-FZ'")
    try:
        assert su(c, "select privado.numero_boletim(%s, '2026-11-11', 0)", (dois,)) == [('BA2/261111/COFZ',)]
        assert su(c, "select privado.numero_boletim(%s, '2026-11-11', 1)", (dois,)) == [('BA2/261111/COFZ-R1',)]
        assert su(c, "select privado.numero_boletim(%s, '2027-01-05', 12)", (dois,)) == [('BA2/270105/COFZ-R12',)]
        su(c, "update public.organizacao set nome = 'Base Aérea de Natal'")
        assert su(c, "select privado.numero_boletim(%s, '2026-11-11', 0)", (dois,)) == [
            ('BA2/261111/BASEAEREADENATAL',)]
    finally:
        su(c, 'update public.organizacao set nome = %s', (nome_org,))
    with pytest.raises(errors.InvalidParameterValue, match='A etapa não tem sigla'):
        su(c, "select privado.numero_boletim(%s, '2026-11-11', 0)", (c.etapa,))
    with pytest.raises(errors.NoDataFound):
        su(c, "select privado.numero_boletim(%s, '2026-11-11', 0)", (uuid.uuid4(),))


def test_data_local_nome_pessoa_e_boletim_emitido(cenario):
    c = cenario
    instante = datetime(2026, 1, 10, 2, 30, tzinfo=timezone.utc)
    su(c, "update public.etapa set fuso = 'America/Fortaleza' where id = %s", (c.etapa,))
    assert su(c, 'select privado.data_local(%s, %s)', (c.obra_a, instante)) == [(date(2026, 1, 9),)]
    su(c, "update public.etapa set fuso = 'America/Noronha' where id = %s", (c.etapa,))
    assert su(c, 'select privado.data_local(%s, %s)', (c.obra_a, instante)) == [(date(2026, 1, 10),)]

    assert su(c, 'select privado.nome_pessoa(%s)', (c.equipe_a,)) == [('Usuário 1',)]
    su(c, "update public.usuario set nome_exibicao = 'SGT SILVA' where id = %s", (c.equipe_a,))
    assert su(c, 'select privado.nome_pessoa(%s)', (c.equipe_a,)) == [('SGT SILVA',)]

    assert su(c, "select privado.boletim_emitido(%s, '2026-01-10')", (c.etapa,)) == [(False,)]
    boletim(c, c.etapa, '2026-01-10', 1)
    assert su(c, "select privado.boletim_emitido(%s, '2026-01-10')", (c.etapa,)) == [(True,)]
    assert su(c, "select privado.boletim_emitido(%s, '2026-01-11')", (c.etapa,)) == [(False,)]


def test_funcoes_privadas_nao_sao_do_cliente(cenario):
    c = cenario
    for comando in ("select privado.numero_boletim(%s, current_date, 0)", 'select privado.etapa_json(%s)'):
        with pytest.raises(errors.InsufficientPrivilege):
            sql(c, comando, (c.etapa,), usuario=c.gestor_a)


# --- admin_salvar_etapa ----------------------------------------------------------------------------

@pytest.mark.parametrize('faltando', ['sigla', 'latitude', 'longitude', 'fuso'])
@pytest.mark.parametrize('forma', ['ausente', 'null', 'vazio'])
def test_criacao_exige_sigla_coordenadas_e_fuso(cenario, faltando, forma):
    c = cenario
    tornar_admin(c, c.sem_obra)
    dados = {'slug': f'et-{uuid.uuid4().hex[:8]}', 'nome': 'X', 'sigla': sigla_nova(), **LOCALIZACAO}
    if forma == 'ausente':
        del dados[faltando]
    else:
        dados[faltando] = None if forma == 'null' else '  '
    with pytest.raises(errors.InvalidParameterValue) as e:
        salvar_etapa(c, dados)
    assert faltando in str(e.value)


def test_criar_etapa_completa_e_obter(cenario):
    c = cenario
    tornar_admin(c, c.sem_obra)
    sigla = sigla_nova()
    e = criar_etapa(c, sigla=sigla, **{k: (f'  {v} ' if isinstance(v, str) and k not in ('os_data',) else v)
                                       for k, v in CONTRATO.items()})
    assert e == obter_etapa(c, e['id'])
    esperado = {**LOCALIZACAO, **CONTRATO, 'sigla': sigla, 'valor_original': 79499000.00}
    assert {k: e[k] for k in esperado} == esperado  # btrim nos textos
    assert e['local'] == 'Fortaleza\nCE'
    assert e['arquivada_em'] is None and e['telegram_vinculado'] is False and e['telegram_chat_titulo'] is None
    assert e['aditivos'] == [] and e['responsaveis'] == []
    assert e['faltando'] == ['responsaveis']
    assert e['prazo'] == {'termino_original': '2026-02-28', 'prazo_aditivos_dias': 0,
                          'termino_atual': '2026-02-28', 'valor_atual': 79499000.00}
    assert set(e) == {
        'id', 'slug', 'nome', 'ordem', 'arquivada_em', 'telegram_vinculado', 'telegram_chat_titulo', 'sigla',
        'endereco', 'latitude', 'longitude', 'fuso', 'estacao', 'estacao_reserva', 'boletim_horario',
        'objeto', 'local', 'contratante', 'contrato', 'contratada', 'contratada_cnpj', 'os_numero', 'os_data',
        'vigencia_meses', 'valor_original', 'area_construida_m2', 'aditivos', 'responsaveis', 'prazo', 'faltando'}
    # só com os obrigatórios: horário e estações padrão, sem prazo, falta o resto
    m = criar_etapa(c)
    assert (m['boletim_horario'], m['prazo'], m['faltando']) == ('23:30', None, FALTANDO_TODOS[3:])
    assert (m['estacao'], m['estacao_reserva']) == ('8836', '9281')


def test_edicao_mantem_ausentes_e_apaga_nulos(cenario):
    c = cenario
    tornar_admin(c, c.sem_obra)
    e = criar_etapa(c, **CONTRATO)
    editada = salvar_etapa(c, {'id': e['id'], 'objeto': 'Outro objeto', 'endereco': None, 'latitude': None,
                               'longitude': None, 'valor_original': None, 'contratada_cnpj': '',
                               'fuso': 'America/Manaus', 'boletim_horario': '06:05'})
    assert (editada['objeto'], editada['endereco'], editada['latitude'], editada['longitude']) == (
        'Outro objeto', None, None, None)
    assert (editada['valor_original'], editada['contratada_cnpj'], editada['fuso'], editada['boletim_horario']) == (
        None, None, 'America/Manaus', '06:05')
    for k in ('sigla', 'contrato', 'estacao', 'os_data', 'vigencia_meses', 'area_construida_m2', 'nome'):
        assert editada[k] == e[k], k
    assert editada['prazo']['valor_atual'] is None  # sem valor original
    assert editada['faltando'] == ['localizacao', 'contratada_cnpj', 'valor_original', 'responsaveis']
    # a sigla pode mudar, mas não ser apagada; fuso e horário não aceitam null
    nova = sigla_nova()
    assert salvar_etapa(c, {'id': e['id'], 'sigla': nova})['sigla'] == nova
    for dados, trecho in (({'sigla': None}, 'sigla'), ({'sigla': ''}, 'sigla'), ({'fuso': None}, 'fuso'),
                          ({'boletim_horario': None}, 'horário')):
        with pytest.raises(errors.InvalidParameterValue, match=trecho):
            salvar_etapa(c, {'id': e['id'], **dados})
    # etapa sem sigla (a do cenário): sigla null continua sem sigla
    assert salvar_etapa(c, {'id': str(c.etapa), 'sigla': None})['sigla'] is None


def test_sigla_repetida(cenario):
    c = cenario
    tornar_admin(c, c.sem_obra)
    e = criar_etapa(c)
    with pytest.raises(errors.UniqueViolation):
        criar_etapa(c, sigla=e['sigla'])
    with pytest.raises(errors.UniqueViolation):
        salvar_etapa(c, {'id': str(c.etapa), 'sigla': '2'})
    # a própria sigla de novo não é repetição
    assert salvar_etapa(c, {'id': e['id'], 'sigla': e['sigla']})['sigla'] == e['sigla']


@pytest.mark.parametrize('campo,valor', [
    ('sigla', 'abc'), ('sigla', 'A' * 11), ('sigla', 5), ('latitude', '-3.7'), ('latitude', -35),
    ('longitude', -27), ('fuso', 'UTC'), ('fuso', 3), ('estacao', 'A305'), ('estacao', '12'), ('estacao_reserva', '1234567'),
    ('estacao_reserva', '8836'), ('estacao', 8836), ('boletim_horario', '24:00'), ('boletim_horario', '7:30'),
    ('endereco', 'x' * 301), ('objeto', 'x' * 601), ('local', 'x' * 301), ('contratante', 'x' * 201),
    ('contrato', 'x' * 61), ('contratada', 'x' * 201), ('contratada_cnpj', '12.345.678/0001-9'),
    ('os_numero', 'x' * 41), ('os_data', '2025-02-30'), ('os_data', '31/01/2025'), ('vigencia_meses', 0),
    ('vigencia_meses', 241), ('vigencia_meses', 1.5), ('valor_original', -0.01), ('valor_original', 1e13),
    ('valor_original', 'R$ 10'), ('area_construida_m2', 0), ('area_construida_m2', -1), ('objeto', 10),
])
def test_validacoes_da_etapa(cenario, campo, valor):
    c = cenario
    tornar_admin(c, c.sem_obra)
    e = criar_etapa(c, estacao='8836')
    with pytest.raises(errors.InvalidParameterValue):
        salvar_etapa(c, {'id': e['id'], campo: valor})


def test_obter_etapa_acesso_e_inexistente(cenario):
    c = cenario
    tornar_admin(c, c.sem_obra)
    assert obter_etapa(c)['faltando'] == FALTANDO_TODOS
    with pytest.raises(errors.NoDataFound):
        rpc(c, c.sem_obra, "select public.admin_obter_etapa('nao-existe')")
    with pytest.raises(errors.InsufficientPrivilege):
        rpc(c, c.gestor_a, 'select public.admin_obter_etapa(%s)', (slug_etapa(c),))


def test_listar_etapas_com_sigla_e_faltando(cenario):
    c = cenario
    tornar_admin(c, c.sem_obra)
    e = criar_etapa(c, **CONTRATO)
    rpc(c, c.sem_obra, 'select public.admin_definir_responsaveis(%s, %s::jsonb)',
        (e['id'], json.dumps([{'usuario_id': str(c.gestor_a)}])))
    por_id = {x['id']: x for x in rpc(c, c.sem_obra, 'select public.admin_listar_etapas()')}
    assert (por_id[e['id']]['sigla'], por_id[e['id']]['faltando']) == (e['sigla'], 0)
    assert (por_id[str(c.etapa)]['sigla'], por_id[str(c.etapa)]['faltando']) == (None, 15)


# --- Aditivos e prazo ------------------------------------------------------------------------------

def salvar_aditivo(c, dados, usuario=None):
    return rpc(c, usuario or c.sem_obra, 'select public.admin_salvar_aditivo(%s::jsonb)', (json.dumps(dados),))


def test_aditivos_e_prazo(cenario):
    c = cenario
    tornar_admin(c, c.sem_obra)
    e = criar_etapa(c, os_data='2025-03-10', vigencia_meses=12, valor_original=1000.5)
    a1 = salvar_aditivo(c, {'etapa_id': e['id'], 'numero': ' 1º TA ', 'data': '2025-06-01', 'prazo_dias': 90,
                            'valor': 200.25, 'descricao': '  Acréscimo de serviços '})
    assert {k: a1[k] for k in ('etapa_id', 'numero', 'data', 'prazo_dias', 'valor', 'descricao')} == {
        'etapa_id': e['id'], 'numero': '1º TA', 'data': '2025-06-01', 'prazo_dias': 90, 'valor': 200.25,
        'descricao': 'Acréscimo de serviços'}
    assert su(c, 'select criado_por from public.etapa_aditivo where id = %s', (a1['id'],)) == [(c.sem_obra,)]
    a2 = salvar_aditivo(c, {'etapa_id': e['id'], 'numero': '2º TA', 'data': '2025-09-01', 'prazo_dias': -10,
                            'valor': -50})
    assert (a2['descricao'], a2['valor']) == (None, -50)
    # padrões: prazo e valor zero
    a3 = salvar_aditivo(c, {'etapa_id': e['id'], 'numero': '3º TA', 'data': '2025-10-01'})
    assert (a3['prazo_dias'], a3['valor']) == (0, 0)

    o = obter_etapa(c, e['id'])
    assert [a['numero'] for a in o['aditivos']] == ['1º TA', '2º TA', '3º TA']
    assert o['prazo'] == {'termino_original': '2026-03-10', 'prazo_aditivos_dias': 80,
                          'termino_atual': '2026-05-29', 'valor_atual': 1150.75}

    # edição parcial: chave ausente mantém
    ed = salvar_aditivo(c, {'id': a1['id'], 'prazo_dias': 30})
    assert (ed['numero'], ed['prazo_dias'], ed['valor'], ed['descricao']) == ('1º TA', 30, 200.25,
                                                                             'Acréscimo de serviços')
    assert obter_etapa(c, e['id'])['prazo']['termino_atual'] == '2026-03-30'
    with pytest.raises(errors.UniqueViolation):
        salvar_aditivo(c, {'etapa_id': e['id'], 'numero': '2º TA', 'data': '2025-09-01'})
    with pytest.raises(errors.UniqueViolation):
        salvar_aditivo(c, {'id': a1['id'], 'numero': '2º TA'})
    # o mesmo número em outra etapa pode
    outra = criar_etapa(c)
    salvar_aditivo(c, {'etapa_id': outra['id'], 'numero': '2º TA', 'data': '2025-09-01'})

    rpc(c, c.sem_obra, 'select public.admin_remover_aditivo(%s)', (a3['id'],))
    assert [a['numero'] for a in obter_etapa(c, e['id'])['aditivos']] == ['1º TA', '2º TA']
    with pytest.raises(errors.NoDataFound):
        rpc(c, c.sem_obra, 'select public.admin_remover_aditivo(%s)', (a3['id'],))


@pytest.mark.parametrize('dados,codigo', [
    ({'numero': '1', 'data': '2025-01-01'}, '22023'),                          # sem etapa
    ({'etapa_id': 'nova', 'numero': '1', 'data': '2025-01-01'}, 'P0002'),      # etapa inexistente
    ({'etapa_id': 'x', 'numero': '1', 'data': '2025-01-01'}, '22023'),
    ({'etapa_id': 'E', 'numero': ' ', 'data': '2025-01-01'}, '22023'),
    ({'etapa_id': 'E', 'numero': 'x' * 41, 'data': '2025-01-01'}, '22023'),
    ({'etapa_id': 'E', 'numero': '1'}, '22023'),                                # sem data
    ({'etapa_id': 'E', 'numero': '1', 'data': '2025-13-01'}, '22023'),
    ({'etapa_id': 'E', 'numero': '1', 'data': '2025-01-01', 'prazo_dias': 1.5}, '22023'),
    ({'etapa_id': 'E', 'numero': '1', 'data': '2025-01-01', 'valor': '10'}, '22023'),
    ({'etapa_id': 'E', 'numero': '1', 'data': '2025-01-01', 'descricao': 'x' * 301}, '22023'),
    ({'id': 'novo', 'numero': '1'}, 'P0002'),                                  # aditivo inexistente
])
def test_validacoes_do_aditivo(cenario, dados, codigo):
    c = cenario
    tornar_admin(c, c.sem_obra)
    e = criar_etapa(c)
    troca = {'E': e['id'], 'nova': str(uuid.uuid4()), 'novo': str(uuid.uuid4())}
    dados = {k: troca.get(v, v) if isinstance(v, str) else v for k, v in dados.items()}
    with pytest.raises(errors.Error) as exc:
        salvar_aditivo(c, dados)
    assert estado(exc) == codigo
    assert obter_etapa(c, e['id'])['aditivos'] == []


def test_aditivo_nao_muda_de_etapa(cenario):
    c = cenario
    tornar_admin(c, c.sem_obra)
    e, outra = criar_etapa(c), criar_etapa(c)
    a = salvar_aditivo(c, {'etapa_id': e['id'], 'numero': '1', 'data': '2025-01-01'})
    with pytest.raises(errors.InvalidParameterValue):
        salvar_aditivo(c, {'id': a['id'], 'etapa_id': outra['id']})


# --- Responsáveis ----------------------------------------------------------------------------------

def definir_responsaveis(c, etapa, lista, usuario=None):
    return rpc(c, usuario or c.sem_obra, 'select public.admin_definir_responsaveis(%s, %s::jsonb)',
               (etapa, json.dumps(lista)))


def test_responsaveis(cenario):
    c = cenario
    tornar_admin(c, c.sem_obra)
    su(c, "update public.usuario set nome_exibicao = 'CP PATRICIO' where id = %s", (c.gestor_b,))
    r = definir_responsaveis(c, c.etapa, [
        {'usuario_id': str(c.gestor_b), 'funcao': ' Fiscal do contrato '},
        {'usuario_id': str(c.equipe_a), 'funcao': '  '},
        {'usuario_id': str(c.gestor_a)},
    ])
    assert r == [
        {'usuario_id': str(c.gestor_b), 'nome': 'Usuário 2', 'nome_exibicao': 'CP PATRICIO',
         'funcao': 'Fiscal do contrato', 'ordem': 1},
        {'usuario_id': str(c.equipe_a), 'nome': 'Usuário 1', 'nome_exibicao': None, 'funcao': 'Fiscal', 'ordem': 2},
        {'usuario_id': str(c.gestor_a), 'nome': 'Usuário 0', 'nome_exibicao': None, 'funcao': 'Fiscal', 'ordem': 3},
    ]
    o = obter_etapa(c)
    assert o['responsaveis'] == r and 'responsaveis' not in o['faltando']
    # substitui todos, na nova ordem
    r = definir_responsaveis(c, c.etapa, [{'usuario_id': str(c.gestor_a), 'funcao': 'Gestor'},
                                          {'usuario_id': str(c.gestor_b)}])
    assert [(x['usuario_id'], x['funcao'], x['ordem']) for x in r] == [
        (str(c.gestor_a), 'Gestor', 1), (str(c.gestor_b), 'Fiscal', 2)]
    assert definir_responsaveis(c, c.etapa, []) == []
    assert 'responsaveis' in obter_etapa(c)['faltando']


@pytest.mark.parametrize('lista,codigo', [
    ('repetido', '22023'), ('inexistente', 'P0002'), ([{'usuario_id': 'x'}], '22023'), ([1], '22023'),
    ({'usuario_id': 'x'}, '22023'), ('funcao_longa', '22023'),
])
def test_responsaveis_validacoes(cenario, lista, codigo):
    c = cenario
    tornar_admin(c, c.sem_obra)
    definir_responsaveis(c, c.etapa, [{'usuario_id': str(c.gestor_a)}])
    lista = {
        'repetido': [{'usuario_id': str(c.gestor_b)}, {'usuario_id': str(c.gestor_b)}],
        'inexistente': [{'usuario_id': str(c.gestor_b)}, {'usuario_id': str(uuid.uuid4())}],
        'funcao_longa': [{'usuario_id': str(c.gestor_b), 'funcao': 'x' * 61}],
    }.get(lista, lista) if isinstance(lista, str) else lista
    with pytest.raises(errors.Error) as exc:
        definir_responsaveis(c, c.etapa, lista)
    assert estado(exc) == codigo
    # nada mudou
    assert [x['usuario_id'] for x in obter_etapa(c)['responsaveis']] == [str(c.gestor_a)]


def test_responsaveis_etapa_inexistente(cenario):
    c = cenario
    tornar_admin(c, c.sem_obra)
    with pytest.raises(errors.NoDataFound):
        definir_responsaveis(c, uuid.uuid4(), [])


# --- Pessoas e nome de exibição --------------------------------------------------------------------

@pytest.mark.parametrize('entrada,saida', [
    ('  cp   patrício ', 'CP PATRÍCIO'), ('Sgt\tSilva\nJr', 'SGT SILVA JR'), ('ção', 'ÇÃO'), (None, None),
    ('   ', None), ('', None), ('x' * 60, 'X' * 60),
])
def test_definir_nome_exibicao(cenario, entrada, saida):
    c = cenario
    tornar_admin(c, c.sem_obra)
    su(c, "update public.usuario set nome_exibicao = 'ANTIGO' where id = %s", (c.equipe_a,))
    r = rpc(c, c.sem_obra, 'select public.admin_definir_nome_exibicao(%s, %s)', (c.equipe_a, entrada))
    assert r == {'id': str(c.equipe_a), 'nome': 'Usuário 1', 'nome_exibicao': saida}
    assert su(c, 'select nome_exibicao from public.usuario where id = %s', (c.equipe_a,)) == [(saida,)]


def test_nome_exibicao_validacoes_e_so_admin(cenario):
    c = cenario
    definir = 'select public.admin_definir_nome_exibicao(%s, %s)'
    with pytest.raises(errors.InsufficientPrivilege):
        rpc(c, c.gestor_a, definir, (c.gestor_a, 'EU'))
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, definir, (c.gestor_a, 'EU'), papel='anon')
    tornar_admin(c, c.sem_obra)
    with pytest.raises(errors.InvalidParameterValue):
        rpc(c, c.sem_obra, definir, (c.gestor_a, 'x' * 61))
    with pytest.raises(errors.NoDataFound):
        rpc(c, c.sem_obra, definir, (uuid.uuid4(), 'X'))
    # o usuário não grava a coluna direto
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, "update public.usuario set nome_exibicao = 'EU' where id = %s", (c.gestor_a,), usuario=c.gestor_a)


def test_upsert_do_login_nao_mexe_no_nome_de_exibicao(cenario):
    """auth-telegram: upsert (PostgREST, on conflict id) só com id, telegram_id, nome, username e atualizado_em."""
    c = cenario
    su(c, "update public.usuario set nome_exibicao = 'CP PATRICIO' where id = %s", (c.equipe_a,))
    tg = su(c, 'select telegram_id from public.usuario where id = %s', (c.equipe_a,))[0][0]
    su(c, 'insert into public.usuario (id, telegram_id, nome, username, atualizado_em) values (%s, %s, %s, %s, now()) '
          'on conflict (id) do update set telegram_id = excluded.telegram_id, nome = excluded.nome, '
          'username = excluded.username, atualizado_em = excluded.atualizado_em',
       (c.equipe_a, tg, 'Novo Nome', 'novo'))
    assert su(c, 'select nome, username, nome_exibicao from public.usuario where id = %s', (c.equipe_a,)) == [
        ('Novo Nome', 'novo', 'CP PATRICIO')]


def test_listar_pessoas(cenario):
    c = cenario
    tornar_admin(c, c.sem_obra)
    su(c, "update public.usuario set nome_exibicao = 'AAA PRIMEIRO' where id = %s", (c.gestor_b,))
    lista = rpc(c, c.sem_obra, 'select public.admin_listar_pessoas()')
    por_id = {x['id']: x for x in lista}
    obra_a = su(c, 'select slug, nome from public.obra where id = %s', (c.obra_a,))[0]
    etapa_nome = su(c, 'select nome from public.etapa where id = %s', (c.etapa,))[0][0]
    assert por_id[str(c.equipe_a)] == {
        'id': str(c.equipe_a), 'nome': 'Usuário 1', 'nome_exibicao': None, 'username': None,
        'telegram_id': su(c, 'select telegram_id from public.usuario where id = %s', (c.equipe_a,))[0][0],
        'eh_admin': False,
        'participacoes': [{'obra_slug': obra_a[0], 'obra_nome': obra_a[1], 'etapa_nome': etapa_nome,
                           'papel': 'equipe'}]}
    assert por_id[str(c.sem_obra)]['eh_admin'] is True and por_id[str(c.sem_obra)]['participacoes'] == []
    assert por_id[str(c.gestor_b)]['nome_exibicao'] == 'AAA PRIMEIRO'
    # ordem por coalesce(nome_exibicao, nome), como o banco ordena
    esperado = [r[0] for r in su(c, 'select id::text from public.usuario order by coalesce(nome_exibicao, nome), id')]
    assert [x['id'] for x in lista] == esperado
    with pytest.raises(errors.InsufficientPrivilege):
        rpc(c, c.gestor_a, 'select public.admin_listar_pessoas()')


# --- Observações ------------------------------------------------------------------------------------

def salvar_obs(c, usuario, **dados):
    return rpc(c, usuario, 'select public.salvar_observacao(%s::jsonb)', (json.dumps(dados, default=str),))


def obs_do_dia(c, usuario, obra, dia=None):
    return rpc(c, usuario, 'select public.observacoes_do_dia(%s, %s)', (obra, dia))


def instante_passado(dias=10, hora=2, minuto=30):
    """Um instante em UTC de alguns dias atrás (de madrugada: o dia local muda com o fuso)."""
    d = datetime.now(timezone.utc).date() - timedelta(days=dias)
    return datetime(d.year, d.month, d.day, hora, minuto, tzinfo=timezone.utc)


def test_salvar_observacao_idempotente_e_edicao_do_autor(cenario):
    c = cenario
    su(c, "update public.etapa set fuso = 'America/Fortaleza' where id = %s", (c.etapa,))
    su(c, "update public.usuario set nome_exibicao = 'SGT SILVA' where id = %s", (c.equipe_a,))
    oid, quando = str(uuid.uuid4()), instante_passado()
    dados = {'id': oid, 'obra_id': str(c.obra_a), 'texto': '  Concretagem da laje  ', 'escrito_em': quando.isoformat()}
    r = salvar_obs(c, c.equipe_a, **dados)
    dia = (quando - timedelta(hours=3)).date()
    assert r['id'] == oid and r['obra_id'] == str(c.obra_a) and r['data'] == dia.isoformat()
    assert r['texto'] == 'Concretagem da laje' and r['editado_em'] is None
    assert datetime.fromisoformat(r['escrito_em']) == quando
    assert r['autor'] == {'id': str(c.equipe_a), 'nome': 'SGT SILVA'}
    assert set(r) == {'id', 'obra_id', 'data', 'texto', 'escrito_em', 'editado_em', 'autor'}
    # reenvio igual (fila sem sinal): idempotente
    assert salvar_obs(c, c.equipe_a, **dados) == r
    assert su(c, 'select count(*) from public.observacao where id = %s', (oid,)) == [(1,)]
    # edição pelo autor: só o texto muda
    ed = salvar_obs(c, c.equipe_a, **{**dados, 'texto': 'Laje concretada', 'obra_id': str(c.obra_b),
                                      'escrito_em': datetime.now(timezone.utc).isoformat()})
    assert (ed['texto'], ed['obra_id'], ed['data'], ed['escrito_em']) == (
        'Laje concretada', str(c.obra_a), r['data'], r['escrito_em'])
    assert ed['editado_em'] is not None
    # outro participante não edita
    with pytest.raises(errors.InsufficientPrivilege):
        salvar_obs(c, c.gestor_a, **{**dados, 'texto': 'Outro texto'})
    assert su(c, 'select texto, autor_id from public.observacao where id = %s', (oid,)) == [
        ('Laje concretada', c.equipe_a)]


def test_observacao_data_no_fuso_da_etapa(cenario):
    c = cenario
    quando = instante_passado(hora=2, minuto=30)  # 23:30 do dia anterior em Fortaleza; 00:30 em Noronha
    for fuso, horas in (('America/Fortaleza', -3), ('America/Noronha', -2), ('America/Rio_Branco', -5)):
        su(c, 'update public.etapa set fuso = %s where id = %s', (fuso, c.etapa))
        r = salvar_obs(c, c.gestor_a, id=str(uuid.uuid4()), obra_id=str(c.obra_a), texto=fuso,
                       escrito_em=quando.isoformat())
        assert r['data'] == (quando + timedelta(hours=horas)).date().isoformat(), fuso
        assert fuso in [x['texto'] for x in obs_do_dia(c, c.gestor_a, c.obra_a, r['data'])]


def test_observacoes_do_dia(cenario):
    c = cenario
    su(c, "update public.etapa set fuso = 'America/Fortaleza' where id = %s", (c.etapa,))
    agora = datetime.now(timezone.utc)
    hoje = agora.astimezone(ZoneInfo('America/Fortaleza')).date()
    ids = []
    for usuario, segundos in ((c.gestor_a, 2), (c.equipe_a, 1)):
        oid = str(uuid.uuid4())
        ids.append(oid)
        salvar_obs(c, usuario, id=oid, obra_id=str(c.obra_a), texto=f'Obs {segundos}',
                   escrito_em=(agora - timedelta(seconds=segundos)).isoformat())
    lista = obs_do_dia(c, c.equipe_a, c.obra_a)  # null = hoje no fuso da etapa
    assert [x['id'] for x in lista] == ids  # por escrito_em
    assert [x['minha'] for x in lista] == [False, True]
    assert all(x['data'] == hoje.isoformat() and x['travada'] is False for x in lista)
    assert set(lista[0]) == {'id', 'data', 'texto', 'escrito_em', 'editado_em', 'autor', 'minha', 'travada'}
    assert lista[0]['autor'] == {'id': str(c.gestor_a), 'nome': 'Usuário 0'}
    assert obs_do_dia(c, c.equipe_a, c.obra_a, hoje.isoformat()) == lista
    assert obs_do_dia(c, c.equipe_a, c.obra_a, (hoje - timedelta(days=1)).isoformat()) == []


def test_outra_obra_nao_le_nem_grava(cenario):
    c = cenario
    oid = str(uuid.uuid4())
    salvar_obs(c, c.equipe_a, id=oid, obra_id=str(c.obra_a), texto='Só da obra A',
               escrito_em=instante_passado().isoformat())
    with pytest.raises(errors.InsufficientPrivilege):
        obs_do_dia(c, c.gestor_b, c.obra_a)
    with pytest.raises(errors.InsufficientPrivilege):
        salvar_obs(c, c.gestor_b, id=str(uuid.uuid4()), obra_id=str(c.obra_a), texto='x',
                   escrito_em=instante_passado().isoformat())
    assert sql(c, 'select count(*) from public.observacao where id = %s', (oid,), usuario=c.gestor_b) == [(0,)]
    assert sql(c, 'select count(*) from public.observacao where id = %s', (oid,), usuario=c.gestor_a) == [(1,)]
    tornar_admin(c, c.sem_obra)
    assert sql(c, 'select count(*) from public.observacao where id = %s', (oid,), usuario=c.sem_obra) == [(1,)]
    with pytest.raises(errors.InsufficientPrivilege):  # o admin lê pela tabela, não pela RPC do Mini App
        obs_do_dia(c, c.sem_obra, c.obra_a)
    # obra arquivada: nem o participante
    su(c, 'update public.obra set arquivada_em = now() where id = %s', (c.obra_a,))
    with pytest.raises(errors.InsufficientPrivilege):
        obs_do_dia(c, c.equipe_a, c.obra_a)
    with pytest.raises(errors.InsufficientPrivilege):
        salvar_obs(c, c.equipe_a, id=oid, obra_id=str(c.obra_a), texto='Outro',
                   escrito_em=instante_passado().isoformat())
    assert sql(c, 'select count(*) from public.observacao where id = %s', (oid,), usuario=c.equipe_a) == [(0,)]


def test_dia_travado_depois_do_boletim(cenario):
    c = cenario
    su(c, "update public.etapa set fuso = 'America/Fortaleza' where id = %s", (c.etapa,))
    quando = instante_passado(hora=15)
    dia = quando.date()
    oid = str(uuid.uuid4())
    salvar_obs(c, c.equipe_a, id=oid, obra_id=str(c.obra_a), texto='Antes', escrito_em=quando.isoformat())
    boletim(c, c.etapa, dia)
    msg = f'O boletim de {dia:%d/%m/%Y} já foi emitido; a correção é feita por retificação'
    with pytest.raises(errors.InvalidParameterValue, match=msg):
        salvar_obs(c, c.equipe_a, id=oid, obra_id=str(c.obra_a), texto='Depois', escrito_em=quando.isoformat())
    with pytest.raises(errors.InvalidParameterValue, match=msg):
        salvar_obs(c, c.equipe_a, id=str(uuid.uuid4()), obra_id=str(c.obra_a), texto='Nova',
                   escrito_em=quando.isoformat())
    with pytest.raises(errors.InvalidParameterValue, match=msg):
        rpc(c, c.equipe_a, 'select public.excluir_observacao(%s)', (oid,))
    # o reenvio igual continua idempotente (a fila não trava)
    assert salvar_obs(c, c.equipe_a, id=oid, obra_id=str(c.obra_a), texto='Antes',
                      escrito_em=quando.isoformat())['texto'] == 'Antes'
    assert [x['travada'] for x in obs_do_dia(c, c.equipe_a, c.obra_a, dia.isoformat())] == [True]
    # outro dia segue aberto
    outro = quando - timedelta(days=1)
    salvar_obs(c, c.equipe_a, id=str(uuid.uuid4()), obra_id=str(c.obra_a), texto='Ontem',
               escrito_em=outro.isoformat())


def test_excluir_observacao(cenario):
    c = cenario
    oid = str(uuid.uuid4())
    salvar_obs(c, c.equipe_a, id=oid, obra_id=str(c.obra_a), texto='Apagar',
               escrito_em=instante_passado().isoformat())
    with pytest.raises(errors.InsufficientPrivilege):
        rpc(c, c.gestor_a, 'select public.excluir_observacao(%s)', (oid,))
    rpc(c, c.equipe_a, 'select public.excluir_observacao(%s)', (oid,))
    assert su(c, 'select count(*) from public.observacao where id = %s', (oid,)) == [(0,)]
    rpc(c, c.equipe_a, 'select public.excluir_observacao(%s)', (oid,))  # de novo: sem erro
    with pytest.raises(errors.Error) as e:
        sql(c, 'select public.excluir_observacao(%s)', (oid,))  # sem sessão
    assert estado(e) == '28000'


@pytest.mark.parametrize('mudanca,codigo', [
    ({'texto': '   '}, '22023'), ({'texto': 'x' * 1001}, '22023'), ({'texto': 5}, '22023'),
    ({'id': 'nao-uuid'}, '22023'), ({'obra_id': None}, '22023'), ({'escrito_em': 'ontem'}, '22023'),
    ({'escrito_em': None}, '22023'), ({'escrito_em': 'futuro'}, '22023'), ({'obra_id': 'outra'}, '42501'),
])
def test_salvar_observacao_validacoes(cenario, mudanca, codigo):
    c = cenario
    dados = {'id': str(uuid.uuid4()), 'obra_id': str(c.obra_a), 'texto': 'Ok',
             'escrito_em': instante_passado().isoformat()}
    dados.update(mudanca)
    if dados['escrito_em'] == 'futuro':
        dados['escrito_em'] = (datetime.now(timezone.utc) + timedelta(minutes=6)).isoformat()
    if dados['obra_id'] == 'outra':
        dados['obra_id'] = str(c.obra_b)
    with pytest.raises(errors.Error) as e:
        salvar_obs(c, c.equipe_a, **dados)
    assert estado(e) == codigo
    # até 5 minutos adiantado passa (relógio do aparelho)
    salvar_obs(c, c.equipe_a, id=str(uuid.uuid4()), obra_id=str(c.obra_a), texto='Ok',
               escrito_em=(datetime.now(timezone.utc) + timedelta(minutes=4)).isoformat())


def test_observacao_sem_sessao_e_anon(cenario):
    c = cenario
    with pytest.raises(errors.Error) as e:
        sql(c, 'select public.observacoes_do_dia(%s)', (c.obra_a,))
    assert estado(e) == '28000'
    for comando, params in (('select public.salvar_observacao(%s::jsonb)', ('{}',)),
                            ('select public.excluir_observacao(%s)', (uuid.uuid4(),)),
                            ('select public.observacoes_do_dia(%s)', (c.obra_a,))):
        with pytest.raises(errors.InsufficientPrivilege):
            sql(c, comando, params, papel='anon')


# --- Organização: cabeçalho ------------------------------------------------------------------------

@pytest.fixture
def org(cenario):
    yield cenario
    su(cenario, "update public.organizacao set nome = 'CO-FZ', logo_path = null, cabecalho = %s", (CABECALHO,))


def test_organizacao_com_cabecalho(org):
    c = org
    assert sql(c, 'select public.organizacao()', papel='anon')[0][0]['cabecalho'] == CABECALHO
    tornar_admin(c, c.sem_obra)
    salvar = 'select public.admin_salvar_organizacao(%s::jsonb)'
    r = rpc(c, c.sem_obra, salvar, (json.dumps({'cabecalho': ['  MINISTÉRIO DA DEFESA ', 'COMANDO DA AERONÁUTICA']}),))
    assert r['cabecalho'] == ['MINISTÉRIO DA DEFESA', 'COMANDO DA AERONÁUTICA']
    assert rpc(c, c.equipe_a, 'select public.organizacao()')['cabecalho'] == r['cabecalho']
    # ausente mantém; [] limpa
    assert rpc(c, c.sem_obra, salvar, (json.dumps({'nome': 'CO-FZ'}),))['cabecalho'] == r['cabecalho']
    assert rpc(c, c.sem_obra, salvar, (json.dumps({'cabecalho': []}),)) == {
        'nome': 'CO-FZ', 'logo_path': None, 'cabecalho': []}
    assert sql(c, 'select public.organizacao()', papel='anon')[0][0]['cabecalho'] == []
    for invalido in (['a'] * 5, [''], ['  '], ['x' * 101], [1], 'TEXTO', None, {'a': 1}):
        with pytest.raises(errors.InvalidParameterValue):
            rpc(c, c.sem_obra, salvar, (json.dumps({'cabecalho': invalido}),))
    rpc(c, c.sem_obra, salvar, (json.dumps({'cabecalho': ['x' * 100] * 4}),))


# --- RLS das tabelas novas e bucket boletins ---------------------------------------------------------

def visiveis(c, usuario, tabela, coluna, valor):
    return sql(c, f'select count(*) from public.{tabela} where {coluna} = %s', (valor,), usuario=usuario)[0][0]


def test_rls_das_tabelas_da_etapa(cenario):
    c = cenario
    su(c, "insert into public.etapa_aditivo (etapa_id, numero, data) values (%s, '1', '2025-01-01')", (c.etapa,))
    su(c, 'insert into public.etapa_responsavel (etapa_id, usuario_id) values (%s, %s)', (c.etapa, c.gestor_a))
    boletim(c, c.etapa, '2025-01-01')
    tabelas = ('etapa_aditivo', 'etapa_responsavel', 'boletim')
    for t in tabelas:
        assert visiveis(c, c.equipe_a, t, 'etapa_id', c.etapa) == 1, t
        assert visiveis(c, c.gestor_b, t, 'etapa_id', c.etapa) == 1, t  # outra obra da mesma etapa
        assert visiveis(c, c.sem_obra, t, 'etapa_id', c.etapa) == 0, t
        with pytest.raises(errors.InsufficientPrivilege):
            sql(c, f'select * from public.{t}', papel='anon')
        with pytest.raises(errors.InsufficientPrivilege):
            sql(c, f'delete from public.{t}', usuario=c.equipe_a)
        with pytest.raises(errors.InsufficientPrivilege):
            sql(c, f'update public.{t} set etapa_id = etapa_id', usuario=c.equipe_a)
    tornar_admin(c, c.sem_obra)
    for t in tabelas:
        assert visiveis(c, c.sem_obra, t, 'etapa_id', c.etapa) == 1, t
        with pytest.raises(errors.InsufficientPrivilege):  # nem o admin grava direto
            sql(c, f'delete from public.{t}', usuario=c.sem_obra)
    # etapa arquivada: participantes deixam de ver
    su(c, 'update public.etapa set arquivada_em = now() where id = %s', (c.etapa,))
    assert all(visiveis(c, c.equipe_a, t, 'etapa_id', c.etapa) == 0 for t in tabelas)
    # service_role grava (emissão)
    sql(c, "update public.boletim set pdf_path = null where etapa_id = %s", (c.etapa,), papel='service_role')


def test_rls_das_observacoes(cenario):
    c = cenario
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, "insert into public.observacao (id, obra_id, autor_id, data, texto, escrito_em) "
               "values (%s, %s, %s, current_date, 'x', now())", (uuid.uuid4(), c.obra_a, c.equipe_a),
            usuario=c.equipe_a)
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, "update public.observacao set texto = 'x'", usuario=c.equipe_a)
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, 'select * from public.observacao', papel='anon')


def test_bucket_boletins(cenario):
    c = cenario
    nome = f'{c.etapa}/BA2261111COFZ.pdf'
    su(c, "insert into storage.objects (bucket_id, name) values ('boletins', %s)", (nome,))
    ler = "select count(*) from storage.objects where bucket_id = 'boletins' and name = %s"
    assert sql(c, ler, (nome,), usuario=c.equipe_a) == [(1,)]
    assert sql(c, ler, (nome,), usuario=c.gestor_b) == [(1,)]
    assert sql(c, ler, (nome,), usuario=c.sem_obra) == [(0,)]
    tornar_admin(c, c.sem_obra)
    assert sql(c, ler, (nome,), usuario=c.sem_obra) == [(1,)]
    for u in (c.equipe_a, c.sem_obra):  # escrita só service_role
        with pytest.raises(errors.InsufficientPrivilege):
            sql(c, "insert into storage.objects (bucket_id, name, owner_id) values ('boletins', %s, 'x')",
                (f'{c.etapa}/{uuid.uuid4().hex}.pdf',), usuario=u)
        assert sql(c, "update storage.objects set owner_id = 'y' where bucket_id = 'boletins' and name = %s "
                      'returning 1', (nome,), usuario=u) == []
        assert sql(c, "delete from storage.objects where bucket_id = 'boletins' and name = %s returning 1",
                   (nome,), usuario=u) == []
    sql(c, "delete from storage.objects where bucket_id = 'boletins' and name = %s", (nome,), papel='service_role')
    assert su(c, ler, (nome,)) == [(0,)]


# --- Acesso às RPCs novas -----------------------------------------------------------------------------

RPCS_ADMIN = [
    'select public.admin_listar_pessoas()',
    "select public.admin_definir_nome_exibicao('00000000-0000-0000-0000-000000000000', 'X')",
    "select public.admin_obter_etapa('x')",
    "select public.admin_salvar_aditivo('{}'::jsonb)",
    "select public.admin_remover_aditivo('00000000-0000-0000-0000-000000000000')",
    "select public.admin_definir_responsaveis('00000000-0000-0000-0000-000000000000', '[]'::jsonb)",
]


@pytest.mark.parametrize('comando', RPCS_ADMIN)
def test_rpcs_novas_so_para_admin(cenario, comando):
    c = cenario
    tornar_admin(c, c.gestor_b)
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, comando, usuario=c.gestor_a)
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, comando, papel='anon')


# --- Exclusão de etapa com boletim --------------------------------------------------------------------

def test_excluir_etapa_com_boletim(cenario):
    c = cenario
    tornar_admin(c, c.sem_obra)
    e = criar_etapa(c, nome='Etapa com boletim')
    salvar_aditivo(c, {'etapa_id': e['id'], 'numero': '1', 'data': '2025-01-01'})
    definir_responsaveis(c, e['id'], [{'usuario_id': str(c.gestor_a)}])
    boletim(c, e['id'], '2025-01-01')
    boletim(c, e['id'], '2025-01-01', 1)
    # por outro caminho o boletim protege a etapa
    with pytest.raises(errors.ForeignKeyViolation):
        su(c, 'delete from public.etapa where id = %s', (e['id'],))
    r = rpc(c, c.sem_obra, 'select public.admin_excluir_etapa(%s, %s)', (e['slug'], 'Etapa com boletim'))
    assert r['etapa_id'] == e['id']
    for t in ('etapa', 'boletim', 'etapa_aditivo', 'etapa_responsavel'):
        coluna = 'id' if t == 'etapa' else 'etapa_id'
        assert su(c, f'select count(*) from public.{t} where {coluna} = %s', (e['id'],)) == [(0,)], t


def test_excluir_etapa_com_obras_e_observacoes(cenario):
    c = cenario
    tornar_admin(c, c.sem_obra)
    salvar_obs(c, c.equipe_a, id=str(uuid.uuid4()), obra_id=str(c.obra_a), texto='x',
               escrito_em=instante_passado().isoformat())
    boletim(c, c.etapa, '2025-01-01')
    nome = su(c, 'select nome from public.etapa where id = %s', (c.etapa,))[0][0]
    rpc(c, c.sem_obra, 'select public.admin_excluir_etapa(%s, %s)', (slug_etapa(c), nome))
    assert su(c, 'select count(*) from public.observacao where obra_id = %s', (c.obra_a,)) == [(0,)]
    assert su(c, 'select count(*) from public.boletim where etapa_id = %s', (c.etapa,)) == [(0,)]
