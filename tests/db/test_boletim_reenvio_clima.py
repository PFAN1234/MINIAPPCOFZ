"""Testes da migration do reenvio ao Telegram e do clima de boletim anterior (20261114150000).

Contrato: docs/contrato-boletim.md ("Reenvio ao Telegram e clima de boletim anterior").
Reaproveita os auxiliares de test_boletim_emissao.py.
"""
import uuid
from datetime import date

import pytest

psycopg = pytest.importorskip('psycopg', reason='psycopg não instalado')
from psycopg import errors  # noqa: E402

from test_boletim_emissao import (  # noqa: E402,F401
    DIA, boletim, limpo, preparar_etapa, rpc, slug, sql, srv, su, tornar_admin,
)


def com_grupo(c):
    su(c, 'update public.etapa set telegram_chat_id = %s where id = %s', (-(uuid.uuid4().int % 10**12), c.etapa))


def publicacao(c, b, estado, tentativas=0, erro=None):
    su(c, 'insert into public.publicacao_telegram (boletim_id, estado, tentativas, erro) values (%s, %s, %s, %s)',
       (b, estado, tentativas, erro))


def reenviar(c, b, s=None):
    return rpc(c, c.sem_obra, 'select public.admin_reenviar_boletim(%s, %s)', (s or slug(c), b))


def estado(c, b):
    return su(c, 'select estado, tentativas, erro, proxima_tentativa_em <= now() from public.publicacao_telegram '
                 'where boletim_id = %s', (b,))


@pytest.mark.parametrize('antes', ['falhou', 'incerto'])
def test_reenviar_volta_a_pendente(cenario, antes):
    c = cenario
    preparar_etapa(c)
    com_grupo(c)
    tornar_admin(c, c.sem_obra)
    b = boletim(c, DIA)
    publicacao(c, b, antes, tentativas=8, erro='Telegram fora do ar')
    su(c, "update public.publicacao_telegram set proxima_tentativa_em = now() + interval '1 day' "
          "where boletim_id = %s", (b,))
    assert reenviar(c, b) == {'boletim_id': str(b), 'publicacao_estado': 'pendente'}
    assert estado(c, b) == [('pendente', 0, None, True)]


def test_reenviar_sem_linha_cria_pendente(cenario):
    c = cenario
    preparar_etapa(c)
    com_grupo(c)
    tornar_admin(c, c.sem_obra)
    b = boletim(c, DIA)
    assert reenviar(c, b)['publicacao_estado'] == 'pendente'
    assert estado(c, b)[0][:3] == ('pendente', 0, None)


@pytest.mark.parametrize('atual, erro', [
    ('pendente', errors.UniqueViolation), ('enviando', errors.UniqueViolation),
    ('publicado', errors.InvalidParameterValue),
])
def test_reenviar_recusa_estados(cenario, atual, erro):
    c = cenario
    preparar_etapa(c)
    com_grupo(c)
    tornar_admin(c, c.sem_obra)
    b = boletim(c, DIA)
    publicacao(c, b, atual)
    with pytest.raises(erro):
        reenviar(c, b)
    assert estado(c, b)[0][0] == atual


def test_reenviar_nao_admin_sem_grupo_e_outra_etapa(cenario):
    c = cenario
    preparar_etapa(c)
    s = slug(c)
    b = boletim(c, DIA)
    publicacao(c, b, 'falhou')
    with pytest.raises(errors.InsufficientPrivilege):
        rpc(c, c.gestor_a, 'select public.admin_reenviar_boletim(%s, %s)', (s, b))
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, 'select public.admin_reenviar_boletim(%s, %s)', (s, b), papel='anon')
    tornar_admin(c, c.sem_obra)
    with pytest.raises(errors.InvalidParameterValue, match='grupo do Telegram'):
        reenviar(c, b)
    com_grupo(c)
    with pytest.raises(errors.NoDataFound, match='Boletim não encontrado'):
        reenviar(c, uuid.uuid4())
    outra = su(c, 'select id from public.etapa where id <> %s limit 1', (c.etapa,))
    if outra:
        b2 = boletim(c, DIA, etapa=outra[0][0])
        with pytest.raises(errors.NoDataFound):
            reenviar(c, b2)


def test_listar_traz_erro_e_tentativas(cenario):
    c = cenario
    preparar_etapa(c)
    tornar_admin(c, c.sem_obra)
    b0 = boletim(c, DIA)
    b1 = boletim(c, DIA, 1)
    publicacao(c, b0, 'falhou', tentativas=3, erro='chat not found')
    r = rpc(c, c.sem_obra, 'select public.admin_listar_boletins(%s)', (slug(c),))['boletins']
    por_id = {x['id']: x for x in r}
    assert (por_id[str(b0)]['publicacao_erro'], por_id[str(b0)]['publicacao_tentativas']) == ('chat not found', 3)
    assert (por_id[str(b1)]['publicacao_erro'], por_id[str(b1)]['publicacao_tentativas']) == (None, 0)


def snap(indisponivel=False):
    if indisponivel:
        return {'clima': {'indisponivel': True, 'motivo': 'sem leitura'}}
    return {'clima': {'fonte': 'observatorio', 'estacao': {'codigo': '8836', 'nome': 'Montese'},
                      'imagem_path': 'clima/x.png'}}


def test_clima_anterior(cenario):
    c = cenario
    preparar_etapa(c)
    comando = 'select public.boletim_clima_anterior(%s, %s)'
    assert srv(c, comando, (c.etapa, DIA)) is None
    boletim(c, DIA, 0, snapshot=snap(indisponivel=True))
    assert srv(c, comando, (c.etapa, DIA)) is None
    boletim(c, DIA, 1, snapshot=snap())
    boletim(c, DIA, 2, snapshot=snap(indisponivel=True))
    boletim(c, date(2026, 11, 11), 3, snapshot=snap())
    r = srv(c, comando, (c.etapa, DIA))
    assert r['revisao'] == 1 and r['clima']['imagem_path'] == 'clima/x.png' and r['numero']
    boletim(c, DIA, 4, snapshot=snap())
    assert srv(c, comando, (c.etapa, DIA))['revisao'] == 4
    for papel in ('authenticated', 'anon'):
        with pytest.raises(errors.InsufficientPrivilege):
            sql(c, comando, (c.etapa, DIA), papel=papel)
