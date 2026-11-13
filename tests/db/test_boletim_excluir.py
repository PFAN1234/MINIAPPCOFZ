"""Testes da exclusão de boletim (20261118090000_boletim_excluir.sql): apaga o dia inteiro."""
import json
import uuid
from datetime import timedelta

import pytest

psycopg = pytest.importorskip('psycopg', reason='psycopg não instalado')
from psycopg import errors  # noqa: E402

from test_boletim_emissao import (  # noqa: E402,F401
    DIA, boletim, limpo, pedido, preparar_etapa, rpc, su, tornar_admin,
)


def excluir(c, b, usuario=None):
    return rpc(c, usuario or c.sem_obra, 'select public.admin_excluir_boletim(%s)', (b,))


def admin_pronto(c):
    preparar_etapa(c)
    tornar_admin(c, c.sem_obra)


def com_pdf(c, b):
    n, etapa = su(c, 'select numero, etapa_id from public.boletim where id = %s', (b,))[0]
    caminho = f"{etapa}/{n.replace('/', '')}.pdf"
    su(c, 'update public.boletim set pdf_path = %s where id = %s', (caminho, b))
    return caminho


def contar(c, tabela, etapa=None):
    return su(c, f'select count(*) from public.{tabela} where etapa_id = %s', (etapa or c.etapa,))[0][0]


def test_nao_admin_recusado(cenario):
    c = cenario
    preparar_etapa(c)
    b = boletim(c, DIA)
    with pytest.raises(errors.InsufficientPrivilege):
        excluir(c, b)
    assert contar(c, 'boletim') == 1


def test_inexistente(cenario):
    c = cenario
    admin_pronto(c)
    with pytest.raises(errors.NoDataFound, match='Boletim não encontrado'):
        excluir(c, uuid.uuid4())


def test_apaga_o_dia_inteiro_e_so_ele(cenario):
    c = cenario
    admin_pronto(c)
    outra = uuid.uuid4()
    su(c, "insert into public.etapa (id, slug, nome, sigla, fuso, boletim_horario) "
          "values (%s, %s, %s, %s, 'America/Rio_Branco', '22:00')",
       (outra, f'outra-{outra.hex[:8]}', f'Outra {outra.hex[:8]}', f'O{outra.hex[:6].upper()}'))
    b0 = boletim(c, DIA)
    b1 = boletim(c, DIA, 1)
    b_outro_dia = boletim(c, DIA + timedelta(days=1))
    b_outra_etapa = boletim(c, DIA, etapa=outra)
    su(c, 'update public.boletim set base_boletim_id = %s, edicao = %s::jsonb where id = %s',
       (b0, json.dumps({'ocultos': ['a']}), b1))
    pedido(c, DIA, 0, estado='emitido', boletim_id=b0)
    pedido(c, DIA, 1, estado='falhou')
    pedido(c, DIA + timedelta(days=1), 0)
    pedido(c, DIA, 0, etapa=outra)
    su(c, "insert into public.publicacao_telegram (boletim_id, estado) values (%s, 'publicado'), (%s, 'falhou')",
       (b0, b1))
    su(c, "insert into public.boletim_rascunho (boletim_id, edicao) values (%s, '{\"ocultos\": [\"x\"]}')", (b1,))

    r = excluir(c, b1)
    assert r['revisoes'] == 2
    assert su(c, 'select id from public.boletim where etapa_id = %s', (c.etapa,)) == [(b_outro_dia,)]
    assert su(c, 'select count(*) from public.boletim_emissao where etapa_id = %s and data = %s',
              (c.etapa, DIA)) == [(0,)]
    assert contar(c, 'boletim_emissao') == 1
    assert contar(c, 'boletim_emissao', outra) == 1
    assert su(c, 'select id from public.boletim where etapa_id = %s', (outra,)) == [(b_outra_etapa,)]
    assert su(c, 'select count(*) from public.publicacao_telegram where boletim_id in (%s, %s)',
              (b0, b1)) == [(0,)]
    assert su(c, 'select count(*) from public.boletim_rascunho where boletim_id = %s', (b1,)) == [(0,)]


def test_retorno_com_mensagens_e_arquivos(cenario):
    c = cenario
    admin_pronto(c)
    chat = -1001234567890
    su(c, 'update public.etapa set telegram_chat_id = %s where id = %s', (chat, c.etapa))
    b0 = boletim(c, DIA)
    b1 = boletim(c, DIA, 1)
    b2 = boletim(c, DIA, 2)  # sem pdf
    p0, p1 = com_pdf(c, b0), com_pdf(c, b1)
    n1 = su(c, 'select numero from public.boletim where id = %s', (b1,))[0][0]
    su(c, "insert into public.publicacao_telegram (boletim_id, estado, message_ids) values "
          "(%s, 'publicado', '{10,11}'), (%s, 'incerto', '{12}'), (%s, 'falhou', null)", (b0, b1, b2))
    r = excluir(c, b1)
    assert r['numero'] == n1
    assert r['data'] == DIA.isoformat()
    assert r['etapa_id'] == str(c.etapa)
    assert r['revisoes'] == 3
    assert r['chat_id'] == chat
    assert r['mensagens'] == [10, 11, 12]
    assert sorted(r['arquivos']) == sorted([p0, p0[:-4] + '-clima.png', p1, p1[:-4] + '-clima.png'])


def test_chat_nulo_sem_mensagens_nem_arquivos(cenario):
    c = cenario
    admin_pronto(c)
    b = boletim(c, DIA)
    r = excluir(c, b)
    assert r['chat_id'] is None and r['mensagens'] == [] and r['arquivos'] == []


def test_bloqueio_emissao_gerando(cenario):
    c = cenario
    admin_pronto(c)
    b = boletim(c, DIA)
    pedido(c, DIA, 1, estado='gerando')
    with pytest.raises(errors.ObjectInUse, match='em andamento'):
        excluir(c, b)
    assert contar(c, 'boletim') == 1 and contar(c, 'boletim_emissao') == 1


def test_bloqueio_envio_enviando(cenario):
    c = cenario
    admin_pronto(c)
    b = boletim(c, DIA)
    su(c, "insert into public.publicacao_telegram (boletim_id, estado) values (%s, 'enviando')", (b,))
    with pytest.raises(errors.ObjectInUse, match='em andamento'):
        excluir(c, b)
    assert contar(c, 'boletim') == 1
