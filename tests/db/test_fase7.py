"""Testes da migration da fase 7 (gestão e publicações com problema). Contrato: docs/contrato-fase7.md, seção A."""
import uuid

import pytest

psycopg = pytest.importorskip('psycopg', reason='psycopg não instalado')
from psycopg import errors  # noqa: E402

from conftest import sessao  # noqa: E402

ASSINATURAS = [
    'listar_participantes(uuid)', 'definir_papel(uuid, uuid, text)', 'remover_participante(uuid, uuid)',
    'listar_publicacoes_problema(uuid)', 'republicar(bigint)', 'marcar_publicada(bigint)',
]


@pytest.fixture(autouse=True)
def limpo(dsn):
    with sessao(dsn, papel=None) as cur:
        cur.execute('delete from public.publicacao_telegram')
        cur.execute('delete from vault.decrypted_secrets')
        cur.execute('delete from net.pedido_stub')


def sql(c, comando, params=(), papel='authenticated', usuario=None):
    with sessao(c.dsn, usuario, papel=papel) as cur:
        cur.execute(comando, params)
        return cur.fetchall() if cur.description else None


def participantes(c, usuario, obra=None):
    return sql(c, 'select usuario_id, nome, username, papel, desde from public.listar_participantes(%s)',
               (obra or c.obra_a,), usuario=usuario)


def papel_em(c, usuario, obra):
    r = sql(c, 'select papel from public.participacao where obra_id = %s and usuario_id = %s',
            (obra, usuario), papel=None)
    return r[0][0] if r else None


def nova_publicacao(c, estado='pendente', obra=None, **colunas):
    obra = obra or c.obra_a
    amb = c.amb_a if obra == c.obra_a else c.amb_b
    rid = uuid.uuid4()
    with sessao(c.dsn, papel=None) as cur:
        cur.execute(
            "insert into public.registro (id, obra_id, ambiente_id, tipo, legenda, autor_id, capturado_em) "
            "values (%s, %s, %s, 'servico', 'Reboco', %s, now())", (rid, obra, amb, c.gestor_a))
        cur.execute("insert into public.publicacao_telegram (obra_id, registro_id, estado) values (%s, %s, %s) "
                    "returning id", (obra, rid, estado))
        pid = cur.fetchone()[0]
        for k, v in colunas.items():
            cur.execute(f'update public.publicacao_telegram set {k} = {v} where id = %s', (pid,))
    return pid, rid


def nova_pub_encerramento(c, observacao, estado='falhou'):
    rid, eid = uuid.uuid4(), uuid.uuid4()
    with sessao(c.dsn, papel=None) as cur:
        cur.execute(
            "insert into public.registro (id, obra_id, ambiente_id, tipo, legenda, autor_id, capturado_em, situacao) "
            "values (%s, %s, %s, 'pendencia', 'Furo', %s, now(), 'resolvida')",
            (rid, c.obra_a, c.amb_a, c.gestor_a))
        cur.execute("insert into public.encerramento (id, registro_id, obra_id, gestor_id, observacao) "
                    "values (%s, %s, %s, %s, %s)", (eid, rid, c.obra_a, c.gestor_a, observacao))
        cur.execute("insert into public.publicacao_telegram (obra_id, encerramento_id, estado) "
                    "values (%s, %s, %s) returning id", (c.obra_a, eid, estado))
        return cur.fetchone()[0], rid, eid


def pub(c, pid):
    return sql(c, 'select estado, tentativas, erro, proxima_tentativa_em <= now() '
                  'from public.publicacao_telegram where id = %s', (pid,), papel=None)[0]


def problemas(c, usuario, obra=None):
    return sql(c, 'select id, estado, erro, tentativas, registro_id, encerramento_id, tipo, legenda, ambiente '
                  'from public.listar_publicacoes_problema(%s)', (obra or c.obra_a,), usuario=usuario)


def segredos(c):
    with sessao(c.dsn, papel=None) as cur:
        cur.execute("insert into vault.decrypted_secrets (name, decrypted_secret) values "
                    "('url_projeto', 'https://exemplo.supabase.co'), ('segredo_interno', 's')")


# --- permissões -------------------------------------------------------------------------------

def test_equipe_e_nao_participante_recebem_42501(cenario):
    c = cenario
    pid, _ = nova_publicacao(c, 'falhou')
    chamadas = [
        ('select * from public.listar_participantes(%s)', (c.obra_a,)),
        ("select public.definir_papel(%s, %s, 'equipe')", (c.obra_a, c.equipe_a)),
        ('select public.remover_participante(%s, %s)', (c.obra_a, c.equipe_a)),
        ('select * from public.listar_publicacoes_problema(%s)', (c.obra_a,)),
        ('select public.republicar(%s)', (pid,)),
        ('select public.marcar_publicada(%s)', (pid,)),
    ]
    for usuario in (c.equipe_a, c.sem_obra, c.gestor_b):
        for comando, params in chamadas:
            with pytest.raises(errors.InsufficientPrivilege):
                sql(c, comando, params, usuario=usuario)
    assert pub(c, pid)[0] == 'falhou'
    assert len(participantes(c, c.gestor_a)) == 2


def test_sem_usuario_28000_e_anon_sem_execute(cenario):
    c = cenario
    with pytest.raises(errors.InvalidAuthorizationSpecification) as e:
        sql(c, 'select * from public.listar_participantes(%s)', (c.obra_a,))
    assert e.value.sqlstate == '28000'
    for assinatura in ASSINATURAS:
        r = sql(c, "select has_function_privilege('anon', %s, 'execute'), "
                   "has_function_privilege('authenticated', %s, 'execute')",
                (f'public.{assinatura}', f'public.{assinatura}'), papel=None)
        assert r == [(False, True)], assinatura
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, 'select public.republicar(1)', papel='anon')


# --- listar_participantes ---------------------------------------------------------------------

def test_listar_participantes_ordem_e_colunas(cenario):
    c = cenario
    with sessao(c.dsn, papel=None) as cur:
        cur.execute("update public.usuario set nome = 'Zeca', username = 'zeca' where id = %s", (c.gestor_a,))
        cur.execute("update public.usuario set nome = 'Ana' where id = %s", (c.equipe_a,))
        # outro gestor com nome depois da equipe, e outro de equipe antes
        for nome, papel in (('Bia', 'gestor'), ('Abel', 'equipe')):
            uid = uuid.uuid4()
            cur.execute('insert into auth.users (id, email) values (%s, %s)', (uid, f'{uid}@teste.invalid'))
            cur.execute('insert into public.usuario (id, telegram_id, nome) values (%s, %s, %s)',
                        (uid, uuid.uuid4().int % 10**15, nome))
            cur.execute('insert into public.participacao (obra_id, usuario_id, papel) values (%s, %s, %s)',
                        (c.obra_a, uid, papel))
    r = participantes(c, c.gestor_a)
    assert [(x[1], x[3]) for x in r] == [('Bia', 'gestor'), ('Zeca', 'gestor'), ('Abel', 'equipe'), ('Ana', 'equipe')]
    assert next(x for x in r if x[1] == 'Zeca')[2] == 'zeca'
    assert all(x[4] is not None for x in r)
    # outra obra não vaza
    assert len(participantes(c, c.gestor_b, c.obra_b)) == 1


# --- definir_papel ----------------------------------------------------------------------------

def test_definir_papel_promove_e_rebaixa(cenario):
    c = cenario
    sql(c, "select public.definir_papel(%s, %s, 'gestor')", (c.obra_a, c.equipe_a), usuario=c.gestor_a)
    assert papel_em(c, c.equipe_a, c.obra_a) == 'gestor'
    sql(c, "select public.definir_papel(%s, %s, 'equipe')", (c.obra_a, c.gestor_a), usuario=c.equipe_a)
    assert papel_em(c, c.gestor_a, c.obra_a) == 'equipe'


def test_definir_papel_invalido_e_inexistente(cenario):
    c = cenario
    with pytest.raises(errors.InvalidParameterValue):
        sql(c, "select public.definir_papel(%s, %s, 'admin')", (c.obra_a, c.equipe_a), usuario=c.gestor_a)
    with pytest.raises(errors.InvalidParameterValue):
        sql(c, 'select public.definir_papel(%s, %s, null)', (c.obra_a, c.equipe_a), usuario=c.gestor_a)
    with pytest.raises(errors.NoDataFound) as e:
        sql(c, "select public.definir_papel(%s, %s, 'equipe')", (c.obra_a, c.sem_obra), usuario=c.gestor_a)
    assert e.value.sqlstate == 'P0002'


def test_definir_papel_ultimo_gestor(cenario):
    c = cenario
    with pytest.raises(errors.InvalidParameterValue, match='A obra precisa de pelo menos um gestor.'):
        sql(c, "select public.definir_papel(%s, %s, 'equipe')", (c.obra_a, c.gestor_a), usuario=c.gestor_a)
    assert papel_em(c, c.gestor_a, c.obra_a) == 'gestor'
    # com outro gestor, o rebaixamento é permitido
    sql(c, "select public.definir_papel(%s, %s, 'gestor')", (c.obra_a, c.equipe_a), usuario=c.gestor_a)
    sql(c, "select public.definir_papel(%s, %s, 'equipe')", (c.obra_a, c.gestor_a), usuario=c.gestor_a)
    # promover quem já é gestor continua valendo
    sql(c, "select public.definir_papel(%s, %s, 'gestor')", (c.obra_a, c.equipe_a), usuario=c.equipe_a)


# --- remover_participante ----------------------------------------------------------------------

def test_remover_participante_apaga_membro_grupo(cenario):
    c = cenario
    with sessao(c.dsn, papel=None) as cur:
        for u in (c.equipe_a, c.gestor_a):
            cur.execute('insert into privado.membro_grupo (obra_id, usuario_id) values (%s, %s)', (c.obra_a, u))
    sql(c, 'select public.remover_participante(%s, %s)', (c.obra_a, c.equipe_a), usuario=c.gestor_a)
    assert papel_em(c, c.equipe_a, c.obra_a) is None
    assert sql(c, 'select usuario_id from privado.membro_grupo where obra_id = %s', (c.obra_a,),
               papel=None) == [(c.gestor_a,)]
    # precisa pedir acesso de novo: a obra não aparece mais como disponível sem conferência
    assert sql(c, 'select * from public.obras_disponiveis()', usuario=c.equipe_a) == []
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, 'select public.solicitar_acesso(%s)', (c.obra_a,), usuario=c.equipe_a)


def test_remover_participante_ultimo_gestor_e_inexistente(cenario):
    c = cenario
    with pytest.raises(errors.InvalidParameterValue, match='A obra precisa de pelo menos um gestor.'):
        sql(c, 'select public.remover_participante(%s, %s)', (c.obra_a, c.gestor_a), usuario=c.gestor_a)
    assert papel_em(c, c.gestor_a, c.obra_a) == 'gestor'
    with pytest.raises(errors.NoDataFound):
        sql(c, 'select public.remover_participante(%s, %s)', (c.obra_a, c.sem_obra), usuario=c.gestor_a)
    # com dois gestores, um pode sair (inclusive o próprio)
    sql(c, "select public.definir_papel(%s, %s, 'gestor')", (c.obra_a, c.equipe_a), usuario=c.gestor_a)
    sql(c, 'select public.remover_participante(%s, %s)', (c.obra_a, c.gestor_a), usuario=c.gestor_a)
    assert papel_em(c, c.gestor_a, c.obra_a) is None


# --- listar_publicacoes_problema ---------------------------------------------------------------

def test_listar_problemas_filtros_e_ordem(cenario):
    c = cenario
    p_inc, r_inc = nova_publicacao(c, 'incerto', atualizado_em="now() - interval '3 hours'")
    p_fal, r_fal = nova_publicacao(c, 'falhou', tentativas='5', erro="'boom'", atualizado_em="now() - interval '1 hour'")
    p_pen3, _ = nova_publicacao(c, 'pendente', tentativas='3')
    nova_publicacao(c, 'pendente', tentativas='2')
    nova_publicacao(c, 'pendente')
    nova_publicacao(c, 'enviando', tentativas='9')
    nova_publicacao(c, 'publicado', tentativas='9')
    nova_publicacao(c, 'falhou', obra=c.obra_b)
    with sessao(c.dsn, papel=None) as cur:
        cur.execute("update public.publicacao_telegram set atualizado_em = now() where id = %s", (p_pen3,))
    r = problemas(c, c.gestor_a)
    assert [x[0] for x in r] == [p_pen3, p_fal, p_inc]  # mais recentes primeiro
    fal = r[1]
    assert fal == (p_fal, 'falhou', 'boom', 5, r_fal, None, 'servico', 'Reboco', 'Ambiente 0')
    assert r[2][4] == r_inc
    assert [x[0] for x in problemas(c, c.gestor_b, c.obra_b)] != []


def test_listar_problemas_encerramento(cenario):
    c = cenario
    p1, rid1, eid1 = nova_pub_encerramento(c, 'Tudo certo')
    p2, rid2, eid2 = nova_pub_encerramento(c, None, estado='incerto')
    p3, rid3, eid3 = nova_pub_encerramento(c, '   ', estado='incerto')
    r = {x[0]: x for x in problemas(c, c.gestor_a)}
    assert r[p1][4:] == (rid1, eid1, 'encerramento', 'Tudo certo', 'Ambiente 0')
    assert r[p2][7] == 'Pendência resolvida' and r[p2][4] == rid2 and r[p2][5] == eid2
    assert r[p3][7] == 'Pendência resolvida'


# --- republicar / marcar_publicada --------------------------------------------------------------

@pytest.mark.parametrize('estado', ['incerto', 'falhou'])
def test_republicar_volta_para_pendente(cenario, estado):
    c = cenario
    pid, _ = nova_publicacao(c, estado, tentativas='4', erro="'x'",
                             proxima_tentativa_em="now() + interval '1 day'", atualizado_em="now() - interval '1 day'")
    sql(c, 'select public.republicar(%s)', (pid,), usuario=c.gestor_a)
    assert pub(c, pid) == ('pendente', 0, None, True)
    assert sql(c, 'select atualizado_em > now() - interval \'1 minute\' from public.publicacao_telegram '
                  'where id = %s', (pid,), papel=None) == [(True,)]


@pytest.mark.parametrize('estado', ['pendente', 'enviando', 'publicado'])
def test_republicar_e_marcar_so_de_incerto_ou_falhou(cenario, estado):
    c = cenario
    pid, _ = nova_publicacao(c, estado)
    with pytest.raises(errors.InvalidParameterValue):
        sql(c, 'select public.republicar(%s)', (pid,), usuario=c.gestor_a)
    with pytest.raises(errors.InvalidParameterValue):
        sql(c, 'select public.marcar_publicada(%s)', (pid,), usuario=c.gestor_a)
    assert pub(c, pid)[0] == estado


def test_publicacao_inexistente(cenario):
    c = cenario
    for fn in ('republicar', 'marcar_publicada'):
        with pytest.raises(errors.NoDataFound):
            sql(c, f'select public.{fn}(-1)', usuario=c.gestor_a)


def test_marcar_publicada(cenario):
    c = cenario
    pid, _ = nova_publicacao(c, 'incerto')
    sql(c, 'select public.marcar_publicada(%s)', (pid,), usuario=c.gestor_a)
    estado, _, erro, _ = pub(c, pid)
    assert (estado, erro) == ('publicado', 'Marcada como publicada pelo gestor.')
    assert problemas(c, c.gestor_a) == []


def test_republicar_enfileira_http_post_com_segredos(cenario):
    c = cenario
    pid, _ = nova_publicacao(c, 'falhou')
    sql(c, 'select public.republicar(%s)', (pid,), usuario=c.gestor_a)
    assert sql(c, 'select count(*) from net.pedido_stub', papel=None) == [(0,)]  # sem segredos: nada, sem erro
    pid2, _ = nova_publicacao(c, 'incerto')
    with sessao(c.dsn, papel=None) as cur:
        cur.execute('delete from net.pedido_stub')
    segredos(c)
    sql(c, 'select public.republicar(%s)', (pid2,), usuario=c.gestor_a)
    (url, headers), = sql(c, 'select url, headers from net.pedido_stub', papel=None)
    assert url == 'https://exemplo.supabase.co/functions/v1/publish-outbox'
    assert headers['x-segredo-interno'] == 's'
    # marcar_publicada não dispara nada
    pid3, _ = nova_publicacao(c, 'falhou')
    with sessao(c.dsn, papel=None) as cur:
        cur.execute('delete from net.pedido_stub')
    sql(c, 'select public.marcar_publicada(%s)', (pid3,), usuario=c.gestor_a)
    assert sql(c, 'select count(*) from net.pedido_stub', papel=None) == [(0,)]
