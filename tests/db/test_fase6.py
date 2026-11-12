"""Testes da migration da fase 6 (acesso por grupo e publicação). Contrato: docs/contrato-fase6.md, seção A."""
import json
import uuid

import pytest

psycopg = pytest.importorskip('psycopg', reason='psycopg não instalado')
from psycopg import errors  # noqa: E402

from conftest import sessao  # noqa: E402


@pytest.fixture(autouse=True)
def fila_limpa(dsn):
    """O banco é compartilhado na sessão: esvazia a fila para reivindicar_publicacoes ver só as do teste."""
    with sessao(dsn, papel=None) as cur:
        cur.execute('delete from public.publicacao_telegram')


def membro(c, usuario, obra, dias_atras=0):
    with sessao(c.dsn, papel=None) as cur:
        cur.execute(
            "insert into privado.membro_grupo (obra_id, usuario_id, conferido_em) "
            "values (%s, %s, now() - make_interval(days => %s)) "
            "on conflict (obra_id, usuario_id) do update set conferido_em = excluded.conferido_em",
            (obra, usuario, dias_atras))


def sql(c, comando, params=(), papel=None, usuario=None):
    with sessao(c.dsn, usuario, papel=papel) as cur:
        cur.execute(comando, params)
        return cur.fetchall() if cur.description else None


def solicitar(c, usuario, obra):
    with sessao(c.dsn, usuario) as cur:
        cur.execute('select * from public.solicitar_acesso(%s)', (obra,))
        return cur.fetchone()


def disponiveis(c, usuario):
    return sql(c, 'select slug, solicitacao from public.obras_disponiveis()', usuario=usuario, papel='authenticated')


def papel_em(c, usuario, obra):
    r = sql(c, 'select papel from public.participacao where obra_id = %s and usuario_id = %s', (obra, usuario))
    return r[0][0] if r else None


def nova_publicacao(c, estado='pendente', obra=None, **colunas):
    """Insere registro + publicação (superusuário) e devolve o id da publicação."""
    obra = obra or c.obra_a
    amb = c.amb_a if obra == c.obra_a else c.amb_b
    rid = uuid.uuid4()
    with sessao(c.dsn, papel=None) as cur:
        cur.execute(
            "insert into public.registro (id, obra_id, ambiente_id, tipo, legenda, autor_id, capturado_em) "
            "values (%s, %s, %s, 'servico', 'x', %s, now())", (rid, obra, amb, c.gestor_a))
        cur.execute("insert into public.publicacao_telegram (obra_id, registro_id, estado) values (%s, %s, %s) "
                    "returning id", (obra, rid, estado))
        pid = cur.fetchone()[0]
        for k, v in colunas.items():
            cur.execute(f'update public.publicacao_telegram set {k} = {v} where id = %s', (pid,))
    return pid


def pub(c, pid):
    return sql(c, 'select estado, tentativas, erro, message_ids, proxima_tentativa_em <= now() '
                  'from public.publicacao_telegram where id = %s', (pid,))[0]


# --- obras_disponiveis / solicitar_acesso -----------------------------------------------------

def test_obras_disponiveis_exige_membro_recente_e_sem_participacao(cenario):
    c = cenario
    assert disponiveis(c, c.sem_obra) == []
    membro(c, c.sem_obra, c.obra_a, dias_atras=8)
    assert disponiveis(c, c.sem_obra) == []  # conferência velha
    membro(c, c.sem_obra, c.obra_a, dias_atras=2)
    membro(c, c.sem_obra, c.obra_b)
    r = disponiveis(c, c.sem_obra)
    assert len(r) == 2 and all(x[1] is None for x in r)
    membro(c, c.equipe_a, c.obra_a)
    assert disponiveis(c, c.equipe_a) == []  # já participa


def test_obras_disponiveis_mostra_estado_do_pedido_mais_recente(cenario):
    c = cenario
    membro(c, c.sem_obra, c.obra_a)
    solicitar(c, c.sem_obra, c.obra_a)
    assert [x[1] for x in disponiveis(c, c.sem_obra)] == ['pendente']
    with sessao(c.dsn, papel=None) as cur:
        cur.execute("update public.solicitacao_acesso set estado = 'recusada', decidido_em = now() "
                    "where obra_id = %s and usuario_id = %s", (c.obra_a, c.sem_obra))
    assert [x[1] for x in disponiveis(c, c.sem_obra)] == ['recusada']


def test_obras_disponiveis_sem_usuario_falha(cenario):
    with pytest.raises(errors.InvalidAuthorizationSpecification) as e:
        sql(cenario, 'select * from public.obras_disponiveis()', papel='authenticated')
    assert e.value.sqlstate == '28000'


def test_solicitar_acesso_sem_membro_recente(cenario):
    c = cenario
    with pytest.raises(errors.InsufficientPrivilege, match='Entre no grupo da obra'):
        solicitar(c, c.sem_obra, c.obra_a)
    membro(c, c.sem_obra, c.obra_a, dias_atras=8)
    with pytest.raises(errors.InsufficientPrivilege):
        solicitar(c, c.sem_obra, c.obra_a)


def test_solicitar_acesso_ja_participa(cenario):
    c = cenario
    membro(c, c.equipe_a, c.obra_a)
    with pytest.raises(errors.UniqueViolation, match='Você já tem acesso a esta obra.'):
        solicitar(c, c.equipe_a, c.obra_a)


def test_solicitar_acesso_pendente_e_idempotente(cenario):
    c = cenario
    membro(c, c.sem_obra, c.obra_a)
    a = solicitar(c, c.sem_obra, c.obra_a)
    b = solicitar(c, c.sem_obra, c.obra_a)
    assert a == b
    assert sql(c, 'select estado, notificada_em from public.solicitacao_acesso where id = %s', (a[0],)) \
        == [('pendente', None)]
    assert sql(c, 'select count(*) from public.solicitacao_acesso where usuario_id = %s', (c.sem_obra,)) == [(1,)]


def test_solicitar_acesso_recusado_recentemente(cenario):
    c = cenario
    membro(c, c.sem_obra, c.obra_a)
    sol = solicitar(c, c.sem_obra, c.obra_a)
    with sessao(c.dsn, papel=None) as cur:
        cur.execute("update public.solicitacao_acesso set estado = 'recusada', decidido_em = now() - interval '2 hours' "
                    "where id = %s", (sol[0],))
    with pytest.raises(errors.InvalidParameterValue, match='Pedido recusado recentemente'):
        solicitar(c, c.sem_obra, c.obra_a)
    # após 24 h, um novo pedido é aceito
    with sessao(c.dsn, papel=None) as cur:
        cur.execute("update public.solicitacao_acesso set decidido_em = now() - interval '25 hours' where id = %s",
                    (sol[0],))
    nova = solicitar(c, c.sem_obra, c.obra_a)
    assert nova[0] != sol[0]


def test_insert_direto_em_solicitacao_acesso_negado(cenario):
    c = cenario
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, 'insert into public.solicitacao_acesso (obra_id, usuario_id) values (%s, %s)',
            (c.obra_a, c.sem_obra), papel='authenticated', usuario=c.sem_obra)


# --- listar_solicitacoes / decidir_solicitacao ------------------------------------------------

def test_listar_solicitacoes_so_gestor_e_ordenado(cenario):
    c = cenario
    membro(c, c.sem_obra, c.obra_a)
    membro(c, c.gestor_b, c.obra_a)
    s1 = solicitar(c, c.sem_obra, c.obra_a)
    s2 = solicitar(c, c.gestor_b, c.obra_a)
    with sessao(c.dsn, papel=None) as cur:
        cur.execute("update public.solicitacao_acesso set criado_em = now() - interval '1 day' where id = %s", (s2[0],))
    r = sql(c, 'select id, usuario_id, nome from public.listar_solicitacoes(%s)', (c.obra_a,),
            papel='authenticated', usuario=c.gestor_a)
    assert [x[0] for x in r] == [s2[0], s1[0]]
    for quem in (c.equipe_a, c.gestor_b):
        with pytest.raises(errors.InsufficientPrivilege):
            sql(c, 'select * from public.listar_solicitacoes(%s)', (c.obra_a,), papel='authenticated', usuario=quem)


def decidir(c, usuario, sid, aprovar):
    return sql(c, 'select * from public.decidir_solicitacao(%s, %s)', (sid, aprovar),
               papel='authenticated', usuario=usuario)[0]


def test_decidir_nao_gestor_e_inexistente(cenario):
    c = cenario
    membro(c, c.sem_obra, c.obra_a)
    sol = solicitar(c, c.sem_obra, c.obra_a)
    for quem in (c.equipe_a, c.gestor_b, c.sem_obra):
        with pytest.raises(errors.InsufficientPrivilege):
            decidir(c, quem, sol[0], True)
    with pytest.raises(errors.NoDataFound) as e:
        decidir(c, c.gestor_a, uuid.uuid4(), True)
    assert e.value.sqlstate == 'P0002'
    assert papel_em(c, c.sem_obra, c.obra_a) is None


def test_decidir_aprova_cria_equipe_e_e_idempotente(cenario):
    c = cenario
    membro(c, c.sem_obra, c.obra_a)
    sol = solicitar(c, c.sem_obra, c.obra_a)
    r = decidir(c, c.gestor_a, sol[0], True)
    assert r[3] == 'aprovada'
    assert str(r[5]) == str(c.gestor_a) and r[6] is not None
    assert papel_em(c, c.sem_obra, c.obra_a) == 'equipe'
    assert decidir(c, c.gestor_a, sol[0], True) == r  # mesmo resultado: devolve
    with pytest.raises(errors.UniqueViolation, match='Pedido já decidido.'):
        decidir(c, c.gestor_a, sol[0], False)  # resultado diferente
    assert disponiveis(c, c.sem_obra) == []


def test_decidir_recusa_nao_cria_participacao(cenario):
    c = cenario
    membro(c, c.sem_obra, c.obra_a)
    sol = solicitar(c, c.sem_obra, c.obra_a)
    assert decidir(c, c.gestor_a, sol[0], False)[3] == 'recusada'
    assert papel_em(c, c.sem_obra, c.obra_a) is None
    assert decidir(c, c.gestor_a, sol[0], False)[3] == 'recusada'
    with pytest.raises(errors.UniqueViolation):
        decidir(c, c.gestor_a, sol[0], True)


# --- sincronizar_acesso -----------------------------------------------------------------------

def sincronizar(c, usuario, itens):
    sql(c, 'select public.sincronizar_acesso(%s, %s::jsonb)', (usuario, json.dumps(itens)), papel='service_role')


def test_sincronizar_admin_cria_e_promove(cenario):
    c = cenario
    sincronizar(c, c.sem_obra, [{'obra_id': str(c.obra_a), 'situacao': 'admin'}])
    assert papel_em(c, c.sem_obra, c.obra_a) == 'gestor'
    assert sql(c, 'select count(*) from privado.membro_grupo where usuario_id = %s', (c.sem_obra,)) == [(1,)]
    sincronizar(c, c.equipe_a, [{'obra_id': str(c.obra_a), 'situacao': 'admin'}])  # equipe vira gestor
    assert papel_em(c, c.equipe_a, c.obra_a) == 'gestor'


def test_sincronizar_membro_nao_cria_nem_rebaixa(cenario):
    c = cenario
    sincronizar(c, c.sem_obra, [{'obra_id': str(c.obra_a), 'situacao': 'membro'}])
    assert papel_em(c, c.sem_obra, c.obra_a) is None
    assert [x[0] for x in disponiveis(c, c.sem_obra)] == [sql(c, 'select slug from public.obra where id = %s',
                                                               (c.obra_a,))[0][0]]
    sincronizar(c, c.gestor_a, [{'obra_id': str(c.obra_a), 'situacao': 'membro'}])
    assert papel_em(c, c.gestor_a, c.obra_a) == 'gestor'


def test_sincronizar_fora_remove_acesso_e_recusa_pendentes(cenario):
    c = cenario
    membro(c, c.equipe_a, c.obra_a)
    with sessao(c.dsn, papel=None) as cur:
        cur.execute("insert into public.solicitacao_acesso (obra_id, usuario_id) values (%s, %s)",
                    (c.obra_a, c.equipe_a))
    sincronizar(c, c.equipe_a, [{'obra_id': str(c.obra_a), 'situacao': 'fora'}])
    assert papel_em(c, c.equipe_a, c.obra_a) is None
    assert sql(c, 'select count(*) from privado.membro_grupo where usuario_id = %s', (c.equipe_a,)) == [(0,)]
    assert sql(c, 'select estado, decidido_por from public.solicitacao_acesso where usuario_id = %s',
               (c.equipe_a,)) == [('recusada', None)]


def test_sincronizar_valida_entrada(cenario):
    c = cenario
    for itens in ({'a': 1}, [{'obra_id': str(c.obra_a), 'situacao': 'dono'}], [{'obra_id': 'x', 'situacao': 'fora'}]):
        with pytest.raises(errors.InvalidParameterValue):
            sincronizar(c, c.sem_obra, itens)
    sincronizar(c, c.sem_obra, [{'obra_id': str(uuid.uuid4()), 'situacao': 'admin'}])  # obra inexistente: ignora


# --- vincular_obra ----------------------------------------------------------------------------

def test_vincular_obra_atualiza_e_reagenda(cenario):
    c = cenario
    pid = nova_publicacao(c, proxima_tentativa_em="now() + interval '1 hour'")
    outra = nova_publicacao(c, estado='publicado')
    slug = sql(c, 'select slug from public.obra where id = %s', (c.obra_a,))[0][0]
    sql(c, 'update public.etapa set telegram_chat_id = -100123 where id = %s', (c.etapa,))  # grupo da etapa
    r = sql(c, 'select id, telegram_chat_id, telegram_thread_id from public.vincular_obra(%s, %s, %s)',
            (slug, -100123, 7), papel='service_role')[0]
    assert r == (c.obra_a, -100123, 7)
    assert pub(c, pid)[4] is True
    assert pub(c, outra)[0] == 'publicado'
    assert sql(c, 'select id from public.vincular_obra(%s, 1, 2)', ('nao-existe',), papel='service_role') == [(None,)]


# --- reivindicar_publicacoes / finalizar_publicacao -------------------------------------------

def test_reivindicar_marca_enviando_respeita_limite_e_horario(cenario):
    c = cenario
    ids = [nova_publicacao(c) for _ in range(3)]
    futura = nova_publicacao(c, proxima_tentativa_em="now() + interval '1 hour'")
    ja_publicada = nova_publicacao(c, estado='publicado')
    r = sql(c, 'select id, estado, tentativas from public.reivindicar_publicacoes(2)', papel='service_role')
    assert sorted(x[0] for x in r) == ids[:2]
    assert all(x[1] == 'enviando' and x[2] == 1 for x in r)
    r = sql(c, 'select id from public.reivindicar_publicacoes()', papel='service_role')
    assert ids[2] in [x[0] for x in r]
    assert futura not in [x[0] for x in r] and ja_publicada not in [x[0] for x in r]
    assert pub(c, futura)[0] == 'pendente'


def test_reivindicar_enviando_antigo_vira_incerto(cenario):
    c = cenario
    velho = nova_publicacao(c, estado='enviando', atualizado_em="now() - interval '11 minutes'")
    recente = nova_publicacao(c, estado='enviando', atualizado_em="now() - interval '2 minutes'")
    sql(c, 'select * from public.reivindicar_publicacoes(10)', papel='service_role')
    assert pub(c, velho)[0] == 'incerto'
    assert pub(c, velho)[2] == 'Envio interrompido; conferir no tópico.'
    assert pub(c, recente)[0] == 'enviando'


def test_reivindicar_skip_locked_em_concorrencia(cenario):
    c = cenario
    ids = [nova_publicacao(c) for _ in range(2)]
    with psycopg.connect(c.dsn) as c1, psycopg.connect(c.dsn) as c2:
        for conn in (c1, c2):
            conn.execute('set local role service_role')
        # c1 reivindica e mantém a transação aberta (linhas travadas)
        r1 = c1.execute('select id from public.reivindicar_publicacoes(1)').fetchall()
        # c2 não espera e não pega a mesma linha
        r2 = c2.execute('select id from public.reivindicar_publicacoes(1)').fetchall()
        assert len(r1) == 1 and len(r2) == 1 and r1 != r2
        assert {r1[0][0], r2[0][0]} == set(ids)


def test_finalizar_publicacao(cenario):
    c = cenario
    pid = nova_publicacao(c)
    sql(c, 'select * from public.reivindicar_publicacoes(1)', papel='service_role')
    sql(c, 'select public.finalizar_publicacao(%s, %s, %s, %s, %s)',
        (pid, 'publicado', [11, 12], 'x' * 600, None), papel='service_role')
    estado, _, erro, ids, pronta = pub(c, pid)
    assert estado == 'publicado' and ids == [11, 12] and len(erro) == 500 and pronta
    # fora de "enviando": ignorada
    sql(c, 'select public.finalizar_publicacao(%s, %s, %s, %s, %s)', (pid, 'falhou', None, 'boom', None),
        papel='service_role')
    assert pub(c, pid)[0] == 'publicado'
    with pytest.raises(errors.InvalidParameterValue):
        sql(c, 'select public.finalizar_publicacao(%s, %s, %s, %s, %s)', (pid, 'enviando', None, None, None),
            papel='service_role')


def test_finalizar_publicacao_reagenda_com_proxima(cenario):
    c = cenario
    pid = nova_publicacao(c)
    sql(c, 'select * from public.reivindicar_publicacoes(1)', papel='service_role')
    sql(c, "select public.finalizar_publicacao(%s, 'pendente', null, 'tente depois', now() + interval '5 minutes')",
        (pid,), papel='service_role')
    estado, tentativas, _, _, pronta = pub(c, pid)
    assert (estado, tentativas, pronta) == ('pendente', 1, False)


# --- permissões -------------------------------------------------------------------------------

CHAMADAS_SERVICE_ROLE = [
    ('select public.segredo_interno()', ()),
    ('select public.sincronizar_acesso(%s, %s::jsonb)', (uuid.uuid4(), '[]')),
    ("select public.vincular_obra('x', 1, 2)", ()),
    ('select * from public.reivindicar_publicacoes(1)', ()),
    ("select public.finalizar_publicacao(1, 'publicado', null, null, null)", ()),
]


@pytest.mark.parametrize('papel', ['authenticated', 'anon'])
@pytest.mark.parametrize('comando,params', CHAMADAS_SERVICE_ROLE)
def test_funcoes_de_service_role_negadas(cenario, papel, comando, params):
    with pytest.raises(errors.InsufficientPrivilege):
        sql(cenario, comando, params, papel=papel, usuario=cenario.gestor_a if papel == 'authenticated' else None)


def test_service_role_executa_e_privado_fechado(cenario):
    c = cenario
    sql(c, 'select public.segredo_interno()', papel='service_role')
    for tabela in ('privado.membro_grupo',):
        with pytest.raises(errors.InsufficientPrivilege):
            sql(c, f'select * from {tabela}', papel='authenticated', usuario=c.gestor_a)
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, 'select privado.disparar_publicacao()', papel='authenticated', usuario=c.gestor_a)


# --- segredo, gatilho e cron ------------------------------------------------------------------

@pytest.fixture
def vault_limpo(dsn):
    def limpar():
        with sessao(dsn, papel=None) as cur:
            cur.execute('delete from vault.decrypted_secrets')
            cur.execute('delete from net.pedido_stub')
    limpar()
    yield
    limpar()


def segredos(c, **valores):
    with sessao(c.dsn, papel=None) as cur:
        for nome, v in valores.items():
            cur.execute('insert into vault.decrypted_secrets (name, decrypted_secret) values (%s, %s)', (nome, v))


def pedidos(c):
    return sql(c, 'select url, body, headers, timeout_milliseconds from net.pedido_stub order by id')


def test_segredo_interno(cenario, vault_limpo):
    c = cenario
    assert sql(c, 'select public.segredo_interno()', papel='service_role') == [(None,)]
    segredos(c, segredo_interno='abc')
    assert sql(c, 'select public.segredo_interno()', papel='service_role') == [('abc',)]


def test_gatilho_so_dispara_com_segredos(cenario, vault_limpo):
    c = cenario
    nova_publicacao(c)
    assert pedidos(c) == []  # sem segredos: nada, e o insert deu certo
    segredos(c, url_projeto='https://exemplo.supabase.co')
    nova_publicacao(c)
    assert pedidos(c) == []  # falta o segredo interno
    segredos(c, segredo_interno='s3gr3d0')
    nova_publicacao(c)
    (url, body, headers, timeout), = pedidos(c)
    assert url == 'https://exemplo.supabase.co/functions/v1/publish-outbox'
    assert body == {}
    assert headers == {'Content-Type': 'application/json', 'x-segredo-interno': 's3gr3d0'}
    assert timeout == 55000


def test_gatilho_em_solicitacao_acesso_e_um_pedido_por_comando(cenario, vault_limpo):
    c = cenario
    segredos(c, url_projeto='https://exemplo.supabase.co', segredo_interno='s')
    membro(c, c.sem_obra, c.obra_a)
    solicitar(c, c.sem_obra, c.obra_a)
    assert len(pedidos(c)) == 1
    # concluir_registro (security definer, chamado por usuário) também aciona, sem acesso ao Vault
    with sessao(c.dsn, papel=None) as cur:
        cur.execute('delete from net.pedido_stub')
    nova_publicacao(c)
    assert len(pedidos(c)) == 1


def test_erro_no_envio_vira_aviso_e_nao_derruba_a_gravacao(cenario, vault_limpo):
    c = cenario
    segredos(c, url_projeto='https://exemplo.supabase.co', segredo_interno='s')
    with psycopg.connect(c.dsn) as conn:
        conn.execute("create or replace function net.http_post(url text, body jsonb default null, "
                     "params jsonb default null, headers jsonb default null, timeout_milliseconds int default 1) "
                     "returns bigint language plpgsql as $$ begin raise exception 'rede fora'; end $$")
        avisos = []
        conn.add_notice_handler(lambda d: avisos.append(d.message_primary))
        conn.execute('select privado.disparar_publicacao()')  # não levanta
        assert any('rede fora' in a for a in avisos)
        conn.rollback()  # desfaz a troca do stub


def test_cron_agendado_uma_vez(cenario, dsn):
    c = cenario
    jobs = sql(c, "select schedule, command from cron.job where jobname = 'publicar-telegram'")
    assert jobs == [('* * * * *', 'select privado.disparar_publicacao()')]
