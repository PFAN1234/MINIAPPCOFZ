"""Testes das RPCs public.painel_relatorios e public.relatorio_pendencias (20261119090000_relatorios_painel.sql)."""
import uuid
from datetime import datetime, timedelta, timezone

import pytest

psycopg = pytest.importorskip('psycopg', reason='psycopg não instalado')
from psycopg import errors  # noqa: E402

from test_boletim_emissao import (  # noqa: E402,F401
    encerrar, limpo, preparar_etapa, registro, rpc, sql, su, tornar_admin, utc,
)


def painel(c, usuario, etapa=None):
    return rpc(c, usuario, 'select public.painel_relatorios(%s)', (etapa or c.etapa,))


def relatorio(c, usuario, obra=None, etapa=None):
    return rpc(c, usuario, 'select public.relatorio_pendencias(%s, %s)', (etapa or c.etapa, obra))


def agora():
    return datetime.now(timezone.utc)


def codigo(c, usuario, comando, params):
    with pytest.raises(errors.Error) as e:
        sql(c, comando, params, usuario=usuario)
    return e.value.sqlstate


def totais(p, obra=None):
    d = [x for x in p['dias'] if obra is None or x['obra_id'] == str(obra)]
    return tuple(sum(x[k] for x in d) for k in ('servicos', 'pendencias', 'resolvidas'))


def test_acesso(cenario):
    c = cenario
    preparar_etapa(c)
    assert codigo(c, None, 'select public.painel_relatorios(%s)', (c.etapa,)) == '28000'
    assert codigo(c, None, 'select public.relatorio_pendencias(%s, null)', (c.etapa,)) == '28000'
    with pytest.raises(errors.Error) as e:
        sql(c, 'select public.painel_relatorios(%s)', (c.etapa,), papel='anon')
    assert e.value.sqlstate == '42501'
    # participante e admin entram; estranho não
    assert painel(c, c.gestor_a)['etapa']['id'] == str(c.etapa)
    assert relatorio(c, c.equipe_a)['etapa']['id'] == str(c.etapa)
    assert codigo(c, c.sem_obra, 'select public.painel_relatorios(%s)', (c.etapa,)) == '42501'
    assert codigo(c, c.sem_obra, 'select public.relatorio_pendencias(%s, null)', (c.etapa,)) == '42501'
    tornar_admin(c, c.sem_obra)
    assert painel(c, c.sem_obra)['etapa']['id'] == str(c.etapa)
    assert relatorio(c, c.sem_obra)['etapa']['id'] == str(c.etapa)
    # etapa inexistente
    assert codigo(c, c.sem_obra, 'select public.painel_relatorios(%s)', (uuid.uuid4(),)) == 'P0002'
    assert codigo(c, c.sem_obra, 'select public.relatorio_pendencias(%s, null)', (uuid.uuid4(),)) == 'P0002'


def test_obras_ordem_e_arquivadas(cenario):
    c = cenario
    preparar_etapa(c)
    su(c, 'update public.obra set ordem = 2 where id = %s', (c.obra_a,))
    su(c, 'update public.obra set ordem = 1 where id = %s', (c.obra_b,))
    p = painel(c, c.gestor_a)
    assert [o['id'] for o in p['obras']] == [str(c.obra_b), str(c.obra_a)]
    assert set(p['obras'][0]) == {'id', 'slug', 'nome'}
    hoje = su(c, 'select (now() at time zone fuso)::date from public.etapa where id = %s', (c.etapa,))[0][0]
    assert p['etapa']['hoje'] == str(hoje) and p['etapa']['nome'].startswith('Etapa')
    registro(c, c.obra_b, c.amb_b, 'servico', 's', c.gestor_b, agora())
    su(c, 'update public.obra set arquivada_em = now() where id = %s', (c.obra_b,))
    p = painel(c, c.gestor_a)
    assert [o['id'] for o in p['obras']] == [str(c.obra_a)]
    assert p['dias'] == []


def test_contagem_por_dia_no_fuso(cenario):
    c = cenario  # fuso America/Rio_Branco (UTC-5)
    preparar_etapa(c)
    # 04:30Z = 23:30 do dia 9; 05:30Z = 00:30 do dia 10 (local)
    registro(c, c.obra_a, c.amb_a, 'servico', 's1', c.gestor_a, utc(2026, 11, 10, 4, 30))
    registro(c, c.obra_a, c.amb_a, 'servico', 's2', c.gestor_a, utc(2026, 11, 10, 5, 30))
    p1, _ = registro(c, c.obra_a, c.amb_a, 'pendencia', 'p1', c.gestor_a, utc(2026, 11, 10, 4, 30))
    registro(c, c.obra_b, c.amb_b, 'pendencia', 'p2', c.gestor_b, utc(2026, 11, 10, 5, 30))
    encerrar(c, p1, c.obra_a, c.gestor_a, utc(2026, 11, 11, 4, 59))  # 23:59 do dia 10
    dias = painel(c, c.gestor_a)['dias']
    por = {(d['obra_id'], d['dia']): d for d in dias}
    a, b = str(c.obra_a), str(c.obra_b)
    assert por[(a, '2026-11-09')] == {'obra_id': a, 'dia': '2026-11-09', 'servicos': 1, 'pendencias': 1, 'resolvidas': 0}
    assert por[(a, '2026-11-10')] == {'obra_id': a, 'dia': '2026-11-10', 'servicos': 1, 'pendencias': 0, 'resolvidas': 1}
    assert por[(b, '2026-11-10')]['pendencias'] == 1
    assert len(dias) == 3
    # ordem: dia, depois obra
    assert [d['dia'] for d in dias] == ['2026-11-09', '2026-11-10', '2026-11-10']
    assert [d['obra_id'] for d in dias][0] == a
    # pendência continua contada como capturada mesmo resolvida
    assert totais(painel(c, c.gestor_a), a) == (2, 1, 1)


def test_invariante_das_abertas(cenario):
    c = cenario
    preparar_etapa(c)
    ids = [registro(c, c.obra_a, c.amb_a, 'pendencia', f'p{i}', c.gestor_a, agora() - timedelta(days=i))[0]
           for i in range(4)]
    registro(c, c.obra_b, c.amb_b, 'pendencia', 'pb', c.gestor_b, agora())
    encerrar(c, ids[0], c.obra_a, c.gestor_a, agora())
    encerrar(c, ids[3], c.obra_a, c.gestor_a, agora())
    p = painel(c, c.gestor_a)
    _, pend, res = totais(p)
    abertas = su(c, "select count(*) from public.registro r join public.obra o on o.id = r.obra_id "
                    "where o.etapa_id = %s and r.tipo = 'pendencia' and r.situacao = 'aberta'", (c.etapa,))[0][0]
    assert (pend, res) == (5, 2) and pend - res == abertas == 3


def test_relatorio_ordem_dias_e_estrutura(cenario):
    c = cenario
    preparar_etapa(c)
    su(c, 'update public.obra set ordem = 1 where id = %s', (c.obra_a,))
    su(c, 'update public.obra set ordem = 2 where id = %s', (c.obra_b,))
    t = agora()
    # aberta há 3 dias; resolvida (captura há 5 dias, encerrada há 2: 3 dias); aberta recente; obra B
    ab, _ = registro(c, c.obra_a, c.amb_a2, 'pendencia', 'aberta antiga', c.gestor_a, t - timedelta(days=3), fotos=2)
    rs, _ = registro(c, c.obra_a, c.amb_a, 'pendencia', 'resolvida', c.equipe_a, t - timedelta(days=5))
    encerrar(c, rs, c.obra_a, c.gestor_a, t - timedelta(days=2), observacao='feito', fotos=1)
    nova, _ = registro(c, c.obra_a, c.amb_a, 'pendencia', 'aberta nova', c.gestor_a, t - timedelta(hours=1))
    bb, _ = registro(c, c.obra_b, c.amb_b, 'pendencia', 'obra b', c.gestor_b, t - timedelta(days=1))
    registro(c, c.obra_a, c.amb_a, 'servico', 'serviço fora', c.gestor_a, t)
    r = relatorio(c, c.gestor_a)
    assert r['obra'] is None and r['fuso'] == 'America/Rio_Branco'
    assert set(r['organizacao']) == {'nome', 'logo_path'}
    assert set(r['etapa']) == {'id', 'slug', 'nome', 'sigla'}
    assert r['gerado_em']
    ps = r['pendencias']
    # abertas antes das resolvidas; por obra, ambiente (Ambiente 0 antes de Ambiente 1) e captura
    assert [p['id'] for p in ps] == [str(nova), str(ab), str(bb), str(rs)]
    por = {p['id']: p for p in ps}
    assert por[str(ab)]['dias'] == 3 and por[str(ab)]['situacao'] == 'aberta'
    assert por[str(ab)]['encerramento'] is None and len(por[str(ab)]['fotos']) == 2
    assert por[str(ab)]['obra'] == 'Obra a' and por[str(ab)]['pavimento'] == 'Térreo'
    assert por[str(ab)]['ambiente'] == 'Ambiente 1' and por[str(ab)]['autor'] == 'Usuário 0'
    assert por[str(nova)]['dias'] in (0, 1) and por[str(bb)]['dias'] == 1
    enc = por[str(rs)]['encerramento']
    assert por[str(rs)]['dias'] == 3 and por[str(rs)]['situacao'] == 'resolvida'
    assert enc['observacao'] == 'feito' and enc['autor'] == 'Usuário 0' and len(enc['fotos']) == 1
    assert set(enc) == {'em', 'autor', 'observacao', 'fotos'}
    assert set(por[str(ab)]['fotos'][0]) == {'path', 'largura', 'altura'}


def test_relatorio_filtro_de_obra_e_erro(cenario):
    c = cenario
    preparar_etapa(c)
    registro(c, c.obra_a, c.amb_a, 'pendencia', 'a', c.gestor_a, agora())
    pb, _ = registro(c, c.obra_b, c.amb_b, 'pendencia', 'b', c.gestor_b, agora())
    tornar_admin(c, c.sem_obra)
    r = relatorio(c, c.sem_obra, obra=c.obra_b)
    assert r['obra']['id'] == str(c.obra_b) and r['obra']['nome'] == 'Obra b'
    assert [p['id'] for p in r['pendencias']] == [str(pb)]
    assert len(relatorio(c, c.sem_obra)['pendencias']) == 2
    outra = uuid.uuid4()
    su(c, 'insert into public.etapa (id, slug, nome) values (%s, %s, %s)', (outra, f'o-{outra.hex[:8]}', 'Outra'))
    ob = uuid.uuid4()
    su(c, 'insert into public.obra (id, slug, nome, etapa_id) values (%s, %s, %s, %s)',
       (ob, f'x-{ob.hex[:8]}', 'X', outra))
    assert codigo(c, c.sem_obra, 'select public.relatorio_pendencias(%s, %s)', (c.etapa, ob)) == '22023'
    # obra arquivada some do relatório
    su(c, 'update public.obra set arquivada_em = now() where id = %s', (c.obra_b,))
    assert [p['obra'] for p in relatorio(c, c.sem_obra)['pendencias']] == ['Obra a']


def test_bucket_relatorios_privado(cenario):
    assert su(cenario, "select public from storage.buckets where id = 'relatorios'") == [(False,)]
