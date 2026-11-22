"""Testes dos documentos da Central de modelos (migrations 20261127090000_documentos.sql e
20261126090000_admin_central_obras.sql).

RLS de `documento` e `documento_vinculo` (só admin lê; ninguém grava direto), RPCs `admin_*_documento`
e `admin_central_obras` só para admin, revisão repetida e documento retirado. O banco é compartilhado
na sessão: cada teste usa obras e uuids próprios.
"""
import json
import uuid
from types import SimpleNamespace

import pytest

psycopg = pytest.importorskip('psycopg', reason='psycopg não instalado')

from conftest import sessao  # noqa: E402

u = uuid.uuid4
MSG_ADMIN = 'Apenas admins do Mini App podem fazer isto'


def sql(dsn, comando, params=(), papel='authenticated', usuario=None):
    with sessao(dsn, usuario, papel=papel) as cur:
        cur.execute(comando, params)
        return cur.fetchall() if cur.description else None


def su(dsn, comando, params=()):
    return sql(dsn, comando, params, papel=None)


@pytest.fixture
def c(dsn, cenario):
    """Cenário + um admin. `part` participa da obra A (não é admin); `fora` não tem obra."""
    a = u()
    su(dsn, 'insert into auth.users (id, email) values (%s, %s)', (a, f'{a}@teste.invalid'))
    su(dsn, 'insert into public.usuario (id, telegram_id, nome) values (%s, %s, %s)', (a, u().int % 10**15, 'Admin Um'))
    su(dsn, 'insert into public.admin_app (usuario_id) values (%s)', (a,))
    slug = su(dsn, 'select slug from public.obra where id = %s', (cenario.obra_a,))[0][0]
    return SimpleNamespace(dsn=dsn, cen=cenario, admin=a, part=cenario.equipe_a, gestor=cenario.gestor_a,
                           fora=cenario.sem_obra, obra=str(cenario.obra_a), slug=slug)


def rpc(c, usuario, nome, *args, papel='authenticated'):
    marcas = ', '.join(['%s'] * len(args))
    r = sql(c.dsn, f'select public.{nome}({marcas})', args, papel=papel, usuario=usuario)[0][0]
    return str(r) if isinstance(r, uuid.UUID) else r


def tenta(c, usuario, nome, *args):
    """Resultado da RPC ou a mensagem do erro levantado."""
    try:
        return rpc(c, usuario, nome, *args)
    except psycopg.Error as e:
        return e.diag.message_primary


def registrar(c, serie=None, revisao='R01', sha=None, **extra):
    """Sobe o arquivo (confirmado) e registra a revisão pelo admin; devolve o JSON do documento."""
    serie = serie or str(u())
    sha = sha or u().hex + u().hex
    cam = f'{c.obra}/{serie}/{sha}.pdf'
    rpc(c, None, 'arquivo_registrar_servico', 'documentos', cam, 10, 'application/pdf', papel='service_role')
    p = {'serie': serie, 'titulo': 'Memorial', 'tipo': 'memorial', 'revisao': revisao, 'arquivo_nome': 'm.pdf',
         'mime': 'application/pdf', 'bytes': 10, 'sha256': sha, 'caminho': cam, **extra}
    return rpc(c, c.admin, 'admin_registrar_documento', c.slug, json.dumps(p))


def vinc(sigla='ARQ', gid='g1', tipo='elemento'):
    return {'tipo': tipo, 'sigla': sigla, 'global_id': gid}


# RLS --------------------------------------------------------------------------------------------

def test_admin_le_as_tabelas(c):
    d = registrar(c)
    rpc(c, c.admin, 'admin_vincular_documento', d['id'], json.dumps([vinc()]))
    assert sql(c.dsn, 'select count(*) from public.documento where id = %s', (d['id'],), usuario=c.admin)[0][0] == 1
    assert sql(c.dsn, 'select count(*) from public.documento_vinculo where documento_id = %s', (d['id'],),
               usuario=c.admin)[0][0] == 1


def test_nao_admin_nao_le_as_tabelas(c):
    d = registrar(c)
    rpc(c, c.admin, 'admin_vincular_documento', d['id'], json.dumps([vinc()]))
    for quem in (c.part, c.gestor, c.fora):
        assert sql(c.dsn, 'select count(*) from public.documento', usuario=quem)[0][0] == 0, quem
        assert sql(c.dsn, 'select count(*) from public.documento_vinculo', usuario=quem)[0][0] == 0, quem
    with pytest.raises(psycopg.Error):
        sql(c.dsn, 'select * from public.documento', papel='anon')
    with pytest.raises(psycopg.Error):
        sql(c.dsn, 'select * from public.documento_vinculo', papel='anon')


def test_ninguem_grava_direto(c):
    d = registrar(c)
    escritas = [
        ("insert into public.documento (obra_id, serie, titulo, tipo, revisao, caminho, arquivo_nome, mime, bytes, sha256) "
         "values (%s, %s, 'x', 'outro', 'R9', 'c', 'c.pdf', 'application/pdf', 1, %s)", (c.obra, str(u()), 'a' * 64)),
        ("update public.documento set titulo = 'hack' where id = %s", (d['id'],)),
        ('delete from public.documento where id = %s', (d['id'],)),
        ("insert into public.documento_vinculo (documento_id, tipo, sigla, global_id) values (%s, 'elemento', 'ARQ', 'z')",
         (d['id'],)),
        ('delete from public.documento_vinculo where documento_id = %s', (d['id'],)),
    ]
    for quem in (c.admin, c.part, c.fora):
        for comando, params in escritas:
            with pytest.raises(psycopg.Error):
                sql(c.dsn, comando, params, usuario=quem)
    for comando, params in escritas:
        with pytest.raises(psycopg.Error):
            sql(c.dsn, comando, params, papel='anon')
    assert su(c.dsn, 'select titulo from public.documento where id = %s', (d['id'],))[0][0] == 'Memorial'


# RPCs: admin consegue ----------------------------------------------------------------------------

def test_admin_percorre_o_fluxo_das_rpcs(c):
    serie = str(u())
    d = registrar(c, serie=serie)
    assert d['serie'] == serie and d['revisao'] == 'R01'
    lista = rpc(c, c.admin, 'admin_listar_documentos', c.slug)['documentos']
    assert [x['id'] for x in lista] == [d['id']]
    vs = rpc(c, c.admin, 'admin_vincular_documento', d['id'],
             json.dumps([vinc(), vinc(tipo='pavimento', gid='pav1')]))
    assert len(vs) == 2
    hist = rpc(c, c.admin, 'admin_historico_documento', serie)
    assert [h['id'] for h in hist] == [d['id']] and hist[0]['retirado_em'] is None
    rpc(c, c.admin, 'admin_retirar_documento', d['id'])
    assert rpc(c, c.admin, 'admin_listar_documentos', c.slug)['documentos'] == []
    assert rpc(c, c.admin, 'admin_historico_documento', serie)[0]['retirado_em'] is not None


def test_revisao_nova_substitui_a_vigente(c):
    serie = str(u())
    registrar(c, serie=serie, revisao='R01')
    r2 = registrar(c, serie=serie, revisao='R02')
    lista = rpc(c, c.admin, 'admin_listar_documentos', c.slug)['documentos']
    assert [x['id'] for x in lista] == [r2['id']]
    assert len(rpc(c, c.admin, 'admin_historico_documento', serie)) == 2


def test_central_obras_conta_documentos(c):
    antes = {o['slug']: o for o in rpc(c, c.admin, 'admin_central_obras')}[c.slug]
    assert antes['documentos'] == 0
    serie = str(u())
    registrar(c, serie=serie, revisao='R01')
    registrar(c, serie=serie, revisao='R02')
    registrar(c)
    depois = {o['slug']: o for o in rpc(c, c.admin, 'admin_central_obras')}
    assert depois[c.slug]['documentos'] == 2  # duas séries; revisões antigas não contam
    assert depois[c.slug]['atualizado_em'] is not None
    outra = su(c.dsn, 'select slug from public.obra where id = %s', (c.cen.obra_b,))[0][0]
    assert depois[outra]['documentos'] == 0


# RPCs: não admin e anônimo -------------------------------------------------------------------------

def test_nao_admin_bloqueado_em_todas_as_rpcs(c):
    d = registrar(c)
    chamadas = [
        ('admin_listar_documentos', (c.slug,)),
        ('admin_historico_documento', (d['serie'],)),
        ('admin_registrar_documento', (c.slug, json.dumps({}))),
        ('admin_vincular_documento', (d['id'], json.dumps([vinc()]))),
        ('admin_retirar_documento', (d['id'],)),
        ('admin_central_obras', ()),
    ]
    for nome, args in chamadas:
        marcas = ', '.join(['%s'] * len(args))
        for quem in (c.part, c.gestor, c.fora):
            assert tenta(c, quem, nome, *args) == MSG_ADMIN, (nome, quem)
        assert tenta(c, None, nome, *args) == 'Usuário não autenticado', nome
        with pytest.raises(psycopg.Error):
            sql(c.dsn, f'select public.{nome}({marcas})', args, papel='anon')
    # nada foi alterado pelas tentativas
    assert su(c.dsn, 'select retirado_em from public.documento where id = %s', (d['id'],))[0][0] is None


# Regras -------------------------------------------------------------------------------------------

def test_revisao_repetida_ja_existe(c):
    serie = str(u())
    registrar(c, serie=serie, revisao='R01')
    msg = tenta(c, c.admin, 'admin_registrar_documento', c.slug, json.dumps({
        'serie': serie, 'titulo': 'Memorial', 'tipo': 'memorial', 'revisao': 'R01', 'arquivo_nome': 'm.pdf',
        'mime': 'application/pdf', 'bytes': 10, 'sha256': 'c' * 64, 'caminho': f'{c.obra}/{serie}/{"c" * 64}.pdf'}))
    assert 'já existe' in msg


def test_documento_retirado_nao_aceita_vinculos(c):
    d = registrar(c)
    rpc(c, c.admin, 'admin_vincular_documento', d['id'], json.dumps([vinc()]))
    rpc(c, c.admin, 'admin_retirar_documento', d['id'])
    msg = tenta(c, c.admin, 'admin_vincular_documento', d['id'], json.dumps([vinc(gid='outro')]))
    assert 'retirado' in msg
    # os vínculos antigos seguem como estavam
    assert su(c.dsn, 'select count(*) from public.documento_vinculo where documento_id = %s', (d['id'],))[0][0] == 1
    assert 'já foi retirado' in tenta(c, c.admin, 'admin_retirar_documento', d['id'])


def test_vinculos_substituem_e_validam(c):
    d = registrar(c)
    rpc(c, c.admin, 'admin_vincular_documento', d['id'], json.dumps([vinc(gid='a'), vinc(gid='b')]))
    r = rpc(c, c.admin, 'admin_vincular_documento', d['id'], json.dumps([vinc(gid='c')]))
    assert [v['global_id'] for v in r] == ['c']
    assert 'Tipo de vínculo inválido' in tenta(c, c.admin, 'admin_vincular_documento', d['id'],
                                               json.dumps([vinc(tipo='sala')]))
    assert 'Sigla do vínculo inválida' in tenta(c, c.admin, 'admin_vincular_documento', d['id'],
                                                json.dumps([vinc(sigla='arq')]))
