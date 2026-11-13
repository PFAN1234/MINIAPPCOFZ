"""Testes da migration da edição do boletim emitido (20261115090000_boletim_edicao.sql).

Contrato: docs/contrato-boletim.md ("Parte 4"). Reaproveita os auxiliares de test_boletim_emissao.py.
"""
import json
import uuid
from datetime import timedelta

import pytest

psycopg = pytest.importorskip('psycopg', reason='psycopg não instalado')
from psycopg import errors  # noqa: E402

from test_boletim_emissao import (  # noqa: E402,F401
    DIA, boletim, limpo, numero, pdf, pedido, preparar_etapa, rpc, slug, sql, srv, su, tornar_admin,
)

EDICAO = {'textos': {'servico:abc': 'Novo texto'}, 'ocultos': ['aberta:xyz'], 'fotos_ocultas': ['a/b/c.jpg']}


def salvar(c, b, edicao, usuario=None):
    return rpc(c, usuario or c.sem_obra, 'select public.admin_salvar_rascunho_boletim(%s, %s::jsonb)',
               (b, json.dumps(edicao)))


def retificar(c, b, edicao, usuario=None):
    return rpc(c, usuario or c.sem_obra, 'select public.admin_retificar_boletim(%s, %s::jsonb)',
               (b, json.dumps(edicao)))


def rascunho(c, b):
    return su(c, 'select edicao, atualizado_por from public.boletim_rascunho where boletim_id = %s', (b,))


def numero_de(c, b):
    return su(c, 'select numero from public.boletim where id = %s', (b,))[0][0]


def nome_etapa(c, etapa=None):
    return su(c, 'select nome from public.etapa where id = %s', (etapa or c.etapa,))[0][0]


def admin_pronto(c):
    preparar_etapa(c)
    tornar_admin(c, c.sem_obra)


def com_gerador(c):
    su(c, "insert into vault.decrypted_secrets (name, decrypted_secret) values "
          "('url_gerador_boletim', 'https://app.test/api/gerar-boletim'), ('segredo_interno', 'SEG')")


# --- Formato da edição ----------------------------------------------------------------------------

@pytest.mark.parametrize('edicao', [
    {}, {'textos': {}}, EDICAO, {'ocultos': []}, {'textos': {'x': ''}},
    {'textos': {'x': 'a' * 2000}}, {'ocultos': ['a'] * 500}, {'fotos_ocultas': ['a'] * 500},
])
def test_formato_valido(cenario, edicao):
    su(cenario, 'select privado.validar_edicao(%s::jsonb)', (json.dumps(edicao),))


@pytest.mark.parametrize('edicao', [
    [], 'texto', 3, {'outra': 1}, {'textos': []}, {'textos': 'x'}, {'textos': {'a': 1}},
    {'textos': {'a': None}}, {'textos': {'a': 'a' * 2001}}, {'ocultos': {}}, {'ocultos': [1]},
    {'ocultos': ['a'] * 501}, {'fotos_ocultas': 'x'}, {'fotos_ocultas': [None]}, {'fotos_ocultas': ['a'] * 501},
])
def test_formato_invalido(cenario, edicao):
    with pytest.raises(errors.InvalidParameterValue, match='Edição do boletim inválida'):
        su(cenario, 'select privado.validar_edicao(%s::jsonb)', (json.dumps(edicao),))


def test_formato_nulo(cenario):
    with pytest.raises(errors.InvalidParameterValue, match='Edição do boletim inválida'):
        su(cenario, 'select privado.validar_edicao(null)')


# --- Rascunho ----------------------------------------------------------------------------------------

def test_salvar_rascunho(cenario):
    c = cenario
    admin_pronto(c)
    b = boletim(c, DIA)
    r = salvar(c, b, EDICAO)
    assert set(r) == {'atualizado_em'}
    assert rascunho(c, b) == [(EDICAO, c.sem_obra)]
    # upsert
    nova = {'ocultos': ['servico:1']}
    assert salvar(c, b, nova)['atualizado_em']
    assert rascunho(c, b) == [(nova, c.sem_obra)]
    # edição vazia apaga o rascunho
    assert salvar(c, b, {'textos': {}, 'ocultos': [], 'fotos_ocultas': []}) is None
    assert rascunho(c, b) == []
    assert salvar(c, b, {}) is None


def test_salvar_rascunho_erros(cenario):
    c = cenario
    admin_pronto(c)
    b0 = boletim(c, DIA)
    b1 = boletim(c, DIA, 1)
    with pytest.raises(errors.InvalidParameterValue, match='Só a última revisão'):
        salvar(c, b0, EDICAO)
    with pytest.raises(errors.InvalidParameterValue, match='Edição do boletim inválida'):
        salvar(c, b1, {'x': 1})
    with pytest.raises(errors.NoDataFound):
        salvar(c, uuid.uuid4(), EDICAO)
    assert rascunho(c, b0) == [] and rascunho(c, b1) == []


def test_rascunho_sem_acesso_direto(cenario):
    c = cenario
    admin_pronto(c)
    b = boletim(c, DIA)
    salvar(c, b, EDICAO)
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, 'select * from public.boletim_rascunho', usuario=c.sem_obra)
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, 'select * from public.boletim_rascunho', papel='anon')


# --- Retificação -------------------------------------------------------------------------------------

def test_retificar(cenario):
    c = cenario
    admin_pronto(c)
    com_gerador(c)
    boletim(c, DIA)
    b1 = boletim(c, DIA, 1)
    r = retificar(c, b1, EDICAO)
    assert (r['data'], r['revisao'], r['estado'], r['tentativas'], r['erro'], r['numero']) == (
        '2026-11-10', 2, 'pendente', 0, None, numero(c, DIA) + '-R2')
    assert su(c, 'select base_boletim_id, edicao, pedido_por, revisao from public.boletim_emissao where id = %s',
              (r['id'],)) == [(b1, EDICAO, c.sem_obra, 2)]
    assert rascunho(c, b1) == [(EDICAO, c.sem_obra)]
    assert su(c, 'select url from net.pedido_stub') == [('https://app.test/api/gerar-boletim',)]
    # em andamento (pendente e gerando)
    with pytest.raises(errors.UniqueViolation, match='emissão em andamento'):
        retificar(c, b1, EDICAO)
    su(c, "update public.boletim_emissao set estado = 'gerando' where id = %s", (r['id'],))
    with pytest.raises(errors.UniqueViolation):
        retificar(c, b1, EDICAO)
    # pedido que falhou volta à fila (mesma revisão), com a nova edição
    su(c, "update public.boletim_emissao set estado = 'falhou', tentativas = 8, erro = 'x' where id = %s", (r['id'],))
    nova = {'ocultos': ['servico:9']}
    de_novo = retificar(c, b1, nova)
    assert (de_novo['id'], de_novo['estado'], de_novo['tentativas'], de_novo['erro']) == (r['id'], 'pendente', 0, None)
    assert su(c, 'select edicao from public.boletim_emissao where id = %s', (r['id'],)) == [(nova,)]
    assert rascunho(c, b1) == [(nova, c.sem_obra)]


def test_retificar_erros(cenario):
    c = cenario
    admin_pronto(c)
    b0 = boletim(c, DIA)
    b1 = boletim(c, DIA, 1)
    with pytest.raises(errors.InvalidParameterValue, match='Só a última revisão'):
        retificar(c, b0, EDICAO)
    with pytest.raises(errors.InvalidParameterValue, match='Nenhuma alteração para enviar'):
        retificar(c, b1, {})
    with pytest.raises(errors.InvalidParameterValue, match='Nenhuma alteração para enviar'):
        retificar(c, b1, {'textos': {}, 'ocultos': [], 'fotos_ocultas': []})
    with pytest.raises(errors.InvalidParameterValue, match='Edição do boletim inválida'):
        retificar(c, b1, {'textos': {'a': 1}})
    with pytest.raises(errors.NoDataFound):
        retificar(c, uuid.uuid4(), EDICAO)
    assert su(c, 'select count(*) from public.boletim_emissao where etapa_id = %s', (c.etapa,)) == [(0,)]
    assert rascunho(c, b1) == []


def test_retificar_com_pedido_em_andamento_do_dia(cenario):
    c = cenario
    admin_pronto(c)
    b = boletim(c, DIA)
    pedido(c, DIA, 1)
    with pytest.raises(errors.UniqueViolation, match='emissão em andamento'):
        retificar(c, b, EDICAO)
    # pedido de outro dia não atrapalha
    su(c, 'delete from public.boletim_emissao where etapa_id = %s', (c.etapa,))
    pedido(c, DIA + timedelta(days=1))
    assert retificar(c, b, EDICAO)['revisao'] == 1


# --- Gerador -------------------------------------------------------------------------------------------

def test_reivindicar_devolve_base_e_edicao(cenario):
    c = cenario
    admin_pronto(c)
    b = boletim(c, DIA)
    r = retificar(c, b, EDICAO)
    lote = srv(c, 'select public.reivindicar_emissoes()')
    assert [x['id'] for x in lote] == [r['id']]
    assert (lote[0]['base_boletim_id'], lote[0]['edicao'], lote[0]['revisao']) == (str(b), EDICAO, 1)
    outro = pedido(c, DIA - timedelta(days=1))
    lote = srv(c, 'select public.reivindicar_emissoes()')
    assert [(x['id'], x['base_boletim_id'], x['edicao']) for x in lote] == [(outro, None, None)]


def test_snapshot_emitido(cenario):
    c = cenario
    b = boletim(c, DIA, snapshot={'data': '2026-11-10', 'obras': []})
    assert srv(c, 'select public.boletim_snapshot_emitido(%s)', (b,)) == {'data': '2026-11-10', 'obras': []}
    with pytest.raises(errors.NoDataFound):
        srv(c, 'select public.boletim_snapshot_emitido(%s)', (uuid.uuid4(),))
    for papel, usuario in (('authenticated', c.sem_obra), ('anon', None)):
        with pytest.raises(errors.InsufficientPrivilege):
            sql(c, 'select public.boletim_snapshot_emitido(%s)', (b,), papel=papel, usuario=usuario)


def test_concluir_copia_base_e_edicao_e_apaga_rascunho(cenario):
    c = cenario
    admin_pronto(c)
    base = boletim(c, DIA)
    r = retificar(c, base, EDICAO)
    assert len(rascunho(c, base)) == 1
    srv(c, 'select public.reivindicar_emissoes()')
    n = numero(c, DIA, 1)
    caminho = f"{c.etapa}/{n.replace('/', '')}.pdf"
    pdf(c, caminho)
    snap = {'data': '2026-11-10', 'obras': []}
    out = srv(c, 'select public.concluir_emissao(%s, %s::jsonb, %s)', (r['id'], json.dumps(snap), caminho))
    assert out['numero'] == n
    assert su(c, 'select base_boletim_id, edicao, revisao, emitido_por from public.boletim where id = %s',
              (out['boletim_id'],)) == [(base, EDICAO, 1, c.sem_obra)]
    assert rascunho(c, base) == []
    # idempotente
    assert srv(c, 'select public.concluir_emissao(%s, %s::jsonb, %s)', (r['id'], json.dumps(snap), caminho)) == out


def test_concluir_sem_base_continua_sem_edicao(cenario):
    c = cenario
    preparar_etapa(c)
    pid = pedido(c, DIA)
    srv(c, 'select public.reivindicar_emissoes()')
    n = numero(c, DIA)
    caminho = f"{c.etapa}/{n.replace('/', '')}.pdf"
    pdf(c, caminho)
    out = srv(c, 'select public.concluir_emissao(%s, %s::jsonb, %s)',
              (pid, json.dumps({'data': '2026-11-10'}), caminho))
    assert su(c, 'select base_boletim_id, edicao from public.boletim where id = %s',
              (out['boletim_id'],)) == [(None, None)]


def test_regra_base_e_edicao_juntas(cenario):
    c = cenario
    preparar_etapa(c)
    b = boletim(c, DIA)
    with pytest.raises(errors.CheckViolation):
        pedido(c, DIA, 1, base_boletim_id=b)
    with pytest.raises(errors.CheckViolation):
        pedido(c, DIA, 1, edicao=json.dumps(EDICAO))
    with pytest.raises(errors.CheckViolation):
        su(c, 'update public.boletim set edicao = %s::jsonb where id = %s', (json.dumps(EDICAO), b))
    with pytest.raises(errors.CheckViolation):
        su(c, 'update public.boletim set base_boletim_id = %s where id = %s', (b, b))


def test_excluir_etapa_com_retificacao_editada(cenario):
    c = cenario
    admin_pronto(c)
    base = boletim(c, DIA)
    r = boletim(c, DIA, 1)
    su(c, 'update public.boletim set base_boletim_id = %s, edicao = %s::jsonb where id = %s',
       (base, json.dumps(EDICAO), r))
    salvar(c, r, EDICAO)
    rpc(c, c.sem_obra, 'select public.admin_excluir_etapa(%s, %s)', (slug(c), nome_etapa(c)))
    assert su(c, 'select count(*) from public.boletim where etapa_id = %s', (c.etapa,)) == [(0,)]
    assert su(c, 'select count(*) from public.boletim_rascunho where boletim_id in (%s, %s)', (base, r)) == [(0,)]


# --- Listagem geral ---------------------------------------------------------------------------------------

def test_listar_todos_boletins(cenario):
    c = cenario
    admin_pronto(c)
    s = slug(c)
    nome = nome_etapa(c)
    outra = uuid.uuid4()
    su(c, "insert into public.etapa (id, slug, nome, sigla, fuso, boletim_horario) "
          "values (%s, %s, %s, %s, 'America/Rio_Branco', '22:00')",
       (outra, f'outra-{outra.hex[:8]}', f'Outra {outra.hex[:8]}', f'O{outra.hex[:6].upper()}'))
    su(c, "update public.usuario set nome_exibicao = 'CP PATRICIO' where id = %s", (c.sem_obra,))
    d_ant = DIA - timedelta(days=1)
    b_ant = boletim(c, d_ant)
    b0 = boletim(c, DIA)
    b1 = boletim(c, DIA, 1)
    su(c, 'update public.boletim set base_boletim_id = %s, edicao = %s::jsonb, emitido_por = %s where id = %s',
       (b0, json.dumps(EDICAO), c.sem_obra, b1))
    bo = boletim(c, DIA, etapa=outra)
    salvar(c, b1, EDICAO)
    su(c, "insert into public.publicacao_telegram (boletim_id, estado) values (%s, 'publicado')", (b0,))
    p_ok = pedido(c, DIA, 2, estado='falhou', tentativas=8, erro='Chromium caiu', base_boletim_id=b1,
                  edicao=json.dumps(EDICAO))
    p_outra = pedido(c, DIA + timedelta(days=1), etapa=outra)
    pedido(c, DIA, 3, estado='emitido', boletim_id=b_ant)

    lista = 'select public.admin_listar_todos_boletins(%s, %s, %s)'
    with pytest.raises(errors.InsufficientPrivilege):
        rpc(c, c.gestor_a, lista, (None, None, None))
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, lista, (None, None, None), papel='anon')

    r = rpc(c, c.sem_obra, lista, (None, None, None))
    # o banco é compartilhado entre os testes: só as etapas deste cenário
    meus = {s, su(c, 'select slug from public.etapa where id = %s', (outra,))[0][0]}
    ids = [x['id'] for x in r['boletins'] if x['etapa_slug'] in meus]
    nome_outra = nome_etapa(c, outra)
    do_dia = sorted([(nome, 1, b1), (nome, 0, b0), (nome_outra, 0, bo)], key=lambda t: (t[0], -t[1]))
    assert ids == [str(t[2]) for t in do_dia] + [str(b_ant)]
    por_id = {x['id']: x for x in r['boletins']}
    x1 = por_id[str(b1)]
    assert (x1['etapa_slug'], x1['etapa_nome'], x1['base_numero'], x1['editado'], x1['tem_rascunho']) == (
        s, nome, numero_de(c, b0), True, True)
    assert x1['emitido_por_nome'] == 'CP PATRICIO'
    x0 = por_id[str(b0)]
    assert (x0['base_numero'], x0['editado'], x0['tem_rascunho'], x0['publicado'], x0['publicacao_estado']) == (
        None, False, False, True, 'publicado')
    assert set(x1) == {'id', 'data', 'revisao', 'numero', 'emitido_em', 'emitido_por_nome', 'pdf_path', 'publicado',
                       'publicacao_estado', 'publicacao_erro', 'publicacao_tentativas', 'etapa_slug', 'etapa_nome',
                       'base_numero', 'editado', 'tem_rascunho'}
    assert {x['id'] for x in r['pedidos']} == {p_ok, p_outra}
    pk = next(x for x in r['pedidos'] if x['id'] == p_ok)
    assert (pk['etapa_slug'], pk['etapa_nome'], pk['editado'], pk['estado'], pk['erro']) == (
        s, nome, True, 'falhou', 'Chromium caiu')
    assert set(pk) == {'id', 'data', 'revisao', 'estado', 'tentativas', 'erro', 'atualizado_em', 'etapa_slug',
                       'etapa_nome', 'editado'}
    assert next(x for x in r['pedidos'] if x['id'] == p_outra)['editado'] is False

    # filtro por etapa
    r = rpc(c, c.sem_obra, lista, (s, None, None))
    assert [x['id'] for x in r['boletins']] == [str(b1), str(b0), str(b_ant)]
    assert [x['id'] for x in r['pedidos']] == [p_ok]
    # filtro por período (inclusivo)
    r = rpc(c, c.sem_obra, lista, (s, DIA, DIA))
    assert [x['id'] for x in r['boletins']] == [str(b1), str(b0)]
    r = rpc(c, c.sem_obra, lista, (s, d_ant, d_ant))
    assert [x['id'] for x in r['boletins']] == [str(b_ant)] and r['pedidos'] == []
    r = rpc(c, c.sem_obra, lista, (s, DIA + timedelta(days=1), None))
    assert r == {'boletins': [], 'pedidos': []}
    r = rpc(c, c.sem_obra, lista, (None, None, d_ant))
    assert [x['id'] for x in r['boletins'] if x['etapa_slug'] in meus] == [str(b_ant)]
    with pytest.raises(errors.NoDataFound):
        rpc(c, c.sem_obra, lista, ('nao-existe', None, None))


def test_listar_todos_limite_de_300(cenario):
    c = cenario
    admin_pronto(c)
    su(c, "insert into public.boletim (etapa_id, data, revisao, numero, snapshot) "
          "select %s, %s::date - g, 0, 'L' || g || %s, '{}' from generate_series(1, 305) g",
       (c.etapa, DIA, uuid.uuid4().hex))
    r = rpc(c, c.sem_obra, 'select public.admin_listar_todos_boletins(%s)', (slug(c),))
    assert len(r['boletins']) == 300
    assert r['boletins'][0]['data'] == (DIA - timedelta(days=1)).isoformat()


def test_listar_boletins_da_etapa_continua_igual(cenario):
    c = cenario
    admin_pronto(c)
    b = boletim(c, DIA)
    r = rpc(c, c.sem_obra, 'select public.admin_listar_boletins(%s)', (slug(c),))
    assert set(r['boletins'][0]) == {'id', 'data', 'revisao', 'numero', 'emitido_em', 'emitido_por_nome', 'pdf_path',
                                     'publicado', 'publicacao_estado', 'publicacao_erro', 'publicacao_tentativas'}
    assert r['boletins'][0]['id'] == str(b)


# --- admin_boletim -------------------------------------------------------------------------------------------

def test_admin_boletim(cenario):
    c = cenario
    admin_pronto(c)
    su(c, "update public.usuario set nome_exibicao = 'CP PATRICIO' where id = %s", (c.sem_obra,))
    snap = {'data': '2026-11-10', 'obras': [{'id': 'x'}]}
    b0 = boletim(c, DIA, snapshot=snap)
    b1 = boletim(c, DIA, 1)
    su(c, 'update public.boletim set base_boletim_id = %s, edicao = %s::jsonb where id = %s',
       (b0, json.dumps(EDICAO), b1))
    su(c, "insert into public.publicacao_telegram (boletim_id, estado) values (%s, 'publicado')", (b0,))
    ver = 'select public.admin_boletim(%s)'
    with pytest.raises(errors.InsufficientPrivilege):
        rpc(c, c.gestor_a, ver, (b0,))
    with pytest.raises(errors.NoDataFound, match='Boletim não encontrado'):
        rpc(c, c.sem_obra, ver, (uuid.uuid4(),))

    r = rpc(c, c.sem_obra, ver, (b0,))
    assert set(r) == {'id', 'etapa_slug', 'etapa_nome', 'data', 'revisao', 'numero', 'emitido_em',
                      'emitido_por_nome', 'pdf_path', 'publicado', 'publicacao_estado', 'ultima_revisao',
                      'emissao_em_andamento', 'base_numero', 'edicao', 'snapshot', 'rascunho'}
    assert (r['id'], r['etapa_slug'], r['data'], r['revisao'], r['snapshot']) == (
        str(b0), slug(c), '2026-11-10', 0, snap)
    assert (r['publicado'], r['publicacao_estado'], r['ultima_revisao'], r['emissao_em_andamento']) == (
        True, 'publicado', False, False)
    assert (r['base_numero'], r['edicao'], r['rascunho']) == (None, None, None)

    salvar(c, b1, {'ocultos': ['servico:1']})
    r = rpc(c, c.sem_obra, ver, (b1,))
    assert (r['ultima_revisao'], r['base_numero'], r['edicao'], r['publicado'], r['publicacao_estado']) == (
        True, numero_de(c, b0), EDICAO, False, None)
    assert r['rascunho']['edicao'] == {'ocultos': ['servico:1']}
    assert r['rascunho']['atualizado_por_nome'] == 'CP PATRICIO' and r['rascunho']['atualizado_em']

    pedido(c, DIA, 2, estado='gerando')
    assert rpc(c, c.sem_obra, ver, (b1,))['emissao_em_andamento'] is True
    su(c, "update public.boletim_emissao set estado = 'falhou' where etapa_id = %s", (c.etapa,))
    assert rpc(c, c.sem_obra, ver, (b1,))['emissao_em_andamento'] is False


# --- Política de storage e acessos ------------------------------------------------------------------------------

def test_politica_fotos_admin_select(cenario):
    c = cenario
    admin_pronto(c)
    nome = f'{c.obra_a}/{uuid.uuid4()}/{uuid.uuid4()}.jpg'
    su(c, "insert into storage.objects (bucket_id, name) values ('fotos', %s)", (nome,))
    q = "select bucket_id from storage.objects where name = %s"
    assert sql(c, q, (nome,), usuario=c.sem_obra) == [('fotos',)]
    assert sql(c, q, (nome,), usuario=uuid.uuid4()) == []
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, q, (nome,), papel='anon')
    pol = su(c, "select roles::text, cmd from pg_policies where policyname = 'fotos_admin_select'")
    assert pol == [('{authenticated}', 'SELECT')]


@pytest.mark.parametrize('comando', [
    "select public.admin_listar_todos_boletins()",
    "select public.admin_boletim(gen_random_uuid())",
    "select public.admin_salvar_rascunho_boletim(gen_random_uuid(), '{}')",
    "select public.admin_retificar_boletim(gen_random_uuid(), '{}')",
])
def test_rpcs_do_site_so_para_admin(cenario, comando):
    c = cenario
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, comando, usuario=c.gestor_a)
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, comando, papel='anon')


@pytest.mark.parametrize('comando', [
    "select privado.validar_edicao('{}')",
    "select privado.edicao_vazia('{}')",
    "select public.boletim_snapshot_emitido(gen_random_uuid())",
])
def test_funcoes_internas_sem_acesso(cenario, comando):
    c = cenario
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, comando, usuario=c.sem_obra)
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, comando, papel='anon')
