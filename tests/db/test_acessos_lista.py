"""Testes da lista de acessos (matriz_acessos, definir_acesso e sincronizar_acesso com admin/visto).

Contrato: docs/contrato-acessos.md (A). O banco é compartilhado na sessão: as conferências
olham só as obras e pessoas do cenário.
"""
import json
import uuid

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


def matriz(c, usuario):
    return sql(c, 'select public.matriz_acessos()', usuario=usuario)[0][0]


def definir(c, usuario, obra, alvo, papel):
    sql(c, 'select public.definir_acesso(%s, %s, %s)', (obra, alvo, papel), usuario=usuario)


def sincronizar(c, usuario, obra, situacao):
    sql(c, 'select public.sincronizar_acesso(%s, %s::jsonb)',
        (usuario, json.dumps([{'obra_id': str(obra), 'situacao': situacao}])), papel='service_role')


def grupo(c, obra, usuario):
    r = su(c, 'select admin, conferido_em from privado.membro_grupo where obra_id = %s and usuario_id = %s',
           (obra, usuario))
    return r[0] if r else None


def papel(c, obra, usuario):
    r = su(c, 'select papel from public.participacao where obra_id = %s and usuario_id = %s', (obra, usuario))
    return r[0][0] if r else None


def pessoa(m, usuario):
    return next((p for p in m['pessoas'] if p['id'] == str(usuario)), None)


def novo_usuario(c, nome):
    uid = uuid.uuid4()
    su(c, 'insert into auth.users (id, email) values (%s, %s)', (uid, f'{uid}@teste.invalid'))
    su(c, 'insert into public.usuario (id, telegram_id, nome, username) values (%s, %s, %s, %s)',
       (uid, uuid.uuid4().int % 10**15, nome, 'u' + uid.hex[:6]))
    return uid


# --- matriz_acessos ---------------------------------------------------------------------------

def test_matriz_exige_gestor(cenario):
    c = cenario
    for u in (c.equipe_a, c.sem_obra):
        with pytest.raises(errors.InsufficientPrivilege, match='Só gestores veem a lista de acessos'):
            matriz(c, u)
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, 'select public.matriz_acessos()', papel='anon')
    with pytest.raises(psycopg.Error) as e:
        sql(c, 'select public.matriz_acessos()')  # authenticated sem usuário
    assert e.value.sqlstate == '28000'


def test_matriz_formato(cenario):
    c = cenario
    su(c, 'insert into privado.membro_grupo (obra_id, usuario_id, admin) values (%s, %s, true)',
       (c.obra_a, c.gestor_a))
    m = matriz(c, c.gestor_a)
    ids = [o['id'] for o in m['obras']]
    assert str(c.obra_a) in ids and str(c.obra_b) in ids
    assert set(m['obras'][0]) == {'id', 'slug', 'nome'}
    p = pessoa(m, c.gestor_a)
    assert set(p) == {'id', 'nome', 'username', 'admin', 'visto_em', 'acessos', 'pedidos'}
    assert p['admin'] is True and p['visto_em'] is not None
    assert p['acessos'] == {str(c.obra_a): 'gestor'}
    assert p['pedidos'] == []
    assert pessoa(m, c.equipe_a)['acessos'] == {str(c.obra_a): 'equipe'}
    assert pessoa(m, c.equipe_a)['visto_em'] is None and pessoa(m, c.equipe_a)['admin'] is False
    assert pessoa(m, c.sem_obra) is None
    # Sem repetição, mesmo com participação e grupo.
    assert len([x for x in m['pessoas'] if x['id'] == str(c.gestor_a)]) == 1


def test_matriz_usa_nome_de_exibicao(cenario):
    c = cenario
    su(c, "update public.usuario set nome_exibicao = 'NOME BONITO' where id = %s", (c.equipe_a,))
    assert pessoa(matriz(c, c.gestor_a), c.equipe_a)['nome'] == 'NOME BONITO'


def test_matriz_obra_arquivada_some(cenario):
    c = cenario
    extra = novo_usuario(c, 'Só na arquivada')
    su(c, 'insert into privado.membro_grupo (obra_id, usuario_id) values (%s, %s)', (c.obra_b, extra))
    assert pessoa(matriz(c, c.gestor_a), extra) is not None
    su(c, 'update public.obra set arquivada_em = now() where id = %s', (c.obra_b,))
    m = matriz(c, c.gestor_a)
    assert str(c.obra_b) not in [o['id'] for o in m['obras']]
    assert pessoa(m, extra) is None
    assert pessoa(m, c.gestor_b) is None
    # Quem só é gestor de obra arquivada deixa de ver a lista.
    with pytest.raises(errors.InsufficientPrivilege):
        matriz(c, c.gestor_b)


def test_matriz_so_grupo_tem_acessos_vazio(cenario):
    c = cenario
    extra = novo_usuario(c, 'Só no grupo')
    su(c, 'insert into privado.membro_grupo (obra_id, usuario_id) values (%s, %s)', (c.obra_a, extra))
    p = pessoa(matriz(c, c.gestor_a), extra)
    assert p['acessos'] == {} and p['pedidos'] == []


def test_matriz_pedidos_e_ordem(cenario):
    c = cenario
    aaa = novo_usuario(c, 'AAA sem pedido')
    zzz = novo_usuario(c, 'ZZZ com pedido')
    for u in (aaa, zzz):
        su(c, 'insert into privado.membro_grupo (obra_id, usuario_id) values (%s, %s)', (c.obra_a, u))
    su(c, "insert into public.solicitacao_acesso (obra_id, usuario_id, estado) values (%s, %s, 'pendente')",
       (c.obra_b, zzz))
    su(c, "insert into public.solicitacao_acesso (obra_id, usuario_id, estado) values (%s, %s, 'recusada')",
       (c.obra_a, aaa))
    m = matriz(c, c.gestor_a)
    assert pessoa(m, zzz)['pedidos'] == [str(c.obra_b)]
    assert pessoa(m, aaa)['pedidos'] == []
    ordem = [p['id'] for p in m['pessoas']]
    assert ordem.index(str(zzz)) < ordem.index(str(aaa))
    # Quem tem pedido vem antes de todos os que não têm.
    com_pedido = len([p for p in m['pessoas'] if p['pedidos']])
    assert all(p['pedidos'] for p in m['pessoas'][:com_pedido])
    assert not any(p['pedidos'] for p in m['pessoas'][com_pedido:])


# --- definir_acesso ---------------------------------------------------------------------------

def test_definir_gestor_de_outra_obra_libera(cenario):
    c = cenario
    definir(c, c.gestor_b, c.obra_a, c.sem_obra, 'equipe')
    assert papel(c, c.obra_a, c.sem_obra) == 'equipe'
    definir(c, c.gestor_b, c.obra_a, c.sem_obra, 'gestor')
    assert papel(c, c.obra_a, c.sem_obra) == 'gestor'
    definir(c, c.gestor_b, c.obra_a, c.sem_obra, 'equipe')  # há outro gestor
    assert papel(c, c.obra_a, c.sem_obra) == 'equipe'


def test_definir_exige_gestor(cenario):
    c = cenario
    with pytest.raises(errors.InsufficientPrivilege, match='Só gestores alteram acessos'):
        definir(c, c.equipe_a, c.obra_a, c.sem_obra, 'equipe')
    assert papel(c, c.obra_a, c.sem_obra) is None


def test_definir_nenhum_mantem_na_matriz(cenario):
    c = cenario
    su(c, 'insert into privado.membro_grupo (obra_id, usuario_id) values (%s, %s)', (c.obra_a, c.equipe_a))
    definir(c, c.gestor_a, c.obra_a, c.equipe_a, 'nenhum')
    assert papel(c, c.obra_a, c.equipe_a) is None
    assert grupo(c, c.obra_a, c.equipe_a) is not None
    p = pessoa(matriz(c, c.gestor_a), c.equipe_a)
    assert p is not None and p['acessos'] == {}
    definir(c, c.gestor_a, c.obra_a, c.sem_obra, 'nenhum')  # sem participação: não faz nada


def test_definir_aprova_pedido_pendente(cenario):
    c = cenario
    su(c, "insert into public.solicitacao_acesso (obra_id, usuario_id, estado) values (%s, %s, 'pendente')",
       (c.obra_a, c.sem_obra))
    su(c, "insert into public.solicitacao_acesso (obra_id, usuario_id, estado) values (%s, %s, 'pendente')",
       (c.obra_b, c.sem_obra))
    definir(c, c.gestor_a, c.obra_a, c.sem_obra, 'equipe')
    r = su(c, 'select obra_id, estado, decidido_por, decidido_em is not null '
              'from public.solicitacao_acesso where usuario_id = %s', (c.sem_obra,))
    por_obra = {x[0]: x for x in r}
    assert por_obra[c.obra_a][1:] == ('aprovada', c.gestor_a, True)
    assert por_obra[c.obra_b][1] == 'pendente'


def test_definir_admin_nao_e_rebaixado(cenario):
    c = cenario
    sincronizar(c, c.equipe_a, c.obra_a, 'admin')
    for p in ('equipe', 'nenhum'):
        with pytest.raises(errors.InvalidParameterValue, match='Administradores do grupo'):
            definir(c, c.gestor_b, c.obra_a, c.equipe_a, p)
    assert papel(c, c.obra_a, c.equipe_a) == 'gestor'
    definir(c, c.gestor_b, c.obra_a, c.equipe_a, 'gestor')  # permitido


def test_definir_ultimo_gestor(cenario):
    c = cenario
    for p in ('equipe', 'nenhum'):
        with pytest.raises(errors.InvalidParameterValue, match='pelo menos um gestor'):
            definir(c, c.gestor_b, c.obra_a, c.gestor_a, p)
    assert papel(c, c.obra_a, c.gestor_a) == 'gestor'


def test_definir_papel_invalido(cenario):
    c = cenario
    for p in ('dono', '', None):
        with pytest.raises(errors.InvalidParameterValue, match='Acesso inválido'):
            definir(c, c.gestor_a, c.obra_a, c.sem_obra, p)


def test_definir_obra_arquivada_ou_inexistente(cenario):
    c = cenario
    su(c, 'update public.obra set arquivada_em = now() where id = %s', (c.obra_b,))
    for obra in (c.obra_b, uuid.uuid4()):
        with pytest.raises(errors.NoDataFound, match='Obra não encontrada'):
            definir(c, c.gestor_a, obra, c.sem_obra, 'equipe')


def test_rpc_negada_a_anon(cenario):
    c = cenario
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, 'select public.definir_acesso(%s, %s, %s)', (c.obra_a, c.sem_obra, 'equipe'), papel='anon')


# --- sincronizar_acesso -----------------------------------------------------------------------

def test_sincronizar_admin_e_membro_gravam_admin(cenario):
    c = cenario
    sincronizar(c, c.sem_obra, c.obra_a, 'admin')
    assert grupo(c, c.obra_a, c.sem_obra)[0] is True
    assert papel(c, c.obra_a, c.sem_obra) == 'gestor'
    sincronizar(c, c.sem_obra, c.obra_a, 'membro')
    assert grupo(c, c.obra_a, c.sem_obra)[0] is False
    assert papel(c, c.obra_a, c.sem_obra) == 'gestor'  # membro não rebaixa (igual a antes)


def test_sincronizar_visto_nao_cria_participacao_e_mantem_admin(cenario):
    c = cenario
    sincronizar(c, c.sem_obra, c.obra_a, 'visto')
    g = grupo(c, c.obra_a, c.sem_obra)
    assert g is not None and g[0] is False
    assert papel(c, c.obra_a, c.sem_obra) is None
    sincronizar(c, c.sem_obra, c.obra_a, 'admin')
    antes = grupo(c, c.obra_a, c.sem_obra)[1]
    sincronizar(c, c.sem_obra, c.obra_a, 'visto')
    depois = grupo(c, c.obra_a, c.sem_obra)
    assert depois[0] is True and depois[1] >= antes
    su(c, "insert into public.solicitacao_acesso (obra_id, usuario_id, estado) values (%s, %s, 'pendente')",
       (c.obra_b, c.sem_obra))
    sincronizar(c, c.sem_obra, c.obra_b, 'visto')
    assert su(c, 'select estado from public.solicitacao_acesso where usuario_id = %s and obra_id = %s',
              (c.sem_obra, c.obra_b))[0][0] == 'pendente'


def test_sincronizar_fora_continua(cenario):
    c = cenario
    sincronizar(c, c.equipe_a, c.obra_a, 'membro')
    sincronizar(c, c.equipe_a, c.obra_a, 'fora')
    assert grupo(c, c.obra_a, c.equipe_a) is None and papel(c, c.obra_a, c.equipe_a) is None
