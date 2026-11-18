"""Testes do registro de erros do cliente (registrar_erro_cliente e admin_listar_erros_cliente).

Contrato: docs/contrato-erros-orfaos.md (A). O banco é compartilhado na sessão: cada teste usa
usuários e mensagens próprios.
"""
import json
import uuid
from types import SimpleNamespace

import pytest

psycopg = pytest.importorskip('psycopg', reason='psycopg não instalado')
from psycopg import errors  # noqa: E402

from conftest import sessao  # noqa: E402


@pytest.fixture
def c(dsn):
    return SimpleNamespace(dsn=dsn)


def sql(c, comando, params=(), papel='authenticated', usuario=None):
    with sessao(c.dsn, usuario, papel=papel) as cur:
        cur.execute(comando, params)
        return cur.fetchall() if cur.description else None


def su(c, comando, params=()):
    return sql(c, comando, params, papel=None)


def novo_usuario(c, admin=False):
    uid = uuid.uuid4()
    su(c, 'insert into auth.users (id, email) values (%s, %s)', (uid, f'{uid}@teste.invalid'))
    su(c, 'insert into public.usuario (id, telegram_id, nome) values (%s, %s, %s)',
       (uid, uuid.uuid4().int % 10**15, 'Fulano ' + uid.hex[:6]))
    if admin:
        su(c, 'insert into public.admin_app (usuario_id) values (%s)', (uid,))
    return uid


def registrar(c, usuario, mensagem='falhou', app='miniapp', versao='v1', rota='/x', pilha=None,
              agente='ua', contexto=None, papel='authenticated'):
    sql(c, 'select public.registrar_erro_cliente(%s, %s, %s, %s, %s, %s, %s::jsonb)',
        (app, versao, rota, mensagem, pilha, agente, None if contexto is None else json.dumps(contexto)),
        papel=papel, usuario=usuario)


def linhas(c, usuario):
    return su(c, 'select app, versao, rota, mensagem, pilha, agente, contexto from public.erro_cliente '
                 'where usuario_id = %s order by id', (usuario,))


def test_grava_com_sessao(c):
    u = novo_usuario(c)
    registrar(c, u, 'quebrou', pilha='at x', contexto={'a': 1})
    assert linhas(c, u) == [('miniapp', 'v1', '/x', 'quebrou', 'at x', 'ua', {'a': 1})]


def test_sem_sessao_nao_grava(c):
    msg = 'sem-sessao-' + uuid.uuid4().hex
    registrar(c, None, msg)  # papel authenticated, mas sem auth.uid()
    assert su(c, 'select count(*) from public.erro_cliente where mensagem = %s', (msg,))[0][0] == 0


def test_anon_nao_executa(c):
    with pytest.raises(errors.InsufficientPrivilege):
        registrar(c, None, 'x', papel='anon')


def test_corta_textos_longos(c):
    u = novo_usuario(c)
    registrar(c, u, 'm' * 2000, versao='v' * 100, rota='r' * 500, pilha='p' * 20000, agente='a' * 500)
    _, versao, rota, mensagem, pilha, agente, _ = linhas(c, u)[0]
    assert (len(versao), len(rota), len(mensagem), len(pilha), len(agente)) == (50, 300, 1000, 8000, 300)


def test_contexto_grande_vira_nulo(c):
    u = novo_usuario(c)
    registrar(c, u, 'a', contexto={'x': 'y' * 5000})
    registrar(c, u, 'b', contexto={'x': 'y'})
    assert [r[6] for r in linhas(c, u)] == [None, {'x': 'y'}]


def test_app_invalido_ignorado(c):
    u = novo_usuario(c)
    registrar(c, u, 'a', app='outro')
    assert linhas(c, u) == []


def test_limite_por_minuto(c):
    u = novo_usuario(c)
    for i in range(25):
        registrar(c, u, f'e{i}')
    assert len(linhas(c, u)) == 20
    # Registros antigos não contam.
    su(c, "update public.erro_cliente set criado_em = now() - interval '2 minutes' where usuario_id = %s", (u,))
    registrar(c, u, 'depois')
    assert len(linhas(c, u)) == 21


def test_nao_admin_nao_le_nem_lista(c):
    u = novo_usuario(c)
    registrar(c, u, 'privado')
    assert sql(c, 'select count(*) from public.erro_cliente', usuario=u)[0][0] == 0
    with pytest.raises(errors.Error):
        sql(c, 'select * from public.admin_listar_erros_cliente()', usuario=u)
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, 'select * from public.admin_listar_erros_cliente()', papel='anon')


def test_admin_lista_mais_recentes_primeiro(c):
    u = novo_usuario(c)
    adm = novo_usuario(c, admin=True)
    tag = uuid.uuid4().hex
    registrar(c, u, f'{tag}-1', pilha='pilha 1')
    registrar(c, u, f'{tag}-2', app='admin')
    lista = sql(c, 'select mensagem, app, usuario_nome, pilha from public.admin_listar_erros_cliente(1000)',
                usuario=adm)
    minhas = [r for r in lista if r[0].startswith(tag)]
    assert [r[0] for r in minhas] == [f'{tag}-2', f'{tag}-1']
    assert minhas[0][1] == 'admin' and minhas[0][2].startswith('Fulano')
    assert minhas[1][3] == 'pilha 1'
    assert sql(c, 'select count(*) from public.erro_cliente', usuario=adm)[0][0] >= 2
    assert len(sql(c, 'select * from public.admin_listar_erros_cliente(1)', usuario=adm)) == 1


def test_cron_de_retencao_agendado(c):
    r = su(c, "select schedule, command from cron.job where jobname = 'limpar-erro-cliente'")
    assert len(r) == 1 and '90 days' in r[0][1]
