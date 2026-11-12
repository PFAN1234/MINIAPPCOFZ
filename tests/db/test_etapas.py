"""Testes da migration de etapas e organização (20261112180000_etapas.sql).

Contrato: docs/contrato-etapas.md; documentação: docs/admin.md ("Etapas e organização").
Obra "ativa" = obra não arquivada e etapa não arquivada. Cada cenário tem uma etapa própria
(`c.etapa`, sem grupo do Telegram) com as obras A e B.
"""
import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest

psycopg = pytest.importorskip('psycopg', reason='psycopg não instalado')
from psycopg import errors, sql as psql  # noqa: E402
from psycopg.conninfo import conninfo_to_dict, make_conninfo  # noqa: E402

from conftest import MIGRATIONS, STUB, sessao  # noqa: E402

CONCLUIR = 'select * from public.concluir_registro(%s, %s, %s, %s, %s, %s::jsonb)'
MIGRATION = '20261112180000_etapas.sql'


@pytest.fixture(autouse=True)
def admins_limpos(dsn):
    """O banco é compartilhado na sessão: cada teste começa sem admins."""
    with sessao(dsn, papel=None) as cur:
        cur.execute('delete from public.admin_app')


def sql(c, comando, params=(), papel='authenticated', usuario=None):
    with sessao(c.dsn, usuario, papel=papel) as cur:
        cur.execute(comando, params)
        return cur.fetchall() if cur.description else None


def su(c, comando, params=()):
    return sql(c, comando, params, papel=None)


def servico(c, comando, params=()):
    return sql(c, comando, params, papel='service_role')


def rpc(c, usuario, comando, params=()):
    return sql(c, comando, params, usuario=usuario)[0][0]


def tornar_admin(c, *usuarios):
    for u in usuarios:
        su(c, 'insert into public.admin_app (usuario_id) values (%s) on conflict do nothing', (u,))


def chat_novo():
    """Id de grupo único (telegram_chat_id é único entre as etapas)."""
    return -(10**12 + uuid.uuid4().int % 10**11)


def slug_etapa(c, etapa=None):
    return su(c, 'select slug from public.etapa where id = %s', (etapa or c.etapa,))[0][0]


def nome_etapa(c, etapa=None):
    return su(c, 'select nome from public.etapa where id = %s', (etapa or c.etapa,))[0][0]


def slug(c, obra):
    return su(c, 'select slug from public.obra where id = %s', (obra,))[0][0]


def nova_etapa(c, nome='Outra etapa', chat=None):
    eid = uuid.uuid4()
    su(c, 'insert into public.etapa (id, slug, nome, telegram_chat_id) values (%s, %s, %s, %s)',
       (eid, f'et-{uuid.uuid4().hex[:8]}', nome, chat))
    return eid


def arquivar_etapa(c, usuario, arquivada=True, etapa=None):
    return rpc(c, usuario, 'select public.admin_arquivar_etapa(%s, %s)', (slug_etapa(c, etapa), arquivada))


def concluir(c, usuario, obra, amb):
    rid = uuid.uuid4()
    with sessao(c.dsn, usuario) as cur:
        cur.execute(CONCLUIR, (rid, amb, 'servico', 'Teste', datetime.now(timezone.utc) - timedelta(minutes=1),
                               json.dumps([c.foto(obra, rid)])))
    return rid


def membro(c, usuario, obra):
    su(c, 'insert into privado.membro_grupo (obra_id, usuario_id) values (%s, %s) '
          'on conflict (obra_id, usuario_id) do update set conferido_em = now()', (obra, usuario))


def salvar_obra(c, usuario, dados):
    return rpc(c, usuario, 'select public.admin_salvar_obra(%s::jsonb)', (json.dumps(dados),))


def salvar_etapa(c, usuario, dados):
    return rpc(c, usuario, 'select public.admin_salvar_etapa(%s::jsonb)', (json.dumps(dados),))


# --- Migração dos dados ------------------------------------------------------------------------

def _banco_antes_das_etapas(servidor_dsn):
    """Banco novo com o stub e as migrations anteriores à das etapas."""
    nome = 'teste_mig_' + uuid.uuid4().hex[:10]
    with psycopg.connect(servidor_dsn, autocommit=True) as conn:
        conn.execute(psql.SQL('create database {}').format(psql.Identifier(nome)))
    base = conninfo_to_dict(servidor_dsn)
    base['dbname'] = nome
    dsn = make_conninfo(**base)
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute(STUB.read_text())
        for m in MIGRATIONS:
            if m.name >= MIGRATION:
                break
            conn.execute(m.read_text())
    return nome, dsn


def _aplicar_etapas(dsn):
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute(next(m for m in MIGRATIONS if m.name == MIGRATION).read_text())


def _apagar(servidor_dsn, nome):
    with psycopg.connect(servidor_dsn, autocommit=True) as conn:
        conn.execute(psql.SQL('drop database if exists {} with (force)').format(psql.Identifier(nome)))


@pytest.mark.parametrize('chats,herdado', [
    ((-100, -100, None), -100),   # todas as vinculadas no mesmo grupo: a etapa herda
    ((-100, -200, None), None),   # grupos diferentes: etapa sem grupo
    ((None, None), None),         # nenhuma vinculada
])
def test_migracao_poe_as_obras_na_2a_etapa(servidor_dsn, chats, herdado):
    nome, dsn = _banco_antes_das_etapas(servidor_dsn)
    try:
        with psycopg.connect(dsn, autocommit=True) as conn:
            for i, chat in enumerate(chats):
                conn.execute('insert into public.obra (slug, nome, telegram_chat_id, telegram_thread_id) '
                             'values (%s, %s, %s, %s)', (f'o{i}', f'Obra {i}', chat, i if chat else None))
        _aplicar_etapas(dsn)
        with psycopg.connect(dsn) as conn:
            etapas = conn.execute('select slug, nome, telegram_chat_id, telegram_chat_titulo, arquivada_em '
                                  'from public.etapa').fetchall()
            assert etapas == [('2a-etapa', '2ª ETAPA', herdado, None, None)]
            linhas = conn.execute('select o.slug, e.slug, o.telegram_chat_id from public.obra o '
                                  'join public.etapa e on e.id = o.etapa_id order by o.slug').fetchall()
            assert linhas == [(f'o{i}', '2a-etapa', chat) for i, chat in enumerate(chats)]  # vínculos ficam
            assert conn.execute('select nome, logo_path from public.organizacao').fetchall() == [('CO-FZ', None)]
            assert conn.execute("select public, file_size_limit, allowed_mime_types from storage.buckets "
                                "where id = 'organizacao'").fetchall() == [
                (True, 1048576, ['image/png', 'image/jpeg', 'image/webp'])]
    finally:
        _apagar(servidor_dsn, nome)


def test_etapa_id_obrigatorio_e_restrict(cenario):
    c = cenario
    with pytest.raises(errors.NotNullViolation):
        su(c, "insert into public.obra (slug, nome) values (%s, 'X')", (f'x-{uuid.uuid4().hex[:8]}',))
    with pytest.raises(errors.ForeignKeyViolation):
        su(c, 'delete from public.etapa where id = %s', (c.etapa,))


# --- RLS da etapa --------------------------------------------------------------------------------

def etapas_visiveis(c, usuario):
    return {r[0] for r in sql(c, 'select id from public.etapa', usuario=usuario)}


def test_rls_da_etapa(cenario):
    c = cenario
    outra = nova_etapa(c)
    assert etapas_visiveis(c, c.equipe_a) & {c.etapa, outra} == {c.etapa}
    assert etapas_visiveis(c, c.sem_obra) & {c.etapa, outra} == set()
    # o app embute a etapa na lista de obras
    linhas = sql(c, 'select o.id, e.slug from public.obra o join public.etapa e on e.id = o.etapa_id',
                 usuario=c.equipe_a)
    assert linhas == [(c.obra_a, slug_etapa(c))]

    tornar_admin(c, c.sem_obra)
    assert {c.etapa, outra} <= etapas_visiveis(c, c.sem_obra)

    # obra arquivada: quem só participa dela deixa de ver a etapa
    su(c, 'update public.obra set arquivada_em = now() where id = %s', (c.obra_a,))
    assert c.etapa not in etapas_visiveis(c, c.equipe_a)
    assert c.etapa in etapas_visiveis(c, c.gestor_b)
    su(c, 'update public.obra set arquivada_em = null where id = %s', (c.obra_a,))
    arquivar_etapa(c, c.sem_obra)
    assert c.etapa not in etapas_visiveis(c, c.gestor_b) | etapas_visiveis(c, c.equipe_a)
    assert c.etapa in etapas_visiveis(c, c.sem_obra)  # admin vê a arquivada

    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, 'select * from public.etapa', papel='anon')
    for comando in ("update public.etapa set nome = 'x'", 'delete from public.etapa',
                    "insert into public.etapa (slug, nome) values ('z', 'z')"):
        with pytest.raises(errors.InsufficientPrivilege):
            sql(c, comando, usuario=c.sem_obra)


# --- Arquivar etapa ----------------------------------------------------------------------------

def test_arquivar_etapa_bloqueia_tudo_e_desarquivar_devolve(cenario):
    c = cenario
    tornar_admin(c, c.sem_obra)
    concluir(c, c.equipe_a, c.obra_a, c.amb_a)
    # obra B arquivada por conta própria antes: continua arquivada depois de desarquivar a etapa
    rpc(c, c.sem_obra, 'select public.admin_arquivar_obra(%s, true)', (slug(c, c.obra_b),))

    r = arquivar_etapa(c, c.sem_obra)
    assert r['slug'] == slug_etapa(c) and r['arquivada_em'] is not None
    assert arquivar_etapa(c, c.sem_obra) == r  # idempotente
    assert su(c, 'select arquivada_por from public.etapa where id = %s', (c.etapa,)) == [(c.sem_obra,)]
    assert su(c, 'select arquivada_em from public.obra where id = %s', (c.obra_a,)) == [(None,)]  # não mexe

    for tabela, coluna in (('obra', 'id'), ('registro', 'obra_id'), ('ambiente', 'obra_id'), ('foto', 'obra_id')):
        assert sql(c, f'select count(*) from public.{tabela} where {coluna} = %s', (c.obra_a,),
                   usuario=c.equipe_a) == [(0,)]
    assert sql(c, 'select count(*) from public.usuario where id = %s', (c.gestor_a,), usuario=c.equipe_a) == [(0,)]
    with pytest.raises(errors.InsufficientPrivilege):
        concluir(c, c.equipe_a, c.obra_a, c.amb_a)
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, 'select * from public.listar_participantes(%s)', (c.obra_a,), usuario=c.gestor_a)

    # pedidos de acesso e sincronização
    membro(c, c.sem_obra, c.obra_a)
    assert sql(c, 'select slug from public.obras_disponiveis()', usuario=c.sem_obra) == []
    with pytest.raises(errors.InvalidParameterValue, match='arquivada'):
        sql(c, 'select * from public.solicitar_acesso(%s)', (c.obra_a,), usuario=c.sem_obra)
    servico(c, 'select public.sincronizar_acesso(%s, %s::jsonb)',
            (c.gestor_b, json.dumps([{'obra_id': str(c.obra_a), 'situacao': 'admin'}])))
    assert su(c, 'select count(*) from public.participacao where obra_id = %s and usuario_id = %s',
              (c.obra_a, c.gestor_b)) == [(0,)]

    # publicação parada
    rid = su(c, 'select id from public.registro where obra_id = %s', (c.obra_a,))[0][0]
    su(c, 'delete from public.publicacao_telegram where obra_id = %s', (c.obra_a,))
    pid = su(c, "insert into public.publicacao_telegram (obra_id, registro_id, proxima_tentativa_em) "
                "values (%s, %s, now() - interval '1 minute') returning id", (c.obra_a, rid))[0][0]
    assert pid not in {x[0] for x in servico(c, 'select id from public.reivindicar_publicacoes(1000)')}
    su(c, "update public.publicacao_telegram set proxima_tentativa_em = now() + interval '1 hour' where id = %s",
       (pid,))

    # vínculo do tópico
    su(c, 'update public.etapa set telegram_chat_id = %s where id = %s', (chat_novo(), c.etapa))
    chat = su(c, 'select telegram_chat_id from public.etapa where id = %s', (c.etapa,))[0][0]
    with pytest.raises(errors.InvalidParameterValue, match='arquivada'):
        servico(c, 'select id from public.vincular_obra(%s, %s, 7)', (slug(c, c.obra_a), chat))

    # desarquivar devolve; a publicação volta à fila já
    assert arquivar_etapa(c, c.sem_obra, False) == {'slug': slug_etapa(c), 'arquivada_em': None}
    assert arquivar_etapa(c, c.sem_obra, False)['arquivada_em'] is None
    assert pid in {x[0] for x in servico(c, 'select id from public.reivindicar_publicacoes(1000)')}
    assert sql(c, 'select count(*) from public.obra where id = %s', (c.obra_a,), usuario=c.equipe_a) == [(1,)]
    concluir(c, c.equipe_a, c.obra_a, c.amb_a)
    assert [x[0] for x in sql(c, 'select slug from public.obras_disponiveis()', usuario=c.sem_obra)] == [
        slug(c, c.obra_a)]
    sql(c, 'select * from public.solicitar_acesso(%s)', (c.obra_a,), usuario=c.sem_obra)
    assert servico(c, 'select id from public.vincular_obra(%s, %s, 7)', (slug(c, c.obra_a), chat)) == [(c.obra_a,)]
    # a obra B segue arquivada
    assert su(c, 'select arquivada_em is not null from public.obra where id = %s', (c.obra_b,)) == [(True,)]
    assert sql(c, 'select count(*) from public.obra where id = %s', (c.obra_b,), usuario=c.gestor_b) == [(0,)]


def test_arquivar_etapa_validacoes(cenario):
    c = cenario
    tornar_admin(c, c.gestor_b)
    with pytest.raises(errors.InsufficientPrivilege):
        arquivar_etapa(c, c.gestor_a)
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, "select public.admin_arquivar_etapa('x', true)", papel='anon')
    with pytest.raises(errors.InvalidParameterValue):
        sql(c, 'select public.admin_arquivar_etapa(%s, null)', (slug_etapa(c),), usuario=c.gestor_b)
    with pytest.raises(errors.NoDataFound):
        sql(c, "select public.admin_arquivar_etapa('nao-existe', true)", usuario=c.gestor_b)


def test_obras_disponiveis_traz_a_etapa(cenario):
    c = cenario
    membro(c, c.sem_obra, c.obra_a)
    su(c, 'update public.etapa set ordem = 7 where id = %s', (c.etapa,))
    r = sql(c, 'select slug, solicitacao, etapa_id, etapa_nome, etapa_ordem from public.obras_disponiveis()',
            usuario=c.sem_obra)
    assert r == [(slug(c, c.obra_a), None, c.etapa, nome_etapa(c), 7)]


# --- Bot: vincular_etapa / vincular_obra ---------------------------------------------------------

def vincular_etapa(c, slug_, chat, titulo='Grupo'):
    r = servico(c, 'select id, telegram_chat_id, telegram_chat_titulo from public.vincular_etapa(%s, %s, %s)',
                (slug_, chat, titulo))
    return r[0]


def test_vincular_etapa(cenario):
    c = cenario
    tornar_admin(c, c.sem_obra)
    chat = chat_novo()
    assert vincular_etapa(c, 'nao-existe', chat) == (None, None, None)
    assert vincular_etapa(c, slug_etapa(c), chat, 'Grupo da etapa') == (c.etapa, chat, 'Grupo da etapa')
    assert vincular_etapa(c, slug_etapa(c), chat, 'Novo título') == (c.etapa, chat, 'Novo título')  # mesmo grupo

    # o grupo já é de outra etapa
    outra = nova_etapa(c, 'Etapa B')
    with pytest.raises(errors.InvalidParameterValue, match='já é da etapa') as e:
        vincular_etapa(c, slug_etapa(c, outra), chat)
    assert nome_etapa(c) in str(e.value)
    # a etapa já tem outro grupo
    with pytest.raises(errors.InvalidParameterValue, match='Desvincule'):
        vincular_etapa(c, slug_etapa(c), chat_novo())
    # etapa arquivada
    arquivar_etapa(c, c.sem_obra, etapa=outra)
    with pytest.raises(errors.InvalidParameterValue, match='está arquivada'):
        vincular_etapa(c, slug_etapa(c, outra), chat_novo())
    assert su(c, 'select telegram_chat_id from public.etapa where id = %s', (outra,)) == [(None,)]

    for papel, usuario in (('authenticated', c.sem_obra), ('anon', None)):
        with pytest.raises(errors.InsufficientPrivilege):
            sql(c, "select public.vincular_etapa('x', 1, 'x')", papel=papel, usuario=usuario)


def test_vincular_obra_exige_o_grupo_da_etapa(cenario):
    c = cenario
    with pytest.raises(errors.InvalidParameterValue) as e:
        servico(c, 'select id from public.vincular_obra(%s, %s, 7)', (slug(c, c.obra_a), chat_novo()))
    assert str(e.value).startswith(f'Vincule antes a etapa: /vincular_etapa {slug_etapa(c)}')

    chat = chat_novo()
    vincular_etapa(c, slug_etapa(c), chat)
    with pytest.raises(errors.InvalidParameterValue, match='que usa outro grupo') as e:
        servico(c, 'select id from public.vincular_obra(%s, %s, 7)', (slug(c, c.obra_a), chat_novo()))
    assert 'Obra a' in str(e.value) and nome_etapa(c) in str(e.value)
    assert su(c, 'select telegram_chat_id from public.obra where id = %s', (c.obra_a,)) == [(None,)]

    r = servico(c, 'select id, telegram_chat_id, telegram_thread_id from public.vincular_obra(%s, %s, 7)',
                (slug(c, c.obra_a), chat))
    assert r == [(c.obra_a, chat, 7)]


def test_desvincular_etapa(cenario):
    c = cenario
    tornar_admin(c, c.sem_obra)
    chat = chat_novo()
    vincular_etapa(c, slug_etapa(c), chat)
    for obra, topico in ((c.obra_a, 7), (c.obra_b, 8)):
        servico(c, 'select id from public.vincular_obra(%s, %s, %s)', (slug(c, obra), chat, topico))
    outra = nova_etapa(c, chat=chat_novo())

    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, 'select public.admin_desvincular_etapa(%s)', (slug_etapa(c),), usuario=c.gestor_a)
    with pytest.raises(errors.NoDataFound):
        sql(c, "select public.admin_desvincular_etapa('nao-existe')", usuario=c.sem_obra)
    sql(c, 'select public.admin_desvincular_etapa(%s)', (slug_etapa(c),), usuario=c.sem_obra)
    assert su(c, 'select telegram_chat_id, telegram_chat_titulo from public.etapa where id = %s',
              (c.etapa,)) == [(None, None)]
    assert su(c, 'select count(*) from public.obra where etapa_id = %s and '
                 '(telegram_chat_id is not null or telegram_thread_id is not null)', (c.etapa,)) == [(0,)]
    assert su(c, 'select telegram_chat_id is not null from public.etapa where id = %s', (outra,)) == [(True,)]
    # o grupo fica livre para outra vinculação
    assert vincular_etapa(c, slug_etapa(c), chat)[1] == chat


# --- Site: etapas ---------------------------------------------------------------------------------

def test_admin_salvar_etapa(cenario):
    c = cenario
    tornar_admin(c, c.sem_obra)
    s = f'etapa-{uuid.uuid4().hex[:8]}'
    criada = salvar_etapa(c, c.sem_obra, {'slug': s, 'nome': '  3ª ETAPA ', 'ordem': 3})
    assert set(criada) == {'id', 'slug', 'nome', 'ordem'}
    assert (criada['slug'], criada['nome'], criada['ordem']) == (s, '3ª ETAPA', 3)
    editada = salvar_etapa(c, c.sem_obra, {'id': criada['id'], 'nome': 'Terceira', 'ordem': 1})
    assert editada == {'id': criada['id'], 'slug': s, 'nome': 'Terceira', 'ordem': 1}
    assert salvar_etapa(c, c.sem_obra, {'id': criada['id'], 'slug': s, 'nome': 'X'})['nome'] == 'X'
    with pytest.raises(errors.UniqueViolation):
        salvar_etapa(c, c.sem_obra, {'slug': s, 'nome': 'Outra'})
    with pytest.raises(errors.InsufficientPrivilege):
        salvar_etapa(c, c.gestor_a, {'slug': 'x', 'nome': 'X'})


@pytest.mark.parametrize('dados,estado', [
    ({'slug': 'Maiuscula', 'nome': 'X'}, '22023'),
    ({'slug': 'x' * 41, 'nome': 'X'}, '22023'),
    ({'slug': 'sem-nome'}, '22023'),
    ({'slug': 'nome-vazio', 'nome': '  '}, '22023'),
    ({'slug': 'nome-longo', 'nome': 'x' * 121}, '22023'),
    ({'slug': 'ordem-texto', 'nome': 'X', 'ordem': 'a'}, '22023'),
    ({'nome': 'Sem slug'}, '22023'),
    ({'id': str(uuid.uuid4()), 'nome': 'X'}, 'P0002'),
    ({'id': 'nao-uuid', 'nome': 'X'}, '22023'),
])
def test_admin_salvar_etapa_valida(cenario, dados, estado):
    c = cenario
    tornar_admin(c, c.sem_obra)
    with pytest.raises(errors.Error) as e:
        salvar_etapa(c, c.sem_obra, dados)
    assert e.value.sqlstate == estado


def test_admin_salvar_etapa_nao_muda_slug(cenario):
    c = cenario
    tornar_admin(c, c.sem_obra)
    with pytest.raises(errors.InvalidParameterValue):
        salvar_etapa(c, c.sem_obra, {'id': str(c.etapa), 'slug': 'outro', 'nome': 'X'})


def test_admin_listar_etapas(cenario):
    c = cenario
    tornar_admin(c, c.sem_obra)
    chat = chat_novo()
    vincular_etapa(c, slug_etapa(c), chat, 'Grupo X')
    rpc(c, c.sem_obra, 'select public.admin_arquivar_obra(%s, true)', (slug(c, c.obra_b),))
    vazia = nova_etapa(c, 'Vazia')
    su(c, 'update public.etapa set ordem = -1000 where id = %s', (vazia,))
    lista = rpc(c, c.sem_obra, 'select public.admin_listar_etapas()')
    por_id = {x['id']: x for x in lista}
    item = por_id[str(c.etapa)]
    assert item == {'id': str(c.etapa), 'slug': slug_etapa(c), 'nome': nome_etapa(c), 'ordem': 0,
                    'arquivada_em': None, 'telegram_vinculado': True, 'telegram_chat_titulo': 'Grupo X',
                    'obras': 2, 'obras_arquivadas': 1}
    assert por_id[str(vazia)]['obras'] == 0 and por_id[str(vazia)]['telegram_vinculado'] is False
    # Por ordem (o desempate pelo nome segue a collation do servidor, que muda entre ambientes).
    ordens = [x['ordem'] for x in lista]
    assert ordens == sorted(ordens)
    assert lista[0]['id'] == str(vazia)
    assert '2a-etapa' in {x['slug'] for x in lista}
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, 'select public.admin_listar_etapas()', usuario=c.gestor_a)


def test_admin_listar_e_obter_obra_trazem_a_etapa(cenario):
    c = cenario
    tornar_admin(c, c.sem_obra)
    r = sql(c, 'select slug, etapa_id, etapa_slug, etapa_nome, etapa_arquivada_em from public.admin_listar_obras()',
            usuario=c.sem_obra)
    assert (slug(c, c.obra_a), c.etapa, slug_etapa(c), nome_etapa(c), None) in r
    o = rpc(c, c.sem_obra, 'select public.admin_obter_obra(%s)', (slug(c, c.obra_a),))
    assert o['obra']['etapa'] == {'id': str(c.etapa), 'slug': slug_etapa(c), 'nome': nome_etapa(c),
                                  'arquivada_em': None, 'telegram_vinculado': False}
    arquivar_etapa(c, c.sem_obra)
    o = rpc(c, c.sem_obra, 'select public.admin_obter_obra(%s)', (slug(c, c.obra_a),))
    assert o['obra']['etapa']['arquivada_em'] is not None


# --- Site: salvar e mover obra ------------------------------------------------------------------

@pytest.mark.parametrize('etapa,estado', [
    (None, '22023'),         # ausente ao criar
    ('nao-uuid', '22023'),
    (1, '22023'),
    ('novo', 'P0002'),       # uuid que não existe
])
def test_criar_obra_exige_etapa(cenario, etapa, estado):
    c = cenario
    tornar_admin(c, c.sem_obra)
    dados = {'slug': f'ob-{uuid.uuid4().hex[:8]}', 'nome': 'Nova'}
    if etapa is not None:
        dados['etapa_id'] = str(uuid.uuid4()) if etapa == 'novo' else etapa
    with pytest.raises(errors.Error) as e:
        salvar_obra(c, c.sem_obra, dados)
    assert e.value.sqlstate == estado


def test_criar_e_mover_obra(cenario):
    c = cenario
    tornar_admin(c, c.sem_obra)
    nova = salvar_obra(c, c.sem_obra, {'slug': f'ob-{uuid.uuid4().hex[:8]}', 'nome': 'Nova',
                                       'etapa_id': str(c.etapa)})
    assert nova['etapa_id'] == str(c.etapa)

    # obra A vinculada ao tópico do grupo da etapa
    chat = chat_novo()
    vincular_etapa(c, slug_etapa(c), chat)
    servico(c, 'select id from public.vincular_obra(%s, %s, 7)', (slug(c, c.obra_a), chat))

    # editar sem etapa_id não mexe na etapa nem no vínculo
    salvar_obra(c, c.sem_obra, {'id': str(c.obra_a), 'nome': 'Obra a'})
    assert su(c, 'select etapa_id, telegram_chat_id, telegram_thread_id from public.obra where id = %s',
              (c.obra_a,)) == [(c.etapa, chat, 7)]
    # "mover" para a mesma etapa também não
    salvar_obra(c, c.sem_obra, {'id': str(c.obra_a), 'etapa_id': str(c.etapa)})
    assert su(c, 'select telegram_chat_id from public.obra where id = %s', (c.obra_a,)) == [(chat,)]

    # mover para etapa com outro grupo (ou sem grupo) apaga o vínculo do tópico
    destino = nova_etapa(c, chat=chat_novo())
    r = salvar_obra(c, c.sem_obra, {'id': str(c.obra_a), 'etapa_id': str(destino)})
    assert r['etapa_id'] == str(destino)
    assert su(c, 'select etapa_id, telegram_chat_id, telegram_thread_id from public.obra where id = %s',
              (c.obra_a,)) == [(destino, None, None)]
    # a equipe continua vendo a obra (agora na outra etapa) e a etapa nova
    assert sql(c, 'select e.id from public.obra o join public.etapa e on e.id = o.etapa_id',
               usuario=c.equipe_a) == [(destino,)]

    with pytest.raises(errors.NoDataFound):
        salvar_obra(c, c.sem_obra, {'id': str(c.obra_a), 'etapa_id': str(uuid.uuid4())})
    with pytest.raises(errors.InvalidParameterValue):
        salvar_obra(c, c.sem_obra, {'id': str(c.obra_a), 'etapa_id': 'x'})


# --- Site: resumo e exclusão da etapa ----------------------------------------------------------

def objeto(c, bucket, nome_objeto):
    su(c, 'insert into storage.objects (bucket_id, name) values (%s, %s) on conflict do nothing',
       (bucket, nome_objeto))


def test_admin_resumo_etapa(cenario):
    c = cenario
    tornar_admin(c, c.sem_obra)
    concluir(c, c.equipe_a, c.obra_a, c.amb_a)
    concluir(c, c.gestor_b, c.obra_b, c.amb_b)
    objeto(c, 'plantas', f'{c.obra_b}/R01/terreo/planta.webp')
    r = rpc(c, c.sem_obra, 'select public.admin_resumo_etapa(%s)', (slug_etapa(c),))
    assert r['obras'] == [{'slug': slug(c, c.obra_a), 'nome': 'Obra a'}, {'slug': slug(c, c.obra_b), 'nome': 'Obra b'}]
    soma = {}
    for obra in (c.obra_a, c.obra_b):
        parcial = rpc(c, c.sem_obra, 'select public.admin_resumo_obra(%s)', (slug(c, obra),))
        for k, v in parcial.items():
            if k == 'arquivos':
                soma.setdefault(k, {})
                for b, n in v.items():
                    soma[k][b] = soma[k].get(b, 0) + n
            else:
                soma[k] = soma.get(k, 0) + v
    assert r['total'] == soma
    assert r['total']['registros'] == 2 and r['total']['arquivos']['plantas'] == 1

    vazia = nova_etapa(c)
    assert rpc(c, c.sem_obra, 'select public.admin_resumo_etapa(%s)', (slug_etapa(c, vazia),)) == {
        'obras': [], 'total': {'registros': 0, 'fotos': 0, 'ambientes': 0, 'pavimentos': 0, 'plantas': 0,
                               'modelos': 0, 'participantes': 0, 'publicacoes_telegram': 0,
                               'arquivos': {'fotos': 0, 'plantas': 0, 'originais': 0, 'modelos': 0}}}
    with pytest.raises(errors.NoDataFound):
        sql(c, "select public.admin_resumo_etapa('nao-existe')", usuario=c.sem_obra)
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, 'select public.admin_resumo_etapa(%s)', (slug_etapa(c),), usuario=c.gestor_a)


@pytest.mark.parametrize('confirmacao', [None, '', 'x', 'Etapa', 'etapa'])
def test_excluir_etapa_confirmacao_errada(cenario, confirmacao):
    c = cenario
    tornar_admin(c, c.sem_obra)
    with pytest.raises(errors.InvalidParameterValue, match='digite exatamente o nome da etapa'):
        sql(c, 'select public.admin_excluir_etapa(%s, %s)', (slug_etapa(c), confirmacao), usuario=c.sem_obra)
    assert su(c, 'select count(*) from public.obra where etapa_id = %s', (c.etapa,)) == [(2,)]
    assert su(c, 'select count(*) from public.obra_excluida where obra_id in (%s, %s)', (c.obra_a, c.obra_b)) == [(0,)]


def test_excluir_etapa_apaga_as_obras_e_grava_auditoria(cenario):
    c = cenario
    tornar_admin(c, c.sem_obra)
    rid = concluir(c, c.equipe_a, c.obra_a, c.amb_a)
    objeto(c, 'modelos', f'{c.obra_b}/ARQ/{"b" * 16}.frag')
    rpc(c, c.sem_obra, 'select public.admin_arquivar_obra(%s, true)', (slug(c, c.obra_b),))  # arquivada também sai
    outra = nova_etapa(c)
    resumo = rpc(c, c.sem_obra, 'select public.admin_resumo_etapa(%s)', (slug_etapa(c),))
    resumos = {o: rpc(c, c.sem_obra, 'select public.admin_resumo_obra(%s)', (slug(c, o),)) for o in (c.obra_a, c.obra_b)}
    n = nome_etapa(c)
    s = slug_etapa(c)

    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, 'select public.admin_excluir_etapa(%s, %s)', (s, n), usuario=c.gestor_a)
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, "select public.admin_excluir_etapa('x', 'x')", papel='anon')

    r = rpc(c, c.sem_obra, 'select public.admin_excluir_etapa(%s, %s)', (s, f'  {n} '))
    assert set(r) == {'etapa_id', 'exclusoes', 'resumo'}
    assert r['etapa_id'] == str(c.etapa) and r['resumo'] == resumo and len(r['exclusoes']) == 2

    aud = su(c, 'select id, obra_id, nome, etapa_nome, excluida_por, resumo from public.obra_excluida '
                'where id = any(%s::uuid[]) order by nome', (r['exclusoes'],))
    assert [(a[1], a[2], a[3], a[4], a[5]) for a in aud] == [
        (c.obra_a, 'Obra a', n, c.sem_obra, resumos[c.obra_a]), (c.obra_b, 'Obra b', n, c.sem_obra, resumos[c.obra_b])]
    assert su(c, 'select count(*) from public.etapa where id = %s', (c.etapa,)) == [(0,)]
    assert su(c, 'select count(*) from public.obra where id in (%s, %s)', (c.obra_a, c.obra_b)) == [(0,)]
    assert su(c, 'select count(*) from public.registro where id = %s', (rid,)) == [(0,)]
    assert su(c, 'select count(*) from public.etapa where id = %s', (outra,)) == [(1,)]  # outra etapa fica
    # a limpeza do Storage é a mesma da exclusão de obra
    for e in r['exclusoes']:
        assert servico(c, 'select public.admin_exclusao_para_limpar(%s)', (e,))[0][0] in (c.obra_a, c.obra_b)
    lista = rpc(c, c.sem_obra, 'select public.admin_listar_exclusoes()')
    assert {x['etapa_nome'] for x in lista if x['id'] in r['exclusoes']} == {n}

    with pytest.raises(errors.NoDataFound):
        sql(c, 'select public.admin_excluir_etapa(%s, %s)', (s, n), usuario=c.sem_obra)


def test_excluir_etapa_vazia(cenario):
    c = cenario
    tornar_admin(c, c.sem_obra)
    vazia = nova_etapa(c, 'Etapa vazia')
    r = rpc(c, c.sem_obra, 'select public.admin_excluir_etapa(%s, %s)', (slug_etapa(c, vazia), 'Etapa vazia'))
    assert r['etapa_id'] == str(vazia) and r['exclusoes'] == [] and r['resumo']['obras'] == []
    assert su(c, 'select count(*) from public.etapa where id = %s', (vazia,)) == [(0,)]


# --- Organização ---------------------------------------------------------------------------------

LOGO = 'logo-0123456789abcdef.png'


@pytest.fixture
def org(cenario):
    su(cenario, "update public.organizacao set nome = 'CO-FZ', logo_path = null, atualizado_em = null, "
                'atualizado_por = null')
    yield cenario
    su(cenario, "update public.organizacao set nome = 'CO-FZ', logo_path = null")


def test_organizacao_leitura(org):
    c = org
    padrao = {'nome': 'CO-FZ', 'logo_path': None}
    assert sql(c, 'select public.organizacao()', papel='anon') == [(padrao,)]
    assert rpc(c, c.equipe_a, 'select public.organizacao()') == padrao
    for papel, usuario in (('anon', None), ('authenticated', c.equipe_a)):
        with pytest.raises(errors.InsufficientPrivilege):
            sql(c, 'select * from public.organizacao', papel=papel, usuario=usuario)
        with pytest.raises(errors.InsufficientPrivilege):
            sql(c, "update public.organizacao set nome = 'x'", papel=papel, usuario=usuario)


def test_admin_salvar_organizacao(org):
    c = org
    salvar = 'select public.admin_salvar_organizacao(%s::jsonb)'
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, salvar, (json.dumps({'nome': 'X'}),), usuario=c.gestor_a)
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, salvar, (json.dumps({'nome': 'X'}),), papel='anon')
    tornar_admin(c, c.sem_obra)

    assert rpc(c, c.sem_obra, salvar, (json.dumps({'nome': '  1º BEC  ', 'logo_path': None}),)) == {
        'nome': '1º BEC', 'logo_path': None}
    assert su(c, 'select atualizado_por, atualizado_em is not null from public.organizacao') == [(c.sem_obra, True)]

    # logo: formato e existência no bucket
    for invalido in ('logo.png', 'logo-0123456789ABCDEF.png', 'logo-0123456789abcdef.gif', '../logo-0123456789abcdef.png',
                     f'pasta/{LOGO}', 'logo-0123456789abcde.png'):
        with pytest.raises(errors.InvalidParameterValue, match='Caminho do logo'):
            rpc(c, c.sem_obra, salvar, (json.dumps({'nome': 'X', 'logo_path': invalido}),))
    with pytest.raises(errors.InvalidParameterValue, match='não foi enviado'):
        rpc(c, c.sem_obra, salvar, (json.dumps({'nome': 'X', 'logo_path': LOGO}),))
    objeto(c, 'organizacao', LOGO)
    assert rpc(c, c.sem_obra, salvar, (json.dumps({'nome': '1º BEC', 'logo_path': LOGO}),)) == {
        'nome': '1º BEC', 'logo_path': LOGO}
    assert sql(c, 'select public.organizacao()', papel='anon') == [({'nome': '1º BEC', 'logo_path': LOGO},)]
    # campo ausente mantém; null tira o logo
    assert rpc(c, c.sem_obra, salvar, (json.dumps({'nome': 'Outro'}),))['logo_path'] == LOGO
    assert rpc(c, c.sem_obra, salvar, (json.dumps({'logo_path': None}),)) == {'nome': 'Outro', 'logo_path': None}

    for dados in ({'nome': ''}, {'nome': 'x' * 81}, {'nome': 1}, {'logo_path': 1}, []):
        with pytest.raises(errors.InvalidParameterValue):
            rpc(c, c.sem_obra, salvar, (json.dumps(dados),))
    su(c, "delete from storage.objects where bucket_id = 'organizacao'")


def test_bucket_organizacao_so_admin_grava(org):
    c = org
    inserir = "insert into storage.objects (bucket_id, name, owner_id) values ('organizacao', %s, 'x')"
    nome_ok = f'logo-{uuid.uuid4().hex[:16]}.webp'
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, inserir, (nome_ok,), usuario=c.gestor_a)
    tornar_admin(c, c.sem_obra)
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, inserir, ('outro-nome.webp',), usuario=c.sem_obra)
    sql(c, inserir, (nome_ok,), usuario=c.sem_obra)
    assert sql(c, "select name from storage.objects where bucket_id = 'organizacao' and name = %s", (nome_ok,),
               usuario=c.sem_obra) == [(nome_ok,)]
    sql(c, "delete from storage.objects where bucket_id = 'organizacao' and name = %s", (nome_ok,),
        usuario=c.gestor_a)  # não admin: a RLS não deixa apagar
    assert su(c, "select count(*) from storage.objects where name = %s", (nome_ok,)) == [(1,)]
    sql(c, "delete from storage.objects where bucket_id = 'organizacao' and name = %s", (nome_ok,),
        usuario=c.sem_obra)
    assert su(c, "select count(*) from storage.objects where name = %s", (nome_ok,)) == [(0,)]
