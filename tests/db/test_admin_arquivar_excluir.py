"""Testes da migration de arquivar e excluir obra pelo site de administração.

Arquivar: a obra some do Mini App (RLS via privado.eh_participante/eh_gestor), não aceita
registros, fotos nem pedidos de acesso, e as publicações pendentes param. Excluir: apaga a
obra e todas as linhas dela e grava `obra_excluida`; os arquivos do Storage saem depois, pela
Edge Function admin-excluir-obra. Documentação: docs/admin.md ("Arquivar e excluir obra").
"""
import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest

psycopg = pytest.importorskip('psycopg', reason='psycopg não instalado')
from psycopg import errors  # noqa: E402

from conftest import sessao  # noqa: E402

CONCLUIR = 'select * from public.concluir_registro(%s, %s, %s, %s, %s, %s::jsonb)'
ENCERRAR = 'select * from public.encerrar_pendencia(%s, %s, %s, %s::jsonb)'
BUCKETS = ('fotos', 'plantas', 'originais', 'modelos')


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
    """Como superusuário (preparação e conferência)."""
    return sql(c, comando, params, papel=None)


def rpc(c, usuario, comando, params=()):
    return sql(c, comando, params, usuario=usuario)[0][0]


def tornar_admin(c, *usuarios):
    for u in usuarios:
        su(c, 'insert into public.admin_app (usuario_id) values (%s) on conflict do nothing', (u,))


def slug(c, obra):
    return su(c, 'select slug from public.obra where id = %s', (obra,))[0][0]


def nome(c, obra):
    return su(c, 'select nome from public.obra where id = %s', (obra,))[0][0]


def arquivar(c, usuario, obra, arquivada=True):
    return rpc(c, usuario, 'select public.admin_arquivar_obra(%s, %s)', (slug(c, obra), arquivada))


def concluir(c, usuario, obra, amb, tipo='servico'):
    rid = uuid.uuid4()
    fotos = [c.foto(obra, rid)]
    with sessao(c.dsn, usuario) as cur:
        cur.execute(CONCLUIR, (rid, amb, tipo, 'Teste', datetime.now(timezone.utc) - timedelta(minutes=1),
                               json.dumps(fotos)))
    return rid


def encerrar(c, usuario, obra, rid):
    eid = uuid.uuid4()
    fotos = [c.foto(obra, rid)]
    with sessao(c.dsn, usuario) as cur:
        cur.execute(ENCERRAR, (eid, rid, 'Corrigido', json.dumps(fotos)))
    return eid


def membro(c, usuario, obra):
    su(c, 'insert into privado.membro_grupo (obra_id, usuario_id) values (%s, %s) '
          'on conflict (obra_id, usuario_id) do update set conferido_em = now()', (obra, usuario))


def objeto(c, bucket, nome_objeto):
    su(c, 'insert into storage.objects (bucket_id, name) values (%s, %s) on conflict do nothing',
       (bucket, nome_objeto))


def visiveis(c, usuario, obra):
    """Quantas linhas da obra o usuário enxerga em cada tabela (pela RLS)."""
    r = {}
    for tabela in ('obra', 'pavimento', 'ambiente', 'registro', 'encerramento', 'foto', 'publicacao_telegram',
                   'planta', 'planta_detalhe', 'modelo'):
        coluna = 'id' if tabela == 'obra' else 'obra_id'
        r[tabela] = sql(c, f'select count(*) from public.{tabela} where {coluna} = %s', (obra,), usuario=usuario)[0][0]
    r['storage'] = sql(c, "select count(*) from storage.objects where name like %s", (f'{obra}/%',),
                       usuario=usuario)[0][0]
    return r


def popular(c, obra, amb, gestor, equipe):
    """Obra com registro, pendência encerrada, planta, modelo, publicações e arquivos."""
    rid = concluir(c, equipe, obra, amb)
    pend = concluir(c, equipe, obra, amb, tipo='pendencia')
    encerrar(c, gestor, obra, pend)
    pav = su(c, 'select id from public.pavimento where obra_id = %s', (obra,))[0][0]
    pid = uuid.uuid4()
    su(c, 'insert into public.planta (id, obra_id, pavimento_id, revisao, pagina_largura_pt, pagina_altura_pt, '
          "recorte_pt, imagem_path, imagem_largura, imagem_altura) values (%s, %s, %s, 'R01', 100, 80, "
          "'{0,0,100,80}', %s, 200, 160)", (pid, obra, pav, f'{obra}/R01/terreo/planta.webp'))
    su(c, 'insert into public.planta_detalhe (planta_id, obra_id, ambiente_id, imagem_path, recorte_pt, largura, '
          "altura) values (%s, %s, %s, %s, '{0,0,10,10}', 20, 20)",
       (pid, obra, amb, f'{obra}/R01/terreo/ambientes/amb0.webp'))
    su(c, 'insert into public.publicacao_planta (obra_id, pavimento_id, revisao, pdf_path, pdf_sha256) '
          "values (%s, %s, 'R01', %s, %s)", (obra, pav, f'{obra}/R01/terreo/{"a" * 64}.pdf', 'a' * 64))
    su(c, "insert into public.modelo (obra_id, sigla, caminho, bytes, hash) values (%s, 'ARQ', %s, 10, 'h')",
       (obra, f'{obra}/ARQ/{"b" * 16}.frag'))
    su(c, "insert into public.publicacao_modelo (obra_id, acao, sigla) values (%s, 'publicado', 'ARQ')", (obra,))
    su(c, "insert into public.ra_referencial (obra_id, coordenadas) values (%s, '[0,0,0,0,0,0,0,0,0]')", (obra,))
    su(c, "insert into public.obra_config (obra_id, config) values (%s, '{\"status\": \"revisado\"}')", (obra,))
    for p in (f'{obra}/R01/terreo/planta.webp', f'{obra}/R01/terreo/planta-hd.webp',
              f'{obra}/R01/terreo/ambientes/amb0.webp'):
        objeto(c, 'plantas', p)
    objeto(c, 'originais', f'{obra}/R01/terreo/{"a" * 64}.pdf')
    objeto(c, 'modelos', f'{obra}/ARQ/{"b" * 16}.frag')
    return rid, pend


@pytest.fixture
def cheio(cenario):
    c = cenario
    c.rid_a, c.pend_a = popular(c, c.obra_a, c.amb_a, c.gestor_a, c.equipe_a)
    c.rid_b, _ = popular(c, c.obra_b, c.amb_b, c.gestor_b, c.gestor_b)
    tornar_admin(c, c.sem_obra)
    return c


# --- Arquivar: o que some e o que fica bloqueado ------------------------------------------------

def test_arquivar_esconde_a_obra_dos_participantes_e_desarquivar_devolve(cheio):
    c = cheio
    antes_equipe = visiveis(c, c.equipe_a, c.obra_a)
    antes_gestor_b = visiveis(c, c.gestor_b, c.obra_b)
    assert all(v > 0 for v in antes_equipe.values()), antes_equipe

    r = arquivar(c, c.sem_obra, c.obra_a)
    assert r['slug'] == slug(c, c.obra_a) and r['arquivada_em'] is not None
    assert su(c, 'select arquivada_por from public.obra where id = %s', (c.obra_a,)) == [(c.sem_obra,)]

    for u in (c.equipe_a, c.gestor_a):
        assert all(v == 0 for v in visiveis(c, u, c.obra_a).values())
        # quem só divide a obra arquivada deixa de ver o nome do outro
        outro = c.gestor_a if u == c.equipe_a else c.equipe_a
        assert sql(c, 'select count(*) from public.usuario where id = %s', (outro,), usuario=u) == [(0,)]
    assert visiveis(c, c.gestor_b, c.obra_b) == antes_gestor_b  # outra obra não muda

    r = arquivar(c, c.sem_obra, c.obra_a, False)
    assert r == {'slug': slug(c, c.obra_a), 'arquivada_em': None}
    assert su(c, 'select arquivada_em, arquivada_por from public.obra where id = %s', (c.obra_a,)) == [(None, None)]
    assert visiveis(c, c.equipe_a, c.obra_a) == antes_equipe


def test_obra_arquivada_nao_aceita_registro_foto_nem_acoes_de_gestor(cheio):
    c = cheio
    arquivar(c, c.sem_obra, c.obra_a)
    with pytest.raises(errors.InsufficientPrivilege):
        concluir(c, c.equipe_a, c.obra_a, c.amb_a)
    with pytest.raises(errors.InsufficientPrivilege):
        concluir(c, c.gestor_a, c.obra_a, c.amb_a, tipo='pendencia')
    with pytest.raises(errors.InsufficientPrivilege):  # upload de foto (política fotos_insert)
        sql(c, "insert into storage.objects (bucket_id, name, owner_id) values ('fotos', %s, %s)",
            (f'{c.obra_a}/{uuid.uuid4()}/{uuid.uuid4()}.jpg', str(c.equipe_a)), usuario=c.equipe_a)

    pend = su(c, "select id from public.registro where obra_id = %s and tipo = 'pendencia' and situacao = 'aberta'",
              (c.obra_a,))
    assert pend == []  # a do cenário já foi encerrada; cria outra aberta direto
    pid = uuid.uuid4()
    su(c, "insert into public.registro (id, obra_id, ambiente_id, tipo, legenda, autor_id, capturado_em, situacao) "
          "values (%s, %s, %s, 'pendencia', 'x', %s, now(), 'aberta')", (pid, c.obra_a, c.amb_a, c.equipe_a))
    with pytest.raises(errors.InsufficientPrivilege):
        encerrar(c, c.gestor_a, c.obra_a, pid)
    for comando in ('select * from public.listar_participantes(%s)', 'select * from public.listar_solicitacoes(%s)',
                    'select * from public.listar_publicacoes_problema(%s)'):
        with pytest.raises(errors.InsufficientPrivilege):
            sql(c, comando, (c.obra_a,), usuario=c.gestor_a)
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, "select public.definir_papel(%s, %s, 'gestor')", (c.obra_a, c.equipe_a), usuario=c.gestor_a)
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, 'select public.remover_participante(%s, %s)', (c.obra_a, c.equipe_a), usuario=c.gestor_a)

    # a outra obra segue normal
    concluir(c, c.gestor_b, c.obra_b, c.amb_b)
    assert sql(c, 'select count(*) from public.listar_participantes(%s)', (c.obra_b,), usuario=c.gestor_b) == [(1,)]

    # desarquivada, volta a aceitar
    arquivar(c, c.sem_obra, c.obra_a, False)
    concluir(c, c.equipe_a, c.obra_a, c.amb_a)
    encerrar(c, c.gestor_a, c.obra_a, pid)


def test_arquivada_some_de_obras_disponiveis_e_recusa_pedido(cenario):
    c = cenario
    tornar_admin(c, c.sem_obra)
    membro(c, c.equipe_a, c.obra_b)
    membro(c, c.equipe_a, c.obra_a)
    su(c, 'delete from public.participacao where usuario_id = %s', (c.equipe_a,))
    todas = {x[0] for x in sql(c, 'select slug from public.obras_disponiveis()', usuario=c.equipe_a)}
    assert todas == {slug(c, c.obra_a), slug(c, c.obra_b)}

    arquivar(c, c.sem_obra, c.obra_a)
    assert sql(c, 'select slug from public.obras_disponiveis()', usuario=c.equipe_a) == [(slug(c, c.obra_b),)]
    with pytest.raises(errors.InvalidParameterValue, match='arquivada'):
        sql(c, 'select * from public.solicitar_acesso(%s)', (c.obra_a,), usuario=c.equipe_a)
    sql(c, 'select * from public.solicitar_acesso(%s)', (c.obra_b,), usuario=c.equipe_a)  # a outra aceita

    arquivar(c, c.sem_obra, c.obra_a, False)
    sql(c, 'select * from public.solicitar_acesso(%s)', (c.obra_a,), usuario=c.equipe_a)


def test_sincronizar_acesso_ignora_obra_arquivada(cenario):
    c = cenario
    tornar_admin(c, c.gestor_b)
    arquivar(c, c.gestor_b, c.obra_a)
    itens = [{'obra_id': str(c.obra_a), 'situacao': 'admin'}, {'obra_id': str(c.obra_b), 'situacao': 'admin'}]
    sql(c, 'select public.sincronizar_acesso(%s, %s::jsonb)', (c.sem_obra, json.dumps(itens)), papel='service_role')
    assert su(c, 'select obra_id from public.participacao where usuario_id = %s', (c.sem_obra,)) == [(c.obra_b,)]
    assert su(c, 'select obra_id from privado.membro_grupo where usuario_id = %s', (c.sem_obra,)) == [(c.obra_b,)]
    # "fora" também não muda nada na arquivada
    sql(c, 'select public.sincronizar_acesso(%s, %s::jsonb)',
        (c.equipe_a, json.dumps([{'obra_id': str(c.obra_a), 'situacao': 'fora'}])), papel='service_role')
    assert su(c, 'select papel from public.participacao where obra_id = %s and usuario_id = %s',
              (c.obra_a, c.equipe_a)) == [('equipe',)]


def test_vincular_obra_recusa_arquivada(cenario):
    c = cenario
    tornar_admin(c, c.sem_obra)
    arquivar(c, c.sem_obra, c.obra_a)
    with pytest.raises(errors.InvalidParameterValue, match='está arquivada') as e:
        sql(c, 'select id from public.vincular_obra(%s, -100, 7)', (slug(c, c.obra_a),), papel='service_role')
    assert nome(c, c.obra_a) in str(e.value)
    assert su(c, 'select telegram_chat_id from public.obra where id = %s', (c.obra_a,)) == [(None,)]
    r = sql(c, 'select id from public.vincular_obra(%s, -100, 7)', (slug(c, c.obra_b),), papel='service_role')
    assert r == [(c.obra_b,)]


def test_reivindicar_nao_pega_obra_arquivada_e_volta_ao_desarquivar(cenario):
    c = cenario
    tornar_admin(c, c.sem_obra)
    ids = {}
    for obra, amb in ((c.obra_a, c.amb_a), (c.obra_b, c.amb_b)):
        rid = uuid.uuid4()
        su(c, "insert into public.registro (id, obra_id, ambiente_id, tipo, legenda, autor_id, capturado_em) "
              "values (%s, %s, %s, 'servico', 'x', %s, now())", (rid, obra, amb, c.gestor_a))
        ids[obra] = su(c, "insert into public.publicacao_telegram (obra_id, registro_id, proxima_tentativa_em) "
                          "values (%s, %s, now() + interval '1 hour') returning id", (obra, rid))[0][0]
    su(c, "update public.publicacao_telegram set proxima_tentativa_em = now() - interval '1 minute' "
          "where id = any(%s)", (list(ids.values()),))
    arquivar(c, c.sem_obra, c.obra_a)

    pegas = {x[0] for x in sql(c, 'select id from public.reivindicar_publicacoes(1000)', papel='service_role')}
    assert ids[c.obra_b] in pegas and ids[c.obra_a] not in pegas
    assert su(c, 'select estado from public.publicacao_telegram where id = %s', (ids[c.obra_a],)) == [('pendente',)]

    su(c, "update public.publicacao_telegram set proxima_tentativa_em = now() + interval '1 hour' where id = %s",
       (ids[c.obra_a],))
    arquivar(c, c.sem_obra, c.obra_a, False)  # reagenda para já
    pegas = {x[0] for x in sql(c, 'select id from public.reivindicar_publicacoes(1000)', papel='service_role')}
    assert ids[c.obra_a] in pegas


def test_arquivar_e_idempotente_e_aparece_nas_listagens(cenario):
    c = cenario
    tornar_admin(c, c.sem_obra, c.gestor_b)
    primeira = arquivar(c, c.sem_obra, c.obra_a)
    segunda = arquivar(c, c.gestor_b, c.obra_a)
    assert segunda == primeira
    assert su(c, 'select arquivada_por from public.obra where id = %s', (c.obra_a,)) == [(c.sem_obra,)]

    linhas = sql(c, 'select slug, arquivada_em from public.admin_listar_obras()', usuario=c.sem_obra)
    por_slug = dict(linhas)
    assert por_slug[slug(c, c.obra_a)] is not None and por_slug[slug(c, c.obra_b)] is None
    o = rpc(c, c.sem_obra, 'select public.admin_obter_obra(%s)', (slug(c, c.obra_a),))
    assert o['obra']['arquivada_em'] == primeira['arquivada_em']
    assert set(o['obra']) == {'id', 'slug', 'nome', 'ordem', 'telegram_vinculado', 'arquivada_em'}
    assert rpc(c, c.sem_obra, 'select public.admin_obter_obra(%s)', (slug(c, c.obra_b),))['obra']['arquivada_em'] is None

    assert arquivar(c, c.sem_obra, c.obra_a, False)['arquivada_em'] is None
    assert arquivar(c, c.sem_obra, c.obra_a, False)['arquivada_em'] is None


def test_arquivar_validacoes_e_permissoes(cenario):
    c = cenario
    tornar_admin(c, c.gestor_b)
    with pytest.raises(errors.InsufficientPrivilege):
        arquivar(c, c.gestor_a, c.obra_a)  # gestor da obra, mas não admin
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, "select public.admin_arquivar_obra('x', true)", papel='anon')
    with pytest.raises(errors.InvalidParameterValue):
        sql(c, 'select public.admin_arquivar_obra(%s, null)', (slug(c, c.obra_a),), usuario=c.gestor_b)
    with pytest.raises(errors.NoDataFound):
        sql(c, "select public.admin_arquivar_obra('nao-existe', true)", usuario=c.gestor_b)
    assert su(c, 'select arquivada_em from public.obra where id = %s', (c.obra_a,)) == [(None,)]


# --- Excluir ----------------------------------------------------------------------------------------

def tabelas_com_obra_id(c):
    """Todas as tabelas (public e privado) com coluna obra_id, exceto a auditoria."""
    return [f'{s}.{t}' for s, t in su(
        c, "select table_schema, table_name from information_schema.columns "
           "where column_name = 'obra_id' and table_schema in ('public', 'privado') "
           "and table_name <> 'obra_excluida' "
           "and table_name in (select table_name from information_schema.tables where table_type = 'BASE TABLE') "
           "order by 1, 2")]


def linhas_por_tabela(c, obra):
    r = {t: su(c, f'select count(*) from {t} where obra_id = %s', (obra,))[0][0] for t in tabelas_com_obra_id(c)}
    r['public.obra'] = su(c, 'select count(*) from public.obra where id = %s', (obra,))[0][0]
    return r


def excluir(c, usuario, obra, confirmacao):
    return rpc(c, usuario, 'select public.admin_excluir_obra(%s, %s)', (slug(c, obra), confirmacao))


def objetos_storage(c):
    return su(c, 'select bucket_id, name from storage.objects order by 1, 2')


def test_fks_dentro_da_obra_sem_cascata_sao_as_tratadas(dsn):
    """Guarda: uma FK nova sem cascata exige rever admin_excluir_obra."""
    with sessao(dsn, papel=None) as cur:
        cur.execute(
            "select c.conname from pg_constraint c "
            "where c.contype = 'f' and c.confdeltype <> 'c' "
            "and c.confrelid in (select format('%I.%I', k.table_schema, k.table_name)::regclass "
            "                      from information_schema.columns k "
            "                     where k.column_name = 'obra_id' and k.table_schema in ('public', 'privado')) "
            "order by 1")
        assert [r[0] for r in cur.fetchall()] == ['planta_detalhe_ambiente_fk', 'registro_ambiente_fk']
        # nada aponta para obra sem cascata
        cur.execute("select conname from pg_constraint where contype = 'f' and confrelid = 'public.obra'::regclass "
                    "and confdeltype <> 'c'")
        assert cur.fetchall() == []


def test_excluir_apaga_tudo_da_obra_e_grava_auditoria(cheio):
    c = cheio
    membro(c, c.sem_obra, c.obra_a)
    su(c, 'insert into public.solicitacao_acesso (obra_id, usuario_id) values (%s, %s)', (c.obra_a, c.sem_obra))
    antes = linhas_por_tabela(c, c.obra_a)
    vazias = sorted(t for t, n in antes.items() if n == 0)
    assert vazias == [], f'o cenário deveria ter linhas em todas as tabelas: {vazias}'
    antes_b = linhas_por_tabela(c, c.obra_b)
    storage_antes = objetos_storage(c)
    resumo_esperado = rpc(c, c.sem_obra, 'select public.admin_resumo_obra(%s)', (slug(c, c.obra_a),))
    s, n = slug(c, c.obra_a), nome(c, c.obra_a)

    r = excluir(c, c.sem_obra, c.obra_a, f'  {n} ')
    assert r['obra_id'] == str(c.obra_a) and r['resumo'] == resumo_esperado
    uuid.UUID(r['exclusao_id'])

    assert all(v == 0 for v in linhas_por_tabela(c, c.obra_a).values())
    assert linhas_por_tabela(c, c.obra_b) == antes_b
    assert objetos_storage(c) == storage_antes  # o Storage sai pela Edge Function

    aud = su(c, 'select obra_id, slug, nome, excluida_por, resumo, arquivos_removidos_em, arquivos_removidos, '
                'arquivos_erro from public.obra_excluida where id = %s', (r['exclusao_id'],))
    assert aud == [(c.obra_a, s, n, c.sem_obra, resumo_esperado, None, None, None)]

    with pytest.raises(errors.NoDataFound):
        sql(c, 'select public.admin_excluir_obra(%s, %s)', (s, n), usuario=c.sem_obra)  # já não existe


def test_admin_resumo_obra_conta_linhas_e_arquivos(cheio):
    c = cheio
    objeto(c, 'fotos', f'{c.obra_a}/.emptyFolderPlaceholder')
    objeto(c, 'plantas', f'{c.obra_a}x/falso.webp')  # outro prefixo: não conta
    r = rpc(c, c.sem_obra, 'select public.admin_resumo_obra(%s)', (slug(c, c.obra_a),))
    assert r == {
        'registros': 2, 'fotos': 3, 'ambientes': 2, 'pavimentos': 1, 'plantas': 1, 'modelos': 1,
        'participantes': 2, 'publicacoes_telegram': 3,
        'arquivos': {'fotos': 4, 'plantas': 3, 'originais': 1, 'modelos': 1},
    }
    vazia = {'registros': 0, 'fotos': 0, 'ambientes': 0, 'pavimentos': 0, 'plantas': 0, 'modelos': 0,
             'participantes': 0, 'publicacoes_telegram': 0,
             'arquivos': {'fotos': 0, 'plantas': 0, 'originais': 0, 'modelos': 0}}
    nova = rpc(c, c.sem_obra, 'select public.admin_salvar_obra(%s::jsonb)',
               (json.dumps({'slug': f'vazia-{uuid.uuid4().hex[:8]}', 'nome': 'Vazia'}),))
    assert rpc(c, c.sem_obra, 'select public.admin_resumo_obra(%s)', (nova['slug'],)) == vazia
    with pytest.raises(errors.NoDataFound):
        sql(c, "select public.admin_resumo_obra('nao-existe')", usuario=c.sem_obra)


@pytest.mark.parametrize('confirmacao', [None, '', 'obra a', 'OBRA A', 'Obra', 'Obra a.', 'Obra  a'])
def test_confirmacao_errada_recusa_e_nao_apaga_nada(cheio, confirmacao):
    c = cheio
    assert nome(c, c.obra_a) == 'Obra a'
    antes = linhas_por_tabela(c, c.obra_a)
    with pytest.raises(errors.InvalidParameterValue, match='digite exatamente o nome da obra: Obra a'):
        excluir(c, c.sem_obra, c.obra_a, confirmacao)
    assert linhas_por_tabela(c, c.obra_a) == antes
    assert su(c, 'select count(*) from public.obra_excluida where obra_id = %s', (c.obra_a,)) == [(0,)]


def test_excluir_exige_admin(cheio):
    c = cheio
    antes = linhas_por_tabela(c, c.obra_a)
    for u in (c.gestor_a, c.equipe_a):
        with pytest.raises(errors.InsufficientPrivilege):
            excluir(c, u, c.obra_a, 'Obra a')
    with pytest.raises(errors.InvalidAuthorizationSpecification):
        sql(c, "select public.admin_excluir_obra(%s, 'Obra a')", (slug(c, c.obra_a),))  # sem usuário
    for comando in ("select public.admin_excluir_obra('x', 'x')", "select public.admin_resumo_obra('x')",
                    'select public.admin_listar_exclusoes()'):
        with pytest.raises(errors.InsufficientPrivilege):
            sql(c, comando, papel='anon')
    for comando in ("select public.admin_resumo_obra('x')", 'select public.admin_listar_exclusoes()'):
        with pytest.raises(errors.InsufficientPrivilege):
            sql(c, comando, usuario=c.gestor_a)
    assert linhas_por_tabela(c, c.obra_a) == antes


def test_excluir_obra_arquivada(cheio):
    c = cheio
    arquivar(c, c.sem_obra, c.obra_a)
    excluir(c, c.sem_obra, c.obra_a, 'Obra a')
    assert su(c, 'select count(*) from public.obra where id = %s', (c.obra_a,)) == [(0,)]


def test_admin_listar_exclusoes(cheio):
    c = cheio
    tornar_admin(c, c.gestor_b)
    e1 = excluir(c, c.sem_obra, c.obra_a, 'Obra a')
    e2 = excluir(c, c.gestor_b, c.obra_b, 'Obra b')
    lista = rpc(c, c.sem_obra, 'select public.admin_listar_exclusoes()')
    assert len(lista) <= 50
    ids = [x['id'] for x in lista]
    assert ids.index(e2['exclusao_id']) < ids.index(e1['exclusao_id'])  # mais recente primeiro
    item = next(x for x in lista if x['id'] == e1['exclusao_id'])
    assert set(item) == {'id', 'obra_id', 'slug', 'nome', 'excluida_em', 'excluida_por_nome', 'resumo',
                         'arquivos_removidos_em', 'arquivos_removidos', 'arquivos_erro'}
    assert (item['obra_id'], item['nome'], item['excluida_por_nome'], item['resumo']) == (
        str(c.obra_a), 'Obra a', 'Usuário 3', e1['resumo'])
    assert item['arquivos_removidos_em'] is None and item['arquivos_erro'] is None
    with sessao(c.dsn, papel=None) as cur:
        cur.execute('select count(*) from public.obra_excluida')
        if cur.fetchone()[0] > 50:
            assert len(lista) == 50


# --- RPCs da limpeza (service_role) -------------------------------------------------------------

@pytest.mark.parametrize('papel', ['authenticated', 'anon'])
@pytest.mark.parametrize('comando', [
    'select public.admin_exclusao_para_limpar(%s)',
    "select public.admin_registrar_limpeza(%s, '{}'::jsonb, null)",
])
def test_rpcs_de_limpeza_negadas_fora_da_service_role(cheio, papel, comando):
    c = cheio
    e = excluir(c, c.sem_obra, c.obra_a, 'Obra a')
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, comando, (e['exclusao_id'],), papel=papel, usuario=c.sem_obra if papel == 'authenticated' else None)


@pytest.mark.parametrize('tabela', ['public.obra_excluida'])
def test_authenticated_nao_le_a_auditoria(cheio, tabela):
    c = cheio
    for papel in ('authenticated', 'anon'):
        with pytest.raises(errors.InsufficientPrivilege):
            sql(c, f'select * from {tabela}', papel=papel, usuario=c.sem_obra if papel == 'authenticated' else None)


def test_limpeza_pela_service_role(cheio):
    c = cheio
    e = excluir(c, c.sem_obra, c.obra_a, 'Obra a')
    eid = e['exclusao_id']
    assert sql(c, 'select public.admin_exclusao_para_limpar(%s)', (eid,), papel='service_role') == [(c.obra_a,)]
    with pytest.raises(errors.NoDataFound):
        sql(c, 'select public.admin_exclusao_para_limpar(%s)', (uuid.uuid4(),), papel='service_role')

    def estado():
        return su(c, 'select arquivos_removidos_em is not null, arquivos_removidos, arquivos_erro '
                     'from public.obra_excluida where id = %s', (eid,))[0]

    # falha parcial: guarda o erro e o que já saiu
    sql(c, 'select public.admin_registrar_limpeza(%s, %s::jsonb, %s)',
        (eid, json.dumps({'fotos': 100, 'plantas': 0}), 'x' * 600), papel='service_role')
    feito, removidos, erro = estado()
    assert not feito and removidos == {'fotos': 100, 'plantas': 0} and erro == 'x' * 500

    # nova tentativa completa: soma e limpa o erro
    sql(c, 'select public.admin_registrar_limpeza(%s, %s::jsonb, null)',
        (eid, json.dumps({'fotos': 4, 'plantas': 3, 'originais': 1, 'modelos': 1})), papel='service_role')
    assert estado() == (True, {'fotos': 104, 'plantas': 3, 'originais': 1, 'modelos': 1}, None)
    item = next(x for x in rpc(c, c.sem_obra, 'select public.admin_listar_exclusoes()') if x['id'] == eid)
    assert item['arquivos_removidos'] == {'fotos': 104, 'plantas': 3, 'originais': 1, 'modelos': 1}
    assert item['arquivos_removidos_em'] is not None

    with pytest.raises(errors.NoDataFound):
        sql(c, "select public.admin_registrar_limpeza(%s, '{}'::jsonb, null)", (uuid.uuid4(),), papel='service_role')
    for invalido in ('[]', '{"fotos": -1}', '{"fotos": "1"}', '{"fotos": 1.5}'):
        with pytest.raises(errors.InvalidParameterValue):
            sql(c, 'select public.admin_registrar_limpeza(%s, %s::jsonb, null)', (eid, invalido),
                papel='service_role')
