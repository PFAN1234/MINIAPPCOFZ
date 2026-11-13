"""Testes da migration da equipe de serviço (20261116090000_equipe_servico.sql).

Contrato: docs/contrato-servico.md ("Parte A"). Reaproveita os auxiliares de test_boletim_emissao.py.
"""
import json
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

psycopg = pytest.importorskip('psycopg', reason='psycopg não instalado')
from psycopg import errors  # noqa: E402

from test_boletim_emissao import (  # noqa: E402,F401
    DIA, FUSO, limpo, preparar_etapa, rpc, snapshot, sql, srv, su,
)

LAT, LON = -9.97, -67.81  # coordenada da etapa
UTC = timezone.utc


def local(c, dia, hora, minuto=0):
    """Instante (UTC) da hora local de `dia` no fuso do teste (Rio Branco, UTC−5)."""
    return datetime(dia.year, dia.month, dia.day, hora, minuto, tzinfo=UTC) + timedelta(hours=5)


def preparar(c, lat=LAT, lon=LON):
    preparar_etapa(c)
    su(c, 'update public.etapa set latitude = %s, longitude = %s where id = %s', (lat, lon, c.etapa))


def deslocado(metros_norte):
    return LAT + metros_norte / 111195.0


def checkin(c, usuario, lat=LAT, lon=LON, etapa=None, precisao=None):
    return rpc(c, usuario, 'select public.fazer_checkin(%s, %s, %s, %s)', (etapa or c.etapa, lat, lon, precisao))


def checkout(c, usuario):
    return rpc(c, usuario, 'select public.fazer_checkout()')


def equipe(c, usuario, etapa=None):
    return rpc(c, usuario, 'select public.equipe_servico(%s)', (etapa or c.etapa,))


def servicos(c, usuario=None):
    q = 'select id, entrada_em, saida_em, saida_automatica from public.servico where etapa_id = %s'
    p = [c.etapa]
    if usuario:
        q += ' and usuario_id = %s'
        p.append(usuario)
    return su(c, q + ' order by entrada_em', p)


def erro(c, usuario, comando, params, tipo):
    with pytest.raises(tipo) as e:
        sql(c, comando, params, usuario=usuario)
    return str(e.value)


def publicacoes(c, etapa_servico=None):
    return su(c, 'select p.servico_evento, p.estado, p.obra_id from public.publicacao_telegram p '
                 'join public.servico s on s.id = p.servico_id where s.etapa_id = %s order by p.id', (c.etapa,))


@pytest.fixture(autouse=True)
def limpo_servico(dsn):
    from conftest import sessao
    with sessao(dsn, papel=None) as cur:
        cur.execute('delete from public.servico')


# --- distância (função) -------------------------------------------------------------------------

def test_distancia_haversine(cenario):
    d = su(cenario, 'select privado.distancia_m(0, 0, 0, 1)')[0][0]
    assert abs(d - 111194.9) < 1
    assert su(cenario, 'select privado.distancia_m(-10, -67, -10, -67)')[0][0] == 0


# --- etapas_inicio e equipe_servico -------------------------------------------------------------

def test_etapas_inicio(cenario):
    c = cenario
    preparar(c)
    linhas = sql(c, 'select id, participa from public.etapas_inicio()', usuario=c.gestor_a)
    por_id = {l[0]: l[1] for l in linhas}
    assert por_id[c.etapa] is True
    assert sql(c, 'select participa from public.etapas_inicio() where id = %s', (c.etapa,),
               usuario=c.sem_obra)[0][0] is False
    su(c, 'update public.etapa set arquivada_em = now() where id = %s', (c.etapa,))
    assert not sql(c, 'select 1 from public.etapas_inicio() where id = %s', (c.etapa,), usuario=c.gestor_a)


def test_equipe_para_nao_participante_e_erros(cenario):
    c = cenario
    preparar(c)
    r = equipe(c, c.sem_obra)
    assert r['participa'] is False and r['tem_localizacao'] is True
    assert r['meu_servico'] is None and r['equipe'] == []
    assert 'Etapa não encontrada' in erro(c, c.sem_obra, 'select public.equipe_servico(%s)', (uuid.uuid4(),),
                                          errors.NoDataFound)
    su(c, 'update public.etapa set arquivada_em = now() where id = %s', (c.etapa,))
    erro(c, c.gestor_a, 'select public.equipe_servico(%s)', (c.etapa,), errors.NoDataFound)


def test_equipe_sem_localizacao(cenario):
    c = cenario
    preparar_etapa(c)
    assert equipe(c, c.gestor_a)['tem_localizacao'] is False


# --- check-in -----------------------------------------------------------------------------------

def test_checkin_sucesso_e_publicacao(cenario):
    c = cenario
    preparar(c)
    r = checkin(c, c.gestor_a, deslocado(300), precisao=12.5)
    assert r['participa'] is True
    assert r['meu_servico']['etapa_id'] == str(c.etapa) and r['meu_servico']['etapa_nome']
    assert len(r['equipe']) == 1 and r['equipe'][0]['eu'] is True and r['equipe'][0]['saida_em'] is None
    s = su(c, 'select distancia_m, precisao_m from public.servico where usuario_id = %s', (c.gestor_a,))[0]
    assert 290 < s[0] < 310 and s[1] == 12.5
    assert publicacoes(c) == [('entrada', 'pendente', None)]
    # Outro participante vê o serviço, mas "eu" é falso e meu_servico é nulo.
    r2 = equipe(c, c.equipe_a)
    assert r2['meu_servico'] is None and r2['equipe'][0]['eu'] is False
    # Qualquer usuário autenticado lê.
    assert len(equipe(c, c.sem_obra)['equipe']) == 1


def test_checkin_erros_na_ordem(cenario):
    c = cenario
    preparar(c)
    cmd = 'select public.fazer_checkin(%s, %s, %s)'
    # etapa inexistente
    assert 'Etapa não encontrada' in erro(c, c.gestor_a, cmd, (uuid.uuid4(), LAT, LON), errors.NoDataFound)
    # não participa
    e = erro(c, c.sem_obra, cmd, (c.etapa, LAT, LON), errors.InsufficientPrivilege)
    assert 'Você não participa desta etapa' in e
    # localização inválida
    for lat, lon in ((None, LON), (LAT, None), (91, LON), (LAT, 181), (-91, LON), (LAT, -181)):
        assert 'Localização inválida' in erro(c, c.gestor_a, cmd, (c.etapa, lat, lon), errors.InvalidParameterValue)
    assert not servicos(c)
    # etapa sem coordenadas
    su(c, 'update public.etapa set latitude = null, longitude = null where id = %s', (c.etapa,))
    e = erro(c, c.gestor_a, cmd, (c.etapa, LAT, LON), errors.RaiseException)
    assert 'localização da etapa não está cadastrada' in e
    # localização inválida vem antes da etapa sem coordenadas
    erro(c, c.gestor_a, cmd, (c.etapa, 100, LON), errors.InvalidParameterValue)
    assert not servicos(c)


def test_checkin_etapa_arquivada(cenario):
    c = cenario
    preparar(c)
    su(c, 'update public.etapa set arquivada_em = now() where id = %s', (c.etapa,))
    erro(c, c.gestor_a, 'select public.fazer_checkin(%s, %s, %s)', (c.etapa, LAT, LON), errors.NoDataFound)


def test_checkin_longe_formata_distancia(cenario):
    c = cenario
    preparar(c)
    cmd = 'select public.fazer_checkin(%s, %s, %s)'
    e = erro(c, c.gestor_a, cmd, (c.etapa, deslocado(2300), LON), errors.RaiseException)
    assert 'Você está a 2,3 km da etapa. O check-in só vale até 1 km.' in e
    e = erro(c, c.gestor_a, cmd, (c.etapa, deslocado(1004), LON), errors.RaiseException)
    assert 'Você está a 1,0 km da etapa' in e
    assert not servicos(c)


def test_checkin_perto_no_limite(cenario):
    c = cenario
    preparar(c)
    assert checkin(c, c.gestor_a, deslocado(850))['meu_servico']
    assert checkin(c, c.equipe_a, deslocado(990))['meu_servico']


def test_um_servico_aberto_por_usuario(cenario):
    c = cenario
    preparar(c)
    checkin(c, c.gestor_a)
    e = erro(c, c.gestor_a, 'select public.fazer_checkin(%s, %s, %s)', (c.etapa, LAT, LON), errors.UniqueViolation)
    assert 'Você já está de serviço na' in e
    # em outra etapa também
    outra = uuid.uuid4()
    su(c, 'insert into public.etapa (id, slug, nome, latitude, longitude) values (%s, %s, %s, %s, %s)',
       (outra, f'o-{outra.hex[:8]}', 'Outra etapa', LAT, LON))
    ob = uuid.uuid4()
    su(c, 'insert into public.obra (id, slug, nome, etapa_id) values (%s, %s, %s, %s)',
       (ob, f'ob-{ob.hex[:8]}', 'Obra X', outra))
    su(c, 'insert into public.participacao (obra_id, usuario_id, papel) values (%s, %s, %s)',
       (ob, c.gestor_a, 'gestor'))
    assert 'Você já está de serviço na' in erro(
        c, c.gestor_a, 'select public.fazer_checkin(%s, %s, %s)', (outra, LAT, LON), errors.UniqueViolation)
    # o serviço aberto aparece em meu_servico de qualquer etapa
    assert equipe(c, c.gestor_a, etapa=outra)['meu_servico']['etapa_id'] == str(c.etapa)
    # participação só em obra arquivada não vale
    su(c, 'update public.obra set arquivada_em = now() where id = %s', (ob,))
    assert equipe(c, c.gestor_a, etapa=outra)['participa'] is False


# --- check-out ----------------------------------------------------------------------------------

def test_checkout(cenario):
    c = cenario
    preparar(c)
    assert 'Você não está de serviço' in erro(c, c.gestor_a, 'select public.fazer_checkout()', (),
                                              errors.NoDataFound)
    checkin(c, c.gestor_a)
    r = checkout(c, c.gestor_a)
    assert r['etapa_id'] == str(c.etapa) and r['meu_servico'] is None
    assert r['equipe'][0]['saida_em'] is not None and r['equipe'][0]['saida_automatica'] is False
    assert publicacoes(c) == [('entrada', 'pendente', None), ('saida', 'pendente', None)]
    erro(c, c.gestor_a, 'select public.fazer_checkout()', (), errors.NoDataFound)
    # pode fazer novo check-in depois
    assert checkin(c, c.gestor_a)['meu_servico']


def test_ordem_da_equipe(cenario):
    c = cenario
    preparar(c)
    checkin(c, c.gestor_a)
    checkin(c, c.equipe_a)
    checkout(c, c.gestor_a)
    checkin(c, c.gestor_b)
    nomes = [e['usuario_id'] for e in equipe(c, c.sem_obra)['equipe']]
    assert nomes[-1] == str(c.gestor_a)  # encerrado por último
    assert set(nomes[:2]) == {str(c.equipe_a), str(c.gestor_b)}
    assert nomes[0] == str(c.gestor_b)  # aberto mais recente primeiro


def test_saida_recente_aparece_e_antiga_some(cenario):
    c = cenario
    preparar(c)
    checkin(c, c.gestor_a)
    su(c, "update public.servico set entrada_em = now() - interval '30 hours', "
          "saida_em = now() - interval '25 hours' where usuario_id = %s", (c.gestor_a,))
    assert equipe(c, c.equipe_a)['equipe'] == []
    su(c, "update public.servico set saida_em = now() - interval '2 hours' where usuario_id = %s", (c.gestor_a,))
    assert len(equipe(c, c.equipe_a)['equipe']) == 1


# --- fechamento automático ----------------------------------------------------------------------

def test_fechamento_automatico_24h(cenario):
    c = cenario
    preparar(c)
    checkin(c, c.gestor_a)
    checkin(c, c.equipe_a)
    su(c, "update public.servico set entrada_em = now() - interval '25 hours' where usuario_id = %s", (c.gestor_a,))
    # equipe_servico fecha os vencidos; o outro continua aberto
    r = equipe(c, c.equipe_a)
    por_usuario = {e['usuario_id']: e for e in r['equipe']}
    a = por_usuario[str(c.gestor_a)]
    assert a['saida_automatica'] is True and a['saida_em'] is not None
    assert por_usuario[str(c.equipe_a)]['saida_em'] is None
    saida, entrada = su(c, 'select saida_em, entrada_em from public.servico where usuario_id = %s', (c.gestor_a,))[0]
    assert saida - entrada == timedelta(hours=24)
    # já pode fazer novo check-in e nenhuma publicação de saída foi criada
    assert checkin(c, c.gestor_a)['meu_servico']
    assert [p[0] for p in publicacoes(c)] == ['entrada', 'entrada', 'entrada']


def test_checkin_fecha_vencido_do_proprio_usuario(cenario):
    c = cenario
    preparar(c)
    checkin(c, c.gestor_a)
    su(c, "update public.servico set entrada_em = now() - interval '24 hours 1 minute'")
    assert checkin(c, c.gestor_a)['meu_servico']
    assert [s[3] for s in servicos(c, c.gestor_a)] == [True, False]


def test_fechar_servicos_vencidos_direto(cenario):
    c = cenario
    preparar(c)
    checkin(c, c.gestor_a)
    su(c, "update public.servico set entrada_em = now() - interval '23 hours'")
    su(c, 'select privado.fechar_servicos_vencidos()')
    assert servicos(c)[0][2] is None
    su(c, "update public.servico set entrada_em = now() - interval '24 hours'")
    su(c, 'select privado.fechar_servicos_vencidos()')
    assert servicos(c)[0][2] is not None and servicos(c)[0][3] is True


# --- restrições da tabela e da publicação -------------------------------------------------------

def test_constraints_da_tabela(cenario):
    c = cenario
    preparar(c)
    base = ('insert into public.servico (etapa_id, usuario_id, entrada_em, saida_em, saida_automatica, '
            'latitude, longitude, distancia_m) values (%s, %s, now(), %s, %s, 0, 0, 0)')
    with pytest.raises(errors.CheckViolation):
        su(c, base, (c.etapa, c.gestor_a, datetime.now(UTC) - timedelta(hours=1), False))
    with pytest.raises(errors.CheckViolation):
        su(c, base, (c.etapa, c.gestor_a, None, True))
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, 'select * from public.servico')
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, 'select * from public.servico', papel='anon')


def test_publicacao_unica_e_coerente(cenario):
    c = cenario
    preparar(c)
    checkin(c, c.gestor_a)
    sid = servicos(c)[0][0]
    with pytest.raises(errors.UniqueViolation):
        su(c, "insert into public.publicacao_telegram (servico_id, servico_evento) values (%s, 'entrada')", (sid,))
    with pytest.raises(errors.CheckViolation):
        su(c, "insert into public.publicacao_telegram (servico_id, servico_evento) values (%s, 'outro')", (sid,))
    with pytest.raises(errors.CheckViolation):
        su(c, 'insert into public.publicacao_telegram (servico_id) values (%s)', (sid,))
    with pytest.raises(errors.CheckViolation):
        su(c, "insert into public.publicacao_telegram (obra_id, servico_id, servico_evento) "
              "values (%s, %s, 'saida')", (c.obra_a, sid))
    # apagar o serviço leva a publicação junto
    su(c, 'delete from public.servico where id = %s', (sid,))
    assert not publicacoes(c)


def test_reivindicar_publicacoes_de_etapa_arquivada(cenario):
    c = cenario
    preparar(c)
    checkin(c, c.gestor_a)
    su(c, 'delete from public.publicacao_telegram where servico_id is null')
    su(c, 'update public.etapa set arquivada_em = now() where id = %s', (c.etapa,))
    r = srv(c, 'select count(*) from public.reivindicar_publicacoes(100) p where p.servico_id is not null')
    assert r == 0
    assert publicacoes(c)[0][1] == 'pendente'
    su(c, 'update public.etapa set arquivada_em = null where id = %s', (c.etapa,))
    srv(c, 'select count(*) from public.reivindicar_publicacoes(100)')
    assert publicacoes(c)[0][1] == 'enviando'


# --- snapshot do boletim ------------------------------------------------------------------------

def cadastrar_responsavel(c, usuario, funcao, ordem=0):
    su(c, 'insert into public.etapa_responsavel (etapa_id, usuario_id, funcao, ordem) values (%s, %s, %s, %s)',
       (c.etapa, usuario, funcao, ordem))


def nome(c, usuario):
    return su(c, 'select privado.nome_pessoa(%s)', (usuario,))[0][0]


def servico_em(c, usuario, entrada, saida=None, automatica=False):
    su(c, 'insert into public.servico (etapa_id, usuario_id, entrada_em, saida_em, saida_automatica, '
          'latitude, longitude, distancia_m) values (%s, %s, %s, %s, %s, 0, 0, 0)',
       (c.etapa, usuario, entrada, saida, automatica))


def test_snapshot_sem_checkin_usa_cadastrados(cenario):
    c = cenario
    preparar(c)
    cadastrar_responsavel(c, c.gestor_a, 'Fiscal', 1)
    cadastrar_responsavel(c, c.equipe_a, 'Engenheiro', 0)
    s = snapshot(c)
    assert s['versao'] == 1 and s['equipe_servico'] == []
    assert s['responsaveis'] == [{'nome': nome(c, c.equipe_a), 'funcao': 'Engenheiro'},
                                 {'nome': nome(c, c.gestor_a), 'funcao': 'Fiscal'}]


def test_snapshot_com_checkin_responsaveis_sao_a_equipe(cenario):
    c = cenario
    preparar(c)
    cadastrar_responsavel(c, c.gestor_a, 'Fiscal')
    cadastrar_responsavel(c, c.gestor_b, 'Engenheiro')  # não está de serviço: sai
    servico_em(c, c.equipe_a, local(c, DIA, 8), local(c, DIA, 12))
    servico_em(c, c.gestor_a, local(c, DIA, 9), local(c, DIA, 17))
    servico_em(c, c.gestor_a, local(c, DIA, 18), local(c, DIA, 20))  # mesmo usuário, 2º turno
    s = snapshot(c)
    assert s['responsaveis'] == [{'nome': nome(c, c.equipe_a), 'funcao': 'Militar de serviço'},
                                 {'nome': nome(c, c.gestor_a), 'funcao': 'Fiscal'}]
    assert [e['nome'] for e in s['equipe_servico']] == [nome(c, c.equipe_a), nome(c, c.gestor_a), nome(c, c.gestor_a)]
    primeiro = s['equipe_servico'][0]
    assert set(primeiro) == {'nome', 'entrada_em', 'saida_em', 'saida_automatica'}
    assert datetime.fromisoformat(primeiro['entrada_em']) == local(c, DIA, 8)
    assert datetime.fromisoformat(primeiro['saida_em']) == local(c, DIA, 12)
    assert primeiro['saida_automatica'] is False


def test_snapshot_dia_sem_servico_nao_inclui_outros_dias(cenario):
    c = cenario
    preparar(c)
    cadastrar_responsavel(c, c.gestor_a, 'Fiscal')
    servico_em(c, c.equipe_a, local(c, DIA - timedelta(days=3), 8), local(c, DIA - timedelta(days=3), 12))
    servico_em(c, c.equipe_a, local(c, DIA + timedelta(days=1), 0), local(c, DIA + timedelta(days=1), 3))
    s = snapshot(c)
    assert s['equipe_servico'] == []
    assert s['responsaveis'] == [{'nome': nome(c, c.gestor_a), 'funcao': 'Fiscal'}]


def test_snapshot_servico_atravessa_meia_noite(cenario):
    c = cenario
    preparar(c)
    servico_em(c, c.equipe_a, local(c, DIA, 22), local(c, DIA + timedelta(days=1), 6))
    assert len(snapshot(c, DIA)['equipe_servico']) == 1
    assert len(snapshot(c, DIA + timedelta(days=1))['equipe_servico']) == 1
    assert snapshot(c, DIA + timedelta(days=2))['equipe_servico'] == []
    assert snapshot(c, DIA - timedelta(days=1))['equipe_servico'] == []


def test_snapshot_em_servico_e_saida_automatica(cenario):
    c = cenario
    preparar(c)
    hoje = datetime.now(UTC)
    # Em serviço há 2 h: saida_em nulo.
    servico_em(c, c.equipe_a, hoje - timedelta(hours=2))
    dia_local = (hoje - timedelta(hours=5)).date()
    item = snapshot(c, dia_local)['equipe_servico'][0]
    assert item['saida_em'] is None and item['saida_automatica'] is False
    # Aberto há 30 h (vencido, ainda não fechado): saída efetiva = entrada + 24 h, automática.
    su(c, "update public.servico set entrada_em = now() - interval '30 hours'")
    entrada = su(c, 'select entrada_em from public.servico')[0][0]
    dia_entrada = (entrada - timedelta(hours=5)).date()
    item = snapshot(c, dia_entrada)['equipe_servico'][0]
    assert item['saida_automatica'] is True
    assert datetime.fromisoformat(item['saida_em']) == entrada + timedelta(hours=24)
    # Já fechado automaticamente
    su(c, 'select privado.fechar_servicos_vencidos()')
    item = snapshot(c, dia_entrada)['equipe_servico'][0]
    assert item['saida_automatica'] is True


def test_snapshot_chamadores_continuam(cenario):
    c = cenario
    preparar(c)
    servico_em(c, c.equipe_a, local(c, DIA, 8), local(c, DIA, 12))
    su(c, 'insert into public.admin_app (usuario_id) values (%s)', (c.sem_obra,))
    slug = su(c, 'select slug from public.etapa where id = %s', (c.etapa,))[0][0]
    s = rpc(c, c.sem_obra, 'select public.admin_boletim_snapshot(%s, %s)', (slug, DIA))
    assert len(s['equipe_servico']) == 1 and s['versao'] == 1
    assert 'indicadores' in s and 'obras' in s


# --- grants -------------------------------------------------------------------------------------

@pytest.mark.parametrize('chamada', [
    'select * from public.etapas_inicio()',
    "select public.equipe_servico('00000000-0000-0000-0000-000000000000')",
    "select public.fazer_checkin('00000000-0000-0000-0000-000000000000', 0, 0)",
    'select public.fazer_checkout()',
])
def test_anon_sem_execute(cenario, chamada):
    with pytest.raises(errors.InsufficientPrivilege):
        sql(cenario, chamada, papel='anon')


@pytest.mark.parametrize('chamada', [
    'select privado.fechar_servicos_vencidos()',
    'select privado.distancia_m(0, 0, 0, 0)',
    "select privado.equipe_do_dia('00000000-0000-0000-0000-000000000000', current_date)",
    "select privado.responsaveis_do_dia('00000000-0000-0000-0000-000000000000', current_date)",
    "select privado.boletim_snapshot('00000000-0000-0000-0000-000000000000', current_date)",
    "select privado.boletim_snapshot_base('00000000-0000-0000-0000-000000000000', current_date)",
    "select privado.equipe_servico_json('00000000-0000-0000-0000-000000000000')",
])
def test_privado_sem_execute(cenario, chamada):
    for papel in ('anon', 'authenticated'):
        with pytest.raises(errors.InsufficientPrivilege):
            sql(cenario, chamada, papel=papel, usuario=cenario.gestor_a)
