"""Testes da migration da emissão do boletim (20261114120000_boletim_emissao.sql).

Contrato: docs/contrato-boletim.md ("Parte 3"). Cada cenário tem uma etapa própria (`c.etapa`) com as
obras A (gestor_a, equipe_a) e B (gestor_b); `sem_obra` vira admin quando preciso. A fila
`boletim_emissao` é limpa antes de cada teste (o banco é compartilhado na sessão).
"""
import copy
import json
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

psycopg = pytest.importorskip('psycopg', reason='psycopg não instalado')
from psycopg import errors  # noqa: E402

from conftest import sessao  # noqa: E402

UTC = timezone.utc
FUSO = 'America/Rio_Branco'  # UTC−5, o ano todo
DIA = date(2026, 11, 10)


@pytest.fixture(autouse=True)
def limpo(dsn):
    with sessao(dsn, papel=None) as cur:
        cur.execute('delete from public.admin_app')
        cur.execute('delete from public.boletim_emissao')
        cur.execute('delete from vault.decrypted_secrets')
        cur.execute('delete from net.pedido_stub')


def sql(c, comando, params=(), papel='authenticated', usuario=None):
    with sessao(c.dsn, usuario, papel=papel) as cur:
        cur.execute(comando, params)
        return cur.fetchall() if cur.description else None


def su(c, comando, params=()):
    return sql(c, comando, params, papel=None)


def srv(c, comando, params=()):
    r = sql(c, comando, params, papel='service_role')
    return r[0][0] if r else None


def rpc(c, usuario, comando, params=()):
    r = sql(c, comando, params, usuario=usuario)
    return r[0][0] if r else None


def tornar_admin(c, *usuarios):
    for u in usuarios:
        su(c, 'insert into public.admin_app (usuario_id) values (%s) on conflict do nothing', (u,))


def sigla_nova():
    return uuid.uuid4().hex[:8].upper()


def slug(c, etapa=None):
    return su(c, 'select slug from public.etapa where id = %s', (etapa or c.etapa,))[0][0]


def preparar_etapa(c, fuso=FUSO, horario='22:00', **extra):
    sigla = sigla_nova()
    campos = {'sigla': sigla, 'fuso': fuso, 'boletim_horario': horario, **extra}
    sets = ', '.join(f'{k} = %s' for k in campos)
    su(c, f'update public.etapa set {sets} where id = %s', (*campos.values(), c.etapa))
    return sigla


def numero(c, dia, revisao=0, etapa=None):
    return su(c, 'select privado.numero_boletim(%s, %s, %s)', (etapa or c.etapa, dia, revisao))[0][0]


def utc(*args):
    return datetime(*args, tzinfo=UTC)


def boletim(c, dia, revisao=0, emitido_em=None, snapshot=None, etapa=None):
    bid = uuid.uuid4()
    su(c, 'insert into public.boletim (id, etapa_id, data, revisao, numero, snapshot, emitido_em) '
          'values (%s, %s, %s, %s, %s, %s, coalesce(%s, now()))',
       (bid, etapa or c.etapa, dia, revisao, f'T{uuid.uuid4().hex}', json.dumps(snapshot or {}), emitido_em))
    return bid


def foto(c, obra, registro=None, encerramento=None, ordem=0, pasta=None):
    fid = uuid.uuid4()
    su(c, 'insert into public.foto (id, obra_id, registro_id, encerramento_id, storage_path, largura, altura, bytes, '
          'ordem) values (%s, %s, %s, %s, %s, 1000, 750, 100, %s)',
       (fid, obra, registro, encerramento, f'{obra}/{pasta or registro}/{fid}.jpg', ordem))
    return f'{obra}/{pasta or registro}/{fid}.jpg'


def registro(c, obra, amb, tipo, legenda, autor, capturado, recebido=None, fotos=0):
    rid = uuid.uuid4()
    su(c, 'insert into public.registro (id, obra_id, ambiente_id, tipo, legenda, autor_id, capturado_em, '
          'recebido_em, situacao) values (%s, %s, %s, %s, %s, %s, %s, %s, %s)',
       (rid, obra, amb, tipo, legenda, autor, capturado, recebido or capturado,
        'aberta' if tipo == 'pendencia' else None))
    caminhos = [foto(c, obra, registro=rid, ordem=i) for i in range(fotos)]
    return rid, caminhos


def encerrar(c, reg, obra, gestor, quando, observacao=None, fotos=0):
    eid = uuid.uuid4()
    su(c, 'insert into public.encerramento (id, registro_id, obra_id, gestor_id, observacao, encerrado_em) '
          'values (%s, %s, %s, %s, %s, %s)', (eid, reg, obra, gestor, observacao, quando))
    su(c, "update public.registro set situacao = 'resolvida' where id = %s", (reg,))
    caminhos = [foto(c, obra, encerramento=eid, ordem=i, pasta=reg) for i in range(fotos)]
    return eid, caminhos


def observacao(c, obra, autor, escrito, dia, texto, recebido=None, editado=None):
    oid = uuid.uuid4()
    su(c, 'insert into public.observacao (id, obra_id, autor_id, data, texto, escrito_em, recebido_em, editado_em) '
          'values (%s, %s, %s, %s, %s, %s, %s, %s)', (oid, obra, autor, dia, texto, escrito, recebido or escrito, editado))
    return oid


def snapshot(c, dia=DIA, etapa=None):
    return srv(c, 'select public.boletim_snapshot(%s, %s)', (etapa or c.etapa, dia))


def instante(iso):
    return datetime.fromisoformat(iso)


# --- Estações do Observatório -----------------------------------------------------------------------

def test_estacoes_do_observatorio(cenario):
    c = cenario
    assert su(c, "select estacao, estacao_reserva from public.etapa where slug = '2a-etapa'") == [('8836', '9281')]
    colunas = {r[0] for r in su(c, "select column_name from information_schema.columns "
                                   "where table_schema = 'public' and table_name = 'etapa'")}
    assert {'estacao', 'estacao_reserva'} <= colunas and not {'inmet_estacao', 'inmet_estacao_reserva'} & colunas
    for objeto in ('public.inmet_estacao', 'public.clima_dia'):
        assert su(c, 'select to_regclass(%s)', (objeto,)) == [(None,)]
    assert su(c, "select count(*) from pg_proc where proname = 'admin_sugerir_estacoes'") == [(0,)]
    for valores in (('A305', None), ('12', None), ('1234567', None), ('8836', '8836')):
        with pytest.raises(errors.CheckViolation):
            su(c, 'update public.etapa set estacao = %s, estacao_reserva = %s where id = %s', (*valores, c.etapa))

    tornar_admin(c, c.sem_obra)
    base = {'nome': 'Etapa', 'latitude': -3.76, 'longitude': -38.53, 'fuso': 'America/Fortaleza'}

    def criar(**extra):
        dados = {'slug': f'et-{uuid.uuid4().hex[:8]}', 'sigla': sigla_nova(), **base, **extra}
        return rpc(c, c.sem_obra, 'select public.admin_salvar_etapa(%s::jsonb)', (json.dumps(dados),))

    e = criar()
    assert (e['estacao'], e['estacao_reserva']) == ('8836', '9281')
    assert 'estacao' not in e['faltando'] and 'inmet_estacao' not in e
    assert (lambda x: (x['estacao'], x['estacao_reserva']))(criar(estacao='9281')) == ('9281', '8836')
    assert (lambda x: (x['estacao'], x['estacao_reserva']))(criar(estacao_reserva='8836')) == ('9281', '8836')
    assert (lambda x: (x['estacao'], x['estacao_reserva']))(criar(estacao=None, estacao_reserva=None)) == (
        '8836', '9281')
    assert (lambda x: (x['estacao'], x['estacao_reserva']))(criar(estacao='3318', estacao_reserva='9137')) == (
        '3318', '9137')
    # edição: null apaga; a falta aparece em `faltando`
    editada = rpc(c, c.sem_obra, 'select public.admin_salvar_etapa(%s::jsonb)',
                  (json.dumps({'id': e['id'], 'estacao': None, 'estacao_reserva': None}),))
    assert (editada['estacao'], editada['estacao_reserva']) == (None, None) and 'estacao' in editada['faltando']
    for dados in ({'estacao': 'A305'}, {'estacao': '12'}, {'estacao_reserva': '8836', 'estacao': '8836'},
                  {'estacao': 8836}):
        with pytest.raises(errors.InvalidParameterValue):
            rpc(c, c.sem_obra, 'select public.admin_salvar_etapa(%s::jsonb)', (json.dumps({'id': e['id'], **dados}),))
    obtida = rpc(c, c.sem_obra, 'select public.admin_obter_etapa(%s)', (e['slug'],))
    assert (obtida['estacao'], obtida['estacao_reserva']) == (None, None)


# --- Snapshot ----------------------------------------------------------------------------------------

def montar_dia(c):
    """Um dia completo (DIA, no fuso de Rio Branco, UTC−5: [10/11 05:00Z, 11/11 05:00Z))."""
    ids = {}
    preparar_etapa(c, os_data='2025-08-06', vigencia_meses=27, valor_original=1000000, objeto='Obra do campus',
                   contrato='120/2025 - SOP')
    su(c, "update public.usuario set nome_exibicao = 'CB ALMEIDA' where id = %s", (c.equipe_a,))
    su(c, "update public.usuario set nome = 'Gestor A', nome_exibicao = null where id = %s", (c.gestor_a,))
    su(c, "update public.usuario set nome = 'Gestor B', nome_exibicao = 'SGT B' where id = %s", (c.gestor_b,))
    # B antes de A (ordem); em A, a Cobertura vem depois do Térreo
    su(c, 'update public.obra set ordem = 1 where id = %s', (c.obra_a,))
    su(c, 'update public.obra set ordem = 0 where id = %s', (c.obra_b,))
    pav_cob, amb_c = uuid.uuid4(), uuid.uuid4()
    su(c, "insert into public.pavimento (id, obra_id, codigo, nome, ordem) values (%s, %s, 'cob', 'Cobertura', 1)",
       (pav_cob, c.obra_a))
    su(c, "insert into public.ambiente (id, obra_id, pavimento_id, codigo, nome_operacional) "
          "values (%s, %s, %s, 'c1', 'Laje')", (amb_c, c.obra_a, pav_cob))
    # aditivos: um até o dia, outro depois (não entra)
    su(c, "insert into public.etapa_aditivo (etapa_id, numero, data, prazo_dias, valor) values "
          "(%s, '1', '2026-11-01', 30, 1000), (%s, '2', '2026-12-01', 60, 5000)", (c.etapa, c.etapa))
    su(c, "insert into public.etapa_responsavel (etapa_id, usuario_id, funcao, ordem) values "
          "(%s, %s, 'Fiscal', 0), (%s, %s, 'Fiscal substituto', 1)", (c.etapa, c.equipe_a, c.etapa, c.gestor_a))

    A, B, ga, eq, gb = c.obra_a, c.obra_b, c.gestor_a, c.equipe_a, c.gestor_b
    # serviços do dia
    ids['s1'], ids['s1_fotos'] = registro(c, A, c.amb_a2, 'servico', 'Porcelanato', eq, utc(2026, 11, 10, 14), fotos=2)
    ids['s2'], ids['s2_fotos'] = registro(c, A, c.amb_a, 'servico', 'Reboco', ga, utc(2026, 11, 10, 13), fotos=1)
    ids['s3'], _ = registro(c, A, amb_c, 'servico', 'Impermeabilização', ga, utc(2026, 11, 10, 12))
    # 03:30Z de 11/11 = 22:30 de 10/11 em Rio Branco (em São Paulo seria 00:30 de 11/11)
    ids['s4'], _ = registro(c, A, c.amb_a, 'servico', 'Fim do dia', eq, utc(2026, 11, 11, 3, 30))
    # 04:30Z de 10/11 = 23:30 de 09/11 em Rio Branco (em São Paulo, 01:30 de 10/11); recebido antes da emissão de 09/11
    ids['s5'], _ = registro(c, A, c.amb_a, 'servico', 'Véspera', eq, utc(2026, 11, 10, 4, 30),
                            recebido=utc(2026, 11, 10, 4, 20))
    # pendências
    ids['p_antiga'], _ = registro(c, A, c.amb_a, 'pendencia', 'Fissura antiga', ga, utc(2026, 10, 1, 15))
    ids['p_resolvida'], ids['p_resolvida_fotos'] = registro(c, A, c.amb_a2, 'pendencia', 'Tomada solta', eq,
                                                            utc(2026, 11, 1, 15), fotos=1)
    ids['enc'], ids['enc_fotos'] = encerrar(c, ids['p_resolvida'], A, ga, utc(2026, 11, 10, 20), 'Trocada', fotos=1)
    ids['p_nova'], _ = registro(c, B, c.amb_b, 'pendencia', 'Vazamento', gb, utc(2026, 11, 10, 16), fotos=1)
    p_fechada, _ = registro(c, A, c.amb_a, 'pendencia', 'Fechada antes', ga, utc(2026, 10, 20, 12))
    encerrar(c, p_fechada, A, ga, utc(2026, 10, 25, 12))
    p_depois, _ = registro(c, B, c.amb_b, 'pendencia', 'Fechada depois', gb, utc(2026, 10, 30, 15))
    encerrar(c, p_depois, B, gb, utc(2026, 11, 12, 15))
    # encerrada às 23:45 de 09/11 (local), depois da emissão de 09/11: tardia
    ids['p_tarde'], _ = registro(c, B, c.amb_b, 'pendencia', 'Pintura', gb, utc(2026, 11, 5, 15))
    ids['enc_tarde'], _ = encerrar(c, ids['p_tarde'], B, gb, utc(2026, 11, 10, 4, 45), 'Resolvido tarde')
    # observações
    ids['o1'] = observacao(c, A, eq, utc(2026, 11, 10, 23), DIA, 'Chuva à tarde', editado=utc(2026, 11, 10, 23, 5))
    ids['o2'] = observacao(c, A, ga, utc(2026, 11, 10, 12), DIA, 'Equipe completa')
    ids['o3'] = observacao(c, B, gb, utc(2026, 11, 10, 14), DIA, 'Material entregue')
    ids['o_tarde'] = observacao(c, A, eq, utc(2026, 11, 10, 3), date(2026, 11, 9), 'Nota da véspera',
                                recebido=utc(2026, 11, 10, 5, 10))

    # boletins anteriores: 08/11 (original 04:30Z de 09/11, retificação 14:00Z de 09/11) e 09/11 (04:30Z de 10/11)
    boletim(c, date(2026, 11, 8), 0, utc(2026, 11, 9, 4, 30))
    boletim(c, date(2026, 11, 8), 1, utc(2026, 11, 9, 14))
    # 08/11, recebido depois da retificação, já listado como tardio no boletim de 09/11
    ids['t_listado'], _ = registro(c, A, c.amb_a, 'servico', 'Já listado', eq, utc(2026, 11, 9, 3),
                                   recebido=utc(2026, 11, 9, 15))
    # 08/11, recebido antes da retificação (que já o inclui)
    ids['t_retificado'], _ = registro(c, A, c.amb_a, 'servico', 'Na retificação', eq, utc(2026, 11, 9, 2),
                                      recebido=utc(2026, 11, 9, 13))
    boletim(c, date(2026, 11, 9), 0, utc(2026, 11, 10, 4, 30),
            snapshot={'tardios': [{'tipo': 'servico', 'id': str(ids['t_listado'])}]})
    # 09/11 (23:00 local), recebido depois da emissão de 09/11: tardio
    ids['t1'], _ = registro(c, A, c.amb_a2, 'servico', 'Chegou tarde', eq, utc(2026, 11, 10, 4),
                            recebido=utc(2026, 11, 10, 13))
    # 07/11, sem boletim desse dia: não é tardio
    registro(c, A, c.amb_a, 'servico', 'Sem boletim', eq, utc(2026, 11, 7, 15), recebido=utc(2026, 11, 10, 15))
    return ids


def test_snapshot_de_um_dia_completo(cenario):
    c = cenario
    ids = montar_dia(c)
    s = snapshot(c)
    original = copy.deepcopy(s)
    assert set(s) >= {'versao', 'data', 'fuso', 'organizacao', 'etapa', 'responsaveis', 'indicadores', 'obras',
                      'tardios', 'clima'}
    assert (s['versao'], s['data'], s['fuso'], s['clima']) == (1, '2026-11-10', FUSO, None)
    assert set(s['organizacao']) == {'nome', 'cabecalho', 'logo_path'}
    assert s['responsaveis'] == [{'nome': 'CB ALMEIDA', 'funcao': 'Fiscal'},
                                 {'nome': 'Gestor A', 'funcao': 'Fiscal substituto'}]

    # etapa: campos de admin_obter_etapa (sem faltando), aditivos até o dia e prazo na data
    e = s['etapa']
    assert 'faltando' not in e and e['id'] == str(c.etapa) and e['objeto'] == 'Obra do campus'
    assert [a['numero'] for a in e['aditivos']] == ['1']
    termino_original = date(2027, 11, 6)
    termino_atual = termino_original + timedelta(days=30)
    total = (termino_atual - date(2025, 8, 6)).days
    assert e['prazo'] == {
        'termino_original': '2027-11-06', 'prazo_aditivos_dias': 30, 'termino_atual': termino_atual.isoformat(),
        'valor_atual': 1001000.00, 'dias_decorridos': (DIA - date(2025, 8, 6)).days, 'dias_totais': total,
        'percentual': round(100 * (DIA - date(2025, 8, 6)).days / total, 1),
        'dias_restantes': (termino_atual - DIA).days,
    }
    assert e['prazo']['dias_decorridos'] + e['prazo']['dias_restantes'] == total

    # indicadores
    assert s['indicadores']['pendencias'] == {
        'abertas_inicio': 3,      # antiga, resolvida hoje, fechada depois
        'abertas_no_dia': 1,      # vazamento
        'encerradas_no_dia': 1,   # tomada
        'abertas_fim': 3,         # antiga, vazamento, fechada depois
        'total_abertas': 6, 'total_encerradas': 3, 'taxa_resolucao': 50.0,
        'mais_7': 2, 'mais_15': 1, 'mais_30': 1,
        # (5 d + 9 d 5 h + 4 d 13 h 45 min) / 3
        'tempo_medio_resolucao_dias': 6.3,
    }
    assert s['indicadores']['atividade'] == {'registros_servico': 4, 'fotos': 5, 'ambientes': 4, 'pessoas': 3}
    assert s['indicadores']['por_obra'] == [
        {'obra': 'Obra b', 'servicos': 0, 'abertas_no_dia': 1, 'encerradas_no_dia': 0, 'abertas_fim': 2, 'mais_15': 0},
        {'obra': 'Obra a', 'servicos': 4, 'abertas_no_dia': 0, 'encerradas_no_dia': 1, 'abertas_fim': 1, 'mais_15': 1},
    ]

    # obras: B, A; serviços por pavimento, ambiente e hora
    b, a = s['obras']
    assert (b['id'], b['nome'], a['id'], a['nome']) == (str(c.obra_b), 'Obra b', str(c.obra_a), 'Obra a')
    assert [(x['pavimento'], x['ambiente'], x['hora'], x['legenda']) for x in a['servicos']] == [
        ('Térreo', 'Ambiente 0', '08:00', 'Reboco'),
        ('Térreo', 'Ambiente 0', '22:30', 'Fim do dia'),
        ('Térreo', 'Ambiente 1', '09:00', 'Porcelanato'),
        ('Cobertura', 'Laje', '07:00', 'Impermeabilização'),
    ]
    s1 = a['servicos'][2]
    assert s1 == {'id': str(ids['s1']), 'pavimento': 'Térreo', 'ambiente': 'Ambiente 1', 'hora': '09:00',
                  'autor': 'CB ALMEIDA', 'legenda': 'Porcelanato',
                  'fotos': [{'path': p, 'largura': 1000, 'altura': 750} for p in ids['s1_fotos']]}
    assert b['servicos'] == [] and a['pendencias_abertas'] == []
    assert [(x['id'], x['autor'], x['hora']) for x in b['pendencias_abertas']] == [(str(ids['p_nova']), 'SGT B', '11:00')]
    assert b['pendencias_encerradas'] == []  # a encerrada às 23:45 de 09/11 não é do dia
    (enc,) = a['pendencias_encerradas']
    assert instante(enc.pop('aberta_em')) == utc(2026, 11, 1, 15)
    assert enc == {
        'id': str(ids['p_resolvida']), 'pavimento': 'Térreo', 'ambiente': 'Ambiente 1', 'dias_aberta': 9,
        'legenda': 'Tomada solta',
        'fotos_registro': [{'path': ids['p_resolvida_fotos'][0], 'largura': 1000, 'altura': 750}],
        'encerramento': {'hora': '15:00', 'autor': 'Gestor A', 'observacao': 'Trocada',
                         'fotos': [{'path': ids['enc_fotos'][0], 'largura': 1000, 'altura': 750}]},
    }
    assert a['observacoes'] == [
        {'hora': '07:00', 'autor': 'Gestor A', 'texto': 'Equipe completa', 'editada': False},
        {'hora': '18:00', 'autor': 'CB ALMEIDA', 'texto': 'Chuva à tarde', 'editada': True},
    ]
    assert b['observacoes'] == [{'hora': '09:00', 'autor': 'SGT B', 'texto': 'Material entregue', 'editada': False}]

    # tardios: de 09/11, recebidos depois da emissão de 09/11 e não listados em outro boletim
    tardios = s['tardios']
    assert [(t['tipo'], t['id']) for t in tardios] == [
        ('observacao', str(ids['o_tarde'])), ('servico', str(ids['t1'])), ('encerramento', str(ids['enc_tarde'])),
    ]
    assert {k: tardios[1][k] for k in ('tipo', 'data', 'obra', 'ambiente', 'autor', 'texto', 'hora')} == {
        'tipo': 'servico', 'data': '2026-11-09', 'obra': 'Obra a', 'ambiente': 'Ambiente 1', 'autor': 'CB ALMEIDA',
        'texto': 'Chegou tarde', 'hora': '23:00'}
    assert instante(tardios[1]['recebido_em']) == utc(2026, 11, 10, 13)
    assert (tardios[2]['obra'], tardios[2]['ambiente'], tardios[2]['texto'], tardios[2]['hora']) == (
        'Obra b', 'Ambiente 0', 'Resolvido tarde', '23:45')
    assert (tardios[0]['ambiente'], tardios[0]['texto']) == (None, 'Nota da véspera')

    # o admin vê o mesmo snapshot (prévia)
    tornar_admin(c, c.sem_obra)
    previa = rpc(c, c.sem_obra, 'select public.admin_boletim_snapshot(%s, %s)', (slug(c), DIA))
    previa.pop('gerado_em'), original.pop('gerado_em')
    assert previa == original


def test_snapshot_tardios_entre_boletins(cenario):
    c = cenario
    ids = montar_dia(c)
    primeiro = snapshot(c)
    assert len(primeiro['tardios']) == 3
    # emitido o boletim do dia com esses tardios: a retificação do mesmo dia continua listando-os...
    boletim(c, DIA, 0, utc(2026, 11, 11, 3, 31), snapshot=primeiro)
    assert [t['id'] for t in snapshot(c)['tardios']] == [t['id'] for t in primeiro['tardios']]
    # ...e o dia seguinte não repete
    seguinte = snapshot(c, DIA + timedelta(days=1))
    assert [t['id'] for t in seguinte['tardios']] == []
    # lançamento do dia recebido depois da emissão do boletim do dia: tardio no dia seguinte
    atrasado, _ = registro(c, c.obra_a, c.amb_a, 'servico', 'Offline', c.equipe_a, utc(2026, 11, 10, 18),
                           recebido=utc(2026, 11, 11, 12))
    assert [t['id'] for t in snapshot(c, DIA + timedelta(days=1))['tardios']] == [str(atrasado)]
    # ...mas aparece na lista normal de uma retificação do dia
    assert str(atrasado) in [x['id'] for o in snapshot(c)['obras'] for x in o['servicos']]
    assert ids  # (montar_dia devolve os ids para os outros testes)


def test_snapshot_fuso_muda_o_dia(cenario):
    c = cenario
    ids = montar_dia(c)
    em_rio_branco = {x['id'] for o in snapshot(c)['obras'] for x in o['servicos']}
    assert str(ids['s4']) in em_rio_branco and str(ids['s5']) not in em_rio_branco
    su(c, "update public.etapa set fuso = 'America/Sao_Paulo' where id = %s", (c.etapa,))
    s = snapshot(c)
    em_sao_paulo = {x['id'] for o in s['obras'] for x in o['servicos']}
    assert str(ids['s5']) in em_sao_paulo and str(ids['s4']) not in em_sao_paulo
    assert s['fuso'] == 'America/Sao_Paulo'
    horas = {x['legenda']: x['hora'] for o in s['obras'] for x in o['servicos']}
    assert horas['Porcelanato'] == '11:00' and horas['Véspera'] == '01:30'


def test_snapshot_sem_lancamentos_e_obra_arquivada(cenario):
    c = cenario
    preparar_etapa(c)
    su(c, "update public.obra set arquivada_em = '2026-11-01T00:00:00Z' where id = %s", (c.obra_b,))
    s = snapshot(c)
    assert [o['nome'] for o in s['obras']] == ['Obra a']  # B arquivada antes do dia
    assert s['obras'][0] == {'id': str(c.obra_a), 'nome': 'Obra a', 'slug': s['obras'][0]['slug'], 'servicos': [],
                             'pendencias_abertas': [], 'pendencias_encerradas': [], 'observacoes': []}
    assert s['indicadores']['pendencias']['taxa_resolucao'] is None
    assert s['indicadores']['pendencias']['tempo_medio_resolucao_dias'] is None
    assert s['indicadores']['atividade'] == {'registros_servico': 0, 'fotos': 0, 'ambientes': 0, 'pessoas': 0}
    assert s['etapa']['prazo'] is None and s['etapa']['aditivos'] == [] and s['tardios'] == []
    assert s['responsaveis'] == []
    # arquivada depois do início do dia: ainda entra
    su(c, "update public.obra set arquivada_em = '2026-11-10T12:00:00Z' where id = %s", (c.obra_b,))
    assert len(snapshot(c)['obras']) == 2


def test_snapshot_acesso_e_erros(cenario):
    c = cenario
    preparar_etapa(c)
    for comando, params in (('select public.boletim_snapshot(%s, %s)', (c.etapa, DIA)),
                            ('select public.admin_boletim_snapshot(%s, %s)', (slug(c), DIA))):
        with pytest.raises(errors.InsufficientPrivilege):
            sql(c, comando, params, papel='anon')
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, 'select public.boletim_snapshot(%s, %s)', (c.etapa, DIA), usuario=c.gestor_a)
    with pytest.raises(errors.InsufficientPrivilege):
        rpc(c, c.gestor_a, 'select public.admin_boletim_snapshot(%s, %s)', (slug(c), DIA))
    tornar_admin(c, c.sem_obra)
    with pytest.raises(errors.NoDataFound):
        rpc(c, c.sem_obra, 'select public.admin_boletim_snapshot(%s, %s)', ('nao-existe', DIA))
    with pytest.raises(errors.InvalidParameterValue):
        rpc(c, c.sem_obra, 'select public.admin_boletim_snapshot(%s, %s)', (slug(c), None))
    with pytest.raises(errors.NoDataFound):
        snapshot(c, etapa=uuid.uuid4())


# --- Fila: reivindicar, concluir e falhar --------------------------------------------------------------

def pedido(c, dia, revisao=0, etapa=None, **extra):
    campos = {'etapa_id': etapa or c.etapa, 'data': dia, 'revisao': revisao, **extra}
    cols = ', '.join(campos)
    marcas = ', '.join(['%s'] * len(campos))
    return su(c, f'insert into public.boletim_emissao ({cols}) values ({marcas}) returning id',
              tuple(campos.values()))[0][0]


def estado_pedido(c, pid):
    return su(c, 'select estado, tentativas, erro, boletim_id from public.boletim_emissao where id = %s', (pid,))[0]


def pdf(c, caminho):
    su(c, "insert into storage.objects (bucket_id, name) values ('boletins', %s) on conflict do nothing", (caminho,))


def test_reivindicar_emissoes(cenario):
    c = cenario
    preparar_etapa(c)
    p1 = pedido(c, date(2026, 11, 8))
    p2 = pedido(c, date(2026, 11, 9), proxima_tentativa=utc(2026, 1, 1))
    p3 = pedido(c, date(2026, 11, 10))
    futuro = pedido(c, date(2026, 11, 11), proxima_tentativa=datetime.now(UTC) + timedelta(hours=1))
    preso = pedido(c, date(2026, 11, 7), estado='gerando', tentativas=2, proxima_tentativa=utc(2026, 1, 2),
                   atualizado_em=datetime.now(UTC) - timedelta(minutes=20))
    recente = pedido(c, date(2026, 11, 6), estado='gerando', tentativas=1)
    esgotado = pedido(c, date(2026, 11, 5), estado='gerando', tentativas=8,
                      atualizado_em=datetime.now(UTC) - timedelta(minutes=20))
    lote = srv(c, 'select public.reivindicar_emissoes(2)')
    # por proxima_tentativa: p2 e o preso (geração interrompida há mais de 15 min)
    assert [x['id'] for x in lote] == sorted([p2, preso])
    assert lote[0] == {'id': lote[0]['id'], 'etapa_id': str(c.etapa), 'data': lote[0]['data'], 'revisao': 0,
                       'numero': numero(c, lote[0]['data']),
                       'base_boletim_id': None, 'edicao': None}
    assert estado_pedido(c, preso)[:2] == ('gerando', 3)
    assert estado_pedido(c, p2)[:2] == ('gerando', 1)
    assert estado_pedido(c, esgotado)[:3] == ('falhou', 8, 'Geração interrompida; tentativas esgotadas.')
    resto = srv(c, 'select public.reivindicar_emissoes()')
    assert [x['id'] for x in resto] == [p1, p3]
    assert srv(c, 'select public.reivindicar_emissoes()') == []
    assert estado_pedido(c, futuro)[:2] == ('pendente', 0) and estado_pedido(c, recente)[:2] == ('gerando', 1)
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, 'select public.reivindicar_emissoes()', usuario=c.gestor_a)


def test_concluir_emissao(cenario):
    c = cenario
    preparar_etapa(c)
    su(c, 'update public.etapa set telegram_chat_id = %s where id = %s', (-uuid.uuid4().int % 10**12, c.etapa))
    pid = pedido(c, DIA, pedido_por=c.gestor_a)
    srv(c, 'select public.reivindicar_emissoes()')
    n = numero(c, DIA)
    caminho = f"{c.etapa}/{n.replace('/', '')}.pdf"
    snap = snapshot(c) | {'clima': {'indisponivel': True, 'motivo': 'teste'}}
    concluir = 'select public.concluir_emissao(%s, %s::jsonb, %s)'
    with pytest.raises(errors.InvalidParameterValue, match='não foi enviado'):
        srv(c, concluir, (pid, json.dumps(snap), caminho))
    pdf(c, caminho)
    for args, trecho in (((pid, json.dumps(snap), 'outro.pdf'), 'Caminho'),
                         ((pid, json.dumps(snap | {'data': '2026-11-09'}), caminho), 'dia do pedido'),
                         ((pid, '[]', caminho), 'Snapshot')):
        with pytest.raises(errors.InvalidParameterValue, match=trecho):
            srv(c, concluir, args)
    with pytest.raises(errors.NoDataFound):
        srv(c, concluir, (999999999, json.dumps(snap), caminho))
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, concluir, (pid, json.dumps(snap), caminho), usuario=c.gestor_a)

    su(c, "insert into vault.decrypted_secrets (name, decrypted_secret) values "
          "('url_projeto', 'https://proj.supabase.test'), ('segredo_interno', 'SEG')")
    r = srv(c, concluir, (pid, json.dumps(snap), caminho))
    assert r['numero'] == n
    b = su(c, 'select etapa_id, data, revisao, numero, snapshot, pdf_path, emitido_por from public.boletim '
              'where id = %s', (r['boletim_id'],))[0]
    assert b == (c.etapa, DIA, 0, n, snap, caminho, c.gestor_a)
    assert estado_pedido(c, pid) == ('emitido', 1, None, uuid.UUID(r['boletim_id']))
    pubs = su(c, 'select obra_id, registro_id, encerramento_id, estado from public.publicacao_telegram '
                 'where boletim_id = %s', (r['boletim_id'],))
    assert pubs == [(None, None, None, 'pendente')]
    # o gatilho da fila acionou a publish-outbox
    assert su(c, 'select url from net.pedido_stub') == [('https://proj.supabase.test/functions/v1/publish-outbox',)]
    # idempotente: devolve o mesmo, sem nova publicação
    assert srv(c, concluir, (pid, json.dumps(snap), caminho)) == r
    assert su(c, 'select count(*) from public.publicacao_telegram where boletim_id = %s', (r['boletim_id'],)) == [(1,)]
    # observação do dia fica travada
    with pytest.raises(errors.InvalidParameterValue, match='já foi emitido'):
        rpc(c, c.equipe_a, 'select public.salvar_observacao(%s::jsonb)', (json.dumps({
            'id': str(uuid.uuid4()), 'obra_id': str(c.obra_a), 'texto': 'x',
            'escrito_em': '2026-11-10T15:00:00Z'}),))
    # retificação: -R1, emitido_por null (automático)
    p2 = pedido(c, DIA, 1)
    n1 = numero(c, DIA, 1)
    assert n1 == n + '-R1'
    pdf(c, f"{c.etapa}/{n1.replace('/', '')}.pdf")
    r1 = srv(c, concluir, (p2, json.dumps(snap), f"{c.etapa}/{n1.replace('/', '')}.pdf"))
    assert su(c, 'select revisao, emitido_por from public.boletim where id = %s', (r1['boletim_id'],)) == [(1, None)]


def test_falhar_emissao(cenario):
    c = cenario
    preparar_etapa(c)
    pid = pedido(c, DIA, estado='gerando', tentativas=1)
    falhar = 'select public.falhar_emissao(%s, %s)'
    agora = su(c, 'select now()')[0][0]
    for tentativas, minutos in ((1, 5), (2, 10), (3, 20), (4, 40), (7, 320)):
        su(c, "update public.boletim_emissao set estado = 'gerando', tentativas = %s where id = %s", (tentativas, pid))
        r = srv(c, falhar, (pid, '  Chromium caiu  '))
        assert (r['estado'], r['tentativas'], r['erro']) == ('pendente', tentativas, 'Chromium caiu')
        espera = instante(r['proxima_tentativa']) - agora
        assert timedelta(minutes=minutos) <= espera < timedelta(minutes=minutos, seconds=30), tentativas
    su(c, "update public.boletim_emissao set estado = 'gerando', tentativas = 8 where id = %s", (pid,))
    r = srv(c, falhar, (pid, 'x' * 2000))
    assert r['estado'] == 'falhou' and len(r['erro']) == 1000
    # falhou não muda mais; sem mensagem, um texto padrão
    assert srv(c, falhar, (pid, 'outra'))['erro'] == 'x' * 1000
    outro = pedido(c, DIA - timedelta(days=1), estado='gerando', tentativas=1)
    assert srv(c, falhar, (outro, None))['erro'] == 'Erro desconhecido na geração.'
    with pytest.raises(errors.NoDataFound):
        srv(c, falhar, (999999999, 'x'))
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, falhar, (pid, 'x'), usuario=c.gestor_a)


def test_regras_da_tabela_de_pedidos(cenario):
    c = cenario
    preparar_etapa(c)
    pedido(c, DIA)
    with pytest.raises(errors.UniqueViolation):
        pedido(c, DIA)
    for extra in ({'estado': 'outro'}, {'revisao': -1}, {'estado': 'emitido'}):
        with pytest.raises(errors.CheckViolation):
            pedido(c, DIA, **({'revisao': 5} | extra))
    for papel, usuario in (('anon', None), ('authenticated', c.gestor_a)):
        with pytest.raises(errors.InsufficientPrivilege):
            sql(c, 'select * from public.boletim_emissao', papel=papel, usuario=usuario)


# --- Agendamento --------------------------------------------------------------------------------------

def agendar(c, agora):
    return su(c, 'select privado.agendar_boletins(%s)', (agora,))[0][0]


def pedidos_da_etapa(c, etapa=None):
    return su(c, 'select data, revisao, estado, pedido_por from public.boletim_emissao where etapa_id = %s '
                 'order by data, revisao', (etapa or c.etapa,))


def test_agendamento(cenario):
    c = cenario
    preparar_etapa(c, horario='22:00')  # Rio Branco, UTC−5
    su(c, "insert into vault.decrypted_secrets (name, decrypted_secret) values "
          "('url_gerador_boletim', 'https://app.test/api/gerar-boletim'), ('segredo_interno', 'SEG')")
    antes = utc(2026, 11, 11, 2, 59)    # 21:59 de 10/11
    depois = utc(2026, 11, 11, 3, 0)    # 22:00 de 10/11
    agendar(c, antes)
    assert pedidos_da_etapa(c) == []
    agendar(c, depois)
    assert pedidos_da_etapa(c) == [(DIA, 0, 'pendente', None)]
    (url, headers, timeout), *_ = su(c, 'select url, headers, timeout_milliseconds from net.pedido_stub')
    assert url == 'https://app.test/api/gerar-boletim' and headers['x-segredo-interno'] == 'SEG' and timeout >= 60000
    # de novo: nada novo (já há pedido para a data)
    agendar(c, depois + timedelta(minutes=5))
    assert len(pedidos_da_etapa(c)) == 1
    # mesmo um pedido que falhou impede outro automático para a data
    su(c, "update public.boletim_emissao set estado = 'falhou' where etapa_id = %s", (c.etapa,))
    agendar(c, depois + timedelta(minutes=10))
    assert pedidos_da_etapa(c) == [(DIA, 0, 'falhou', None)]
    # dia seguinte com boletim já emitido (manual): não agenda
    boletim(c, DIA + timedelta(days=1))
    agendar(c, depois + timedelta(days=1))
    assert len(pedidos_da_etapa(c)) == 1
    # depois da meia-noite local o dia é outro; antes do horário, nada
    agendar(c, depois + timedelta(days=2, hours=3))  # 01:00 de 13/11
    assert len(pedidos_da_etapa(c)) == 1


def test_agendamento_so_etapa_ativa_com_sigla(cenario):
    c = cenario
    depois = utc(2026, 11, 11, 4)
    agendar(c, depois)  # etapa do cenário sem sigla
    assert pedidos_da_etapa(c) == []
    preparar_etapa(c)
    su(c, 'update public.etapa set arquivada_em = now() where id = %s', (c.etapa,))
    agendar(c, depois)
    assert pedidos_da_etapa(c) == []
    su(c, 'update public.etapa set arquivada_em = null where id = %s', (c.etapa,))
    assert agendar(c, depois) >= 1
    assert pedidos_da_etapa(c) == [(DIA, 0, 'pendente', None)]


def test_agendamento_dispara_pedidos_vencidos_e_sem_segredos_nao_faz_nada(cenario):
    c = cenario
    preparar_etapa(c)
    cedo = utc(2026, 11, 10, 12)  # 07:00, antes do horário
    agendar(c, cedo)  # sem segredos: nada e sem erro
    assert su(c, 'select count(*) from net.pedido_stub') == [(0,)]
    # (etapas de outros testes podem ter ganhado pedido: tira-os do caminho)
    su(c, "update public.boletim_emissao set estado = 'falhou'")
    assert pedidos_da_etapa(c) == []
    su(c, "insert into vault.decrypted_secrets (name, decrypted_secret) values "
          "('url_gerador_boletim', 'https://app.test/api/gerar-boletim'), ('segredo_interno', 'SEG')")
    agendar(c, cedo)
    assert su(c, 'select count(*) from net.pedido_stub') == [(0,)]  # nada a fazer
    pedido(c, date(2026, 11, 9), proxima_tentativa=utc(2026, 11, 10, 11))
    agendar(c, cedo)
    assert su(c, 'select count(*) from net.pedido_stub') == [(1,)]


def test_cron_agendar_boletins(cenario):
    c = cenario
    assert su(c, "select schedule, command from cron.job where jobname = 'agendar-boletins'") == [
        ('*/5 * * * *', 'select privado.agendar_boletins()')]


# --- Site: pedido manual e lista ----------------------------------------------------------------------

def test_pedir_emissao_e_retificacao(cenario):
    c = cenario
    preparar_etapa(c)
    s = slug(c)
    pedir = 'select public.admin_pedir_emissao(%s, %s)'
    with pytest.raises(errors.InsufficientPrivilege):
        rpc(c, c.gestor_a, pedir, (s, DIA))
    tornar_admin(c, c.sem_obra)
    su(c, "insert into vault.decrypted_secrets (name, decrypted_secret) values "
          "('url_gerador_boletim', 'https://app.test/api/gerar-boletim'), ('segredo_interno', 'SEG')")
    hoje_local = su(c, "select (now() at time zone %s)::date", (FUSO,))[0][0]
    with pytest.raises(errors.InvalidParameterValue, match='futuro'):
        rpc(c, c.sem_obra, pedir, (s, hoje_local + timedelta(days=1)))
    with pytest.raises(errors.NoDataFound):
        rpc(c, c.sem_obra, pedir, ('nao-existe', DIA))
    with pytest.raises(errors.InvalidParameterValue):
        rpc(c, c.sem_obra, pedir, (s, None))

    r = rpc(c, c.sem_obra, pedir, (s, DIA))
    assert (r['data'], r['revisao'], r['estado'], r['tentativas'], r['erro'], r['numero']) == (
        '2026-11-10', 0, 'pendente', 0, None, numero(c, DIA))
    assert pedidos_da_etapa(c) == [(DIA, 0, 'pendente', c.sem_obra)]
    assert su(c, 'select url from net.pedido_stub') == [('https://app.test/api/gerar-boletim',)]
    with pytest.raises(errors.UniqueViolation):
        rpc(c, c.sem_obra, pedir, (s, DIA))
    su(c, "update public.boletim_emissao set estado = 'gerando' where etapa_id = %s", (c.etapa,))
    with pytest.raises(errors.UniqueViolation):
        rpc(c, c.sem_obra, pedir, (s, DIA))
    # o pedido que falhou volta à fila (mesma revisão)
    su(c, "update public.boletim_emissao set estado = 'falhou', tentativas = 8, erro = 'x' where etapa_id = %s",
       (c.etapa,))
    de_novo = rpc(c, c.sem_obra, pedir, (s, DIA))
    assert (de_novo['id'], de_novo['estado'], de_novo['tentativas'], de_novo['erro']) == (r['id'], 'pendente', 0, None)
    # com boletim emitido: retificação
    su(c, 'delete from public.boletim_emissao where etapa_id = %s', (c.etapa,))
    boletim(c, DIA, 0)
    boletim(c, DIA, 1)
    ret = rpc(c, c.sem_obra, pedir, (s, DIA))
    assert (ret['revisao'], ret['numero']) == (2, numero(c, DIA) + '-R2')
    # hoje (no fuso da etapa) pode
    assert rpc(c, c.sem_obra, pedir, (s, hoje_local))['revisao'] == 0


def test_pedir_emissao_etapa_sem_sigla(cenario):
    c = cenario
    tornar_admin(c, c.sem_obra)
    with pytest.raises(errors.InvalidParameterValue, match='sigla'):
        rpc(c, c.sem_obra, 'select public.admin_pedir_emissao(%s, %s)', (slug(c), DIA))
    assert pedidos_da_etapa(c) == []


def test_listar_boletins(cenario):
    c = cenario
    preparar_etapa(c)
    s = slug(c)
    with pytest.raises(errors.InsufficientPrivilege):
        rpc(c, c.gestor_a, 'select public.admin_listar_boletins(%s)', (s,))
    tornar_admin(c, c.sem_obra)
    assert rpc(c, c.sem_obra, 'select public.admin_listar_boletins(%s)', (s,)) == {'boletins': [], 'pedidos': []}
    su(c, "update public.usuario set nome_exibicao = 'CP PATRICIO' where id = %s", (c.sem_obra,))
    b0 = boletim(c, DIA - timedelta(days=1))
    b1 = boletim(c, DIA)
    b2 = boletim(c, DIA, 1)
    su(c, 'update public.boletim set emitido_por = %s, pdf_path = %s where id = %s', (c.sem_obra, 'x.pdf', b2))
    su(c, "insert into public.publicacao_telegram (boletim_id, estado) values (%s, 'publicado'), (%s, 'falhou')",
       (b1, b2))
    pedido(c, DIA, 2, estado='falhou', tentativas=8, erro='Chromium caiu')
    pedido(c, DIA + timedelta(days=1))
    pedido(c, DIA - timedelta(days=1), estado='gerando')
    r = rpc(c, c.sem_obra, 'select public.admin_listar_boletins(%s)', (s,))
    assert [(x['id'], x['revisao'], x['publicado'], x['publicacao_estado']) for x in r['boletins']] == [
        (str(b2), 1, False, 'falhou'), (str(b1), 0, True, 'publicado'), (str(b0), 0, False, None)]
    assert set(r['boletins'][0]) == {'id', 'data', 'revisao', 'numero', 'emitido_em', 'emitido_por_nome', 'pdf_path',
                                     'publicado', 'publicacao_estado', 'publicacao_erro', 'publicacao_tentativas'}
    assert (r['boletins'][0]['emitido_por_nome'], r['boletins'][0]['pdf_path']) == ('CP PATRICIO', 'x.pdf')
    assert r['boletins'][1]['emitido_por_nome'] is None
    assert [(x['data'], x['revisao'], x['estado']) for x in r['pedidos']] == [
        ('2026-11-11', 0, 'pendente'), ('2026-11-10', 2, 'falhou'), ('2026-11-09', 0, 'gerando')]
    assert set(r['pedidos'][1]) == {'id', 'data', 'revisao', 'estado', 'tentativas', 'erro', 'atualizado_em'}
    assert r['pedidos'][1]['erro'] == 'Chromium caiu'


# --- Publicação do boletim no Telegram ----------------------------------------------------------------

def test_publicacao_de_boletim_na_fila(cenario):
    c = cenario
    preparar_etapa(c)
    b = boletim(c, DIA)
    for valores in ((c.obra_a, b), (None, None)):  # boletim sem obra; registro/encerramento/boletim: um só
        with pytest.raises(errors.CheckViolation):
            su(c, "insert into public.publicacao_telegram (obra_id, boletim_id) values (%s, %s)", valores)
    with pytest.raises(errors.CheckViolation):  # registro precisa de obra
        reg, _ = registro(c, c.obra_a, c.amb_a, 'servico', 'x', c.gestor_a, utc(2026, 11, 10, 12))
        su(c, 'insert into public.publicacao_telegram (registro_id) values (%s)', (reg,))
    su(c, "insert into public.publicacao_telegram (boletim_id) values (%s)", (b,))
    with pytest.raises(errors.UniqueViolation):
        su(c, "insert into public.publicacao_telegram (boletim_id) values (%s)", (b,))
    # o Mini App não vê a publicação do boletim
    assert sql(c, 'select count(*) from public.publicacao_telegram where boletim_id = %s', (b,),
               usuario=c.gestor_a) == [(0,)]

    # a fila devolve boletim_id; etapa arquivada fica parada
    su(c, "update public.publicacao_telegram set estado = 'publicado' where boletim_id is null and estado = 'pendente'")
    su(c, 'update public.etapa set arquivada_em = now() where id = %s', (c.etapa,))
    reivindicar = 'select id, obra_id, boletim_id, estado from public.reivindicar_publicacoes(50)'
    assert all(x[2] != b for x in sql(c, reivindicar, papel='service_role'))
    tornar_admin(c, c.sem_obra)
    su(c, "update public.publicacao_telegram set proxima_tentativa_em = now() + interval '1 hour' "
          'where boletim_id = %s', (b,))
    rpc(c, c.sem_obra, 'select public.admin_arquivar_etapa(%s, false)', (slug(c),))
    lote = sql(c, reivindicar, papel='service_role')
    assert [(x[1], x[2], x[3]) for x in lote if x[2] == b] == [(None, b, 'enviando')]
    # a finalização serve igual
    pid = [x[0] for x in lote if x[2] == b][0]
    sql(c, "select public.finalizar_publicacao(%s, 'pendente', null, 'Etapa sem grupo vinculado.', "
           "now() + interval '15 minutes')", (pid,), papel='service_role')
    assert su(c, 'select estado from public.publicacao_telegram where id = %s', (pid,)) == [('pendente',)]
    # vincular o grupo devolve o boletim à fila já
    assert su(c, 'select proxima_tentativa_em > now() from public.publicacao_telegram where id = %s',
              (pid,)) == [(True,)]
    sql(c, 'select public.vincular_etapa(%s, %s, %s)', (slug(c), -uuid.uuid4().int % 10**12, 'Grupo'),
        papel='service_role')
    assert su(c, 'select proxima_tentativa_em <= now() from public.publicacao_telegram where id = %s',
              (pid,)) == [(True,)]


def test_excluir_etapa_com_pedidos_e_publicacoes(cenario):
    c = cenario
    preparar_etapa(c)
    tornar_admin(c, c.sem_obra)
    b = boletim(c, DIA)
    su(c, "insert into public.publicacao_telegram (boletim_id) values (%s)", (b,))
    pedido(c, DIA, 0, estado='emitido', boletim_id=b)
    pedido(c, DIA, 1)
    nome = su(c, 'select nome from public.etapa where id = %s', (c.etapa,))[0][0]
    rpc(c, c.sem_obra, 'select public.admin_excluir_etapa(%s, %s)', (slug(c), nome))
    assert su(c, 'select count(*) from public.boletim_emissao where etapa_id = %s', (c.etapa,)) == [(0,)]
    assert su(c, 'select count(*) from public.publicacao_telegram where boletim_id = %s', (b,)) == [(0,)]


@pytest.mark.parametrize('comando', [
    "select public.admin_listar_boletins('x')",
    "select public.admin_pedir_emissao('x', '2026-11-10')",
    "select public.admin_boletim_snapshot('x', '2026-11-10')",
])
def test_rpcs_do_site_so_para_admin(cenario, comando):
    c = cenario
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, comando, usuario=c.gestor_a)
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, comando, papel='anon')
