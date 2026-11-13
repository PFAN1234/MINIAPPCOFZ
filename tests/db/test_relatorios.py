"""Testes da RPC public.listar_relatorios (20261118100000_relatorios_mini_app.sql)."""
import uuid
from datetime import datetime, timedelta, timezone

import pytest

psycopg = pytest.importorskip('psycopg', reason='psycopg não instalado')
from psycopg import errors  # noqa: E402

from test_boletim_emissao import (  # noqa: E402,F401
    boletim, limpo, preparar_etapa, registro, rpc, sql, su, tornar_admin,
)


def hoje_da_etapa(c):
    return su(c, 'select (now() at time zone fuso)::date from public.etapa where id = %s', (c.etapa,))[0][0]


def listar(c, usuario):
    return rpc(c, usuario, 'select public.listar_relatorios()')


def etapa_de(r, c):
    achadas = [e for e in r['etapas'] if e['id'] == str(c.etapa)]
    return achadas[0] if achadas else None


def pedido(c, dia, estado='pendente', erro=None):
    su(c, 'insert into public.boletim_emissao (etapa_id, data, revisao, estado, erro) values (%s, %s, 0, %s, %s)',
       (c.etapa, dia, estado, erro))


def agora():
    return datetime.now(timezone.utc)


def nova_etapa(c):
    outra = uuid.uuid4()
    su(c, 'insert into public.etapa (id, slug, nome) values (%s, %s, %s)', (outra, f'o-{outra.hex[:8]}', 'Outra'))
    return outra


def test_sem_login(cenario):
    with pytest.raises(errors.Error) as e:
        sql(cenario, 'select public.listar_relatorios()', papel='anon')
    assert e.value.sqlstate == '42501'
    with pytest.raises(errors.Error) as e:
        sql(cenario, 'select public.listar_relatorios()')
    assert e.value.sqlstate == '28000'


def test_participante_ve_so_sua_etapa(cenario):
    c = cenario
    preparar_etapa(c)
    outra = nova_etapa(c)
    boletim(c, hoje_da_etapa(c))
    boletim(c, hoje_da_etapa(c), etapa=outra)
    r = listar(c, c.gestor_a)
    assert r['admin'] is False
    assert [e['id'] for e in r['etapas']] == [str(c.etapa)]
    assert {b['etapa_id'] for b in r['boletins']} == {str(c.etapa)}
    vazio = listar(c, c.sem_obra)
    assert vazio['etapas'] == [] and vazio['boletins'] == []


def test_admin_ve_todas(cenario):
    c = cenario
    preparar_etapa(c)
    tornar_admin(c, c.sem_obra)
    outra = nova_etapa(c)
    boletim(c, hoje_da_etapa(c), etapa=outra)
    r = listar(c, c.sem_obra)
    assert r['admin'] is True
    assert {str(c.etapa), str(outra)} <= {e['id'] for e in r['etapas']}
    assert str(outra) in {b['etapa_id'] for b in r['boletins']}


def test_registros_hoje_conta_so_o_dia(cenario):
    c = cenario
    preparar_etapa(c)
    registro(c, c.obra_a, c.amb_a, 'servico', 'hoje', c.gestor_a, agora())
    registro(c, c.obra_b, c.amb_b, 'servico', 'hoje b', c.gestor_b, agora())
    registro(c, c.obra_a, c.amb_a, 'servico', 'antigo', c.gestor_a, agora() - timedelta(days=3))
    e = etapa_de(listar(c, c.gestor_a), c)
    assert e['registros_hoje'] == 2
    assert e['horario'] == '22:00'
    assert e['hoje'] == str(hoje_da_etapa(c))


def test_registros_hoje_ignora_obra_arquivada(cenario):
    c = cenario
    preparar_etapa(c)
    registro(c, c.obra_a, c.amb_a, 'servico', 'a', c.gestor_a, agora())
    registro(c, c.obra_b, c.amb_b, 'servico', 'b', c.gestor_b, agora())
    su(c, "update public.obra set arquivada_em = now() - interval '5 days' where id = %s", (c.obra_b,))
    assert etapa_de(listar(c, c.gestor_a), c)['registros_hoje'] == 1


def test_boletim_hoje_traz_ultima_revisao(cenario):
    c = cenario
    preparar_etapa(c)
    dia = hoje_da_etapa(c)
    assert etapa_de(listar(c, c.gestor_a), c)['boletim_hoje'] is None
    boletim(c, dia, 0)
    b1 = boletim(c, dia, 1)
    boletim(c, dia - timedelta(days=1), 2)
    bh = etapa_de(listar(c, c.gestor_a), c)['boletim_hoje']
    assert bh['id'] == str(b1) and bh['revisao'] == 1


def test_pedido_hoje_e_erro_so_para_admin(cenario):
    c = cenario
    preparar_etapa(c)
    tornar_admin(c, c.sem_obra)
    assert etapa_de(listar(c, c.gestor_a), c)['pedido_hoje'] is None
    pedido(c, hoje_da_etapa(c), 'falhou', 'Deu ruim')
    assert etapa_de(listar(c, c.gestor_a), c)['pedido_hoje'] == {'estado': 'falhou', 'erro': None}
    assert etapa_de(listar(c, c.sem_obra), c)['pedido_hoje'] == {'estado': 'falhou', 'erro': 'Deu ruim'}


def test_pedido_de_outro_dia_nao_aparece(cenario):
    c = cenario
    preparar_etapa(c)
    pedido(c, hoje_da_etapa(c) - timedelta(days=1))
    assert etapa_de(listar(c, c.gestor_a), c)['pedido_hoje'] is None


def test_ultima_revisao_e_publicado(cenario):
    c = cenario
    preparar_etapa(c)
    dia = hoje_da_etapa(c)
    b0, b1 = boletim(c, dia, 0), boletim(c, dia, 1)
    su(c, "insert into public.publicacao_telegram (boletim_id, estado) values (%s, 'publicado')", (b0,))
    su(c, "insert into public.publicacao_telegram (boletim_id, estado) values (%s, 'pendente')", (b1,))
    r = listar(c, c.gestor_a)
    assert [b['revisao'] for b in r['boletins']] == [1, 0]
    por_rev = {b['revisao']: b for b in r['boletins']}
    assert por_rev[1]['ultima_revisao'] is True and por_rev[0]['ultima_revisao'] is False
    assert por_rev[0]['publicado'] is True and por_rev[1]['publicado'] is False


def test_etapa_arquivada_nao_aparece_em_etapas(cenario):
    c = cenario
    preparar_etapa(c)
    boletim(c, hoje_da_etapa(c))
    su(c, 'update public.etapa set arquivada_em = now() where id = %s', (c.etapa,))
    assert etapa_de(listar(c, c.gestor_a), c) is None
