"""Nome de exibição nas RPCs do Mini App. Contrato: docs/contrato-boletim.md, parte 2."""
import json
import uuid
from datetime import datetime, timezone

import pytest

psycopg = pytest.importorskip('psycopg', reason='psycopg não instalado')
from psycopg import errors  # noqa: E402

from conftest import sessao  # noqa: E402


def sql(c, comando, params=(), papel='authenticated', usuario=None):
    with sessao(c.dsn, usuario, papel=papel) as cur:
        cur.execute(comando, params)
        return cur.fetchall() if cur.description else None


def su(c, comando, params=()):
    return sql(c, comando, params, papel=None)


def nome_exibicao(c, usuario, nome):
    su(c, 'update public.usuario set nome_exibicao = %s where id = %s', (nome, usuario))


def membro(c, usuario, obra):
    su(c, 'insert into privado.membro_grupo (obra_id, usuario_id, conferido_em) values (%s, %s, now()) '
          'on conflict (obra_id, usuario_id) do update set conferido_em = excluded.conferido_em', (obra, usuario))


def solicitar(c, usuario, obra):
    with sessao(c.dsn, usuario) as cur:
        cur.execute('select id from public.solicitar_acesso(%s)', (obra,))
        return cur.fetchone()[0]


def test_listar_participantes_usa_o_nome_de_exibicao(cenario):
    c = cenario
    extra = uuid.uuid4()
    su(c, 'insert into auth.users (id, email) values (%s, %s)', (extra, f'{extra}@teste.invalid'))
    su(c, "insert into public.usuario (id, telegram_id, nome, username) values (%s, %s, 'Ana Telegram', 'ana')",
       (extra, uuid.uuid4().int % 10**15))
    su(c, "insert into public.participacao (obra_id, usuario_id, papel) values (%s, %s, 'equipe')",
       (c.obra_a, extra))
    nome_exibicao(c, c.equipe_a, 'SGT ZULU')
    r = sql(c, 'select usuario_id, nome, username, papel from public.listar_participantes(%s)',
            (c.obra_a,), usuario=c.gestor_a)
    # Gestores primeiro; dentro do papel, pelo nome mostrado (ANA vem antes de SGT ZULU).
    assert r == [
        (c.gestor_a, 'Usuário 0', None, 'gestor'),
        (extra, 'Ana Telegram', 'ana', 'equipe'),
        (c.equipe_a, 'SGT ZULU', None, 'equipe'),
    ]
    # Sem nome de exibição volta ao nome do Telegram.
    nome_exibicao(c, c.equipe_a, None)
    r = sql(c, 'select nome from public.listar_participantes(%s)', (c.obra_a,), usuario=c.gestor_a)
    assert [x[0] for x in r] == ['Usuário 0', 'Ana Telegram', 'Usuário 1']


def test_listar_participantes_so_gestor(cenario):
    c = cenario
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, 'select * from public.listar_participantes(%s)', (c.obra_a,), usuario=c.equipe_a)


def test_listar_solicitacoes_usa_o_nome_de_exibicao(cenario):
    c = cenario
    su(c, "update public.usuario set username = 'quem_pede' where id = %s", (c.sem_obra,))
    membro(c, c.sem_obra, c.obra_a)
    sid = solicitar(c, c.sem_obra, c.obra_a)
    consulta = 'select id, usuario_id, nome, username from public.listar_solicitacoes(%s)'
    assert sql(c, consulta, (c.obra_a,), usuario=c.gestor_a) == [(sid, c.sem_obra, 'Usuário 3', 'quem_pede')]
    nome_exibicao(c, c.sem_obra, 'CP PATRICIO')
    assert sql(c, consulta, (c.obra_a,), usuario=c.gestor_a) == [(sid, c.sem_obra, 'CP PATRICIO', 'quem_pede')]
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, consulta, (c.obra_a,), usuario=c.equipe_a)


@pytest.mark.parametrize('assinatura', ['listar_participantes(uuid)', 'listar_solicitacoes(uuid)'])
def test_assinatura_e_grants_mantidos(cenario, assinatura):
    c = cenario
    r = su(c, "select has_function_privilege('authenticated', %s, 'execute'), "
              "has_function_privilege('anon', %s, 'execute'), "
              "pg_get_function_result(%s::regprocedure)",
           (f'public.{assinatura}',) * 3)
    autenticado, anonimo, resultado = r[0]
    assert autenticado and not anonimo
    esperado = {
        'listar_participantes(uuid)':
            'TABLE(usuario_id uuid, nome text, username text, papel text, desde timestamp with time zone)',
        'listar_solicitacoes(uuid)':
            'TABLE(id uuid, usuario_id uuid, nome text, username text, criado_em timestamp with time zone)',
    }[assinatura]
    assert resultado == esperado


def test_observacoes_usam_o_nome_de_exibicao(cenario):
    c = cenario
    nome_exibicao(c, c.equipe_a, 'CP PATRICIO')
    oid = uuid.uuid4()
    with sessao(c.dsn, c.equipe_a) as cur:
        cur.execute('select public.salvar_observacao(%s::jsonb)', (json.dumps({
            'id': str(oid), 'obra_id': str(c.obra_a), 'texto': 'Concretagem',
            'escrito_em': datetime.now(timezone.utc).isoformat(),
        }),))
        salvo = cur.fetchone()[0]
    assert salvo['autor'] == {'id': str(c.equipe_a), 'nome': 'CP PATRICIO'}
    lista = sql(c, 'select public.observacoes_do_dia(%s)', (c.obra_a,), usuario=c.gestor_a)[0][0]
    assert [o['autor']['nome'] for o in lista if o['id'] == str(oid)] == ['CP PATRICIO']
