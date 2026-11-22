"""Testes da tabela `arquivo` do R2: permissão por pasta, limites e RPCs (Parte 1a).

Contrato: docs/contrato-r2.md (migration 20261126080000_arquivo_r2.sql). O banco é
compartilhado na sessão: cada teste usa caminhos próprios (uuids novos).
"""
import json
import uuid
from types import SimpleNamespace

import pytest

psycopg = pytest.importorskip('psycopg', reason='psycopg não instalado')

from conftest import sessao  # noqa: E402

MB = 1048576
ANON = 'sem_sessao'


@pytest.fixture
def c(dsn, cenario):
    """Cenário + um admin. Usuários: admin, part (participa da obra A), fora (sem obra)."""
    adm = uuid.uuid4()
    su(dsn, 'insert into auth.users (id, email) values (%s, %s)', (adm, f'{adm}@teste.invalid'))
    su(dsn, 'insert into public.usuario (id, telegram_id, nome) values (%s, %s, %s)',
       (adm, uuid.uuid4().int % 10**15, 'Admin'))
    su(dsn, 'insert into public.admin_app (usuario_id) values (%s)', (adm,))
    return SimpleNamespace(dsn=dsn, cen=cenario, admin=adm, part=cenario.equipe_a, fora=cenario.sem_obra,
                           obra=str(cenario.obra_a), etapa=str(cenario.etapa))


def sql(dsn, comando, params=(), papel='authenticated', usuario=None):
    with sessao(dsn, usuario, papel=papel) as cur:
        cur.execute(comando, params)
        return cur.fetchall() if cur.description else None


def su(dsn, comando, params=()):
    return sql(dsn, comando, params, papel=None)


def rpc(c, usuario, nome, *args, papel='authenticated'):
    marcas = ', '.join(['%s'] * len(args))
    return sql(c.dsn, f'select public.{nome}({marcas})', args, papel=papel, usuario=usuario)[0][0]


def tenta(c, usuario, nome, *args, papel='authenticated'):
    """Resultado da RPC ou a mensagem do erro (código) levantado."""
    try:
        return rpc(c, usuario, nome, *args, papel=papel)
    except psycopg.Error as e:
        return e.diag.message_primary


def linha(c, pasta, caminho):
    r = su(c.dsn, 'select situacao, tamanho, tipo, autor from public.arquivo where pasta = %s and caminho = %s',
           (pasta, caminho))
    return r[0] if r else None


def servico(c, pasta, caminho, tamanho=10, tipo=None):
    tipos = {'fotos': 'image/jpeg', 'plantas': 'image/webp', 'originais': 'application/pdf',
             'modelos': 'application/octet-stream', 'boletins': 'application/pdf', 'relatorios': 'application/pdf',
             'organizacao': 'image/png', 'documentos': 'application/pdf'}
    rpc(c, None, 'arquivo_registrar_servico', pasta, caminho, tamanho, tipo or tipos[pasta], papel='service_role')


def caminhos(c):
    """(pasta -> (caminho, tipo)) válidos para cada pasta."""
    u = uuid.uuid4
    return {
        'fotos': (f'{c.obra}/{u()}/{u()}.jpg', 'image/jpeg'),
        'plantas': (f'{c.obra}/R01/terreo/{u().hex}.webp', 'image/webp'),
        'originais': (f'{c.obra}/R01/terreo/{u().hex * 2}.pdf', 'application/pdf'),
        'modelos': (f'{c.obra}/ARQ/{u().hex[:16]}.frag', 'application/octet-stream'),
        'boletins': (f'{c.etapa}/{u().hex}.pdf', 'application/pdf'),
        'relatorios': (f'{c.obra}/{u().hex}.pdf', 'application/pdf'),
        'organizacao': (f'logo-{u().hex[:16]}.png', 'image/png'),
        'documentos': (f'{c.obra}/{u()}/{u().hex * 2}.pdf', 'application/pdf'),
    }


# pasta: (admin, participante, não participante, sem sessão)
LER = {
    'fotos': (True, True, False, False), 'plantas': (True, True, False, False),
    'originais': (True, False, False, False), 'modelos': (True, True, False, False),
    'boletins': (True, True, False, False), 'relatorios': (False, False, False, False),
    'organizacao': (True, True, True, False), 'documentos': (True, False, False, False),
}
ENVIAR = {
    'fotos': (False, True, False, False), 'plantas': (True, False, False, False),
    'originais': (True, False, False, False), 'modelos': (True, False, False, False),
    'boletins': (False, False, False, False), 'relatorios': (False, False, False, False),
    'organizacao': (True, False, False, False), 'documentos': (True, False, False, False),
}


def quem(c):
    return (c.admin, c.part, c.fora, None)


@pytest.mark.parametrize('pasta', list(LER))
def test_matriz_ler(c, pasta):
    caminho, _ = caminhos(c)[pasta]
    servico(c, pasta, caminho)
    item = json.dumps([{'pasta': pasta, 'caminho': caminho}])
    for usuario, esperado in zip(quem(c), LER[pasta]):
        r = tenta(c, usuario, 'arquivo_pode_ler', item)
        if usuario is None:
            assert r == 'sem_sessao'
        else:
            assert (len(r) == 1) is esperado, (pasta, usuario)


@pytest.mark.parametrize('pasta', list(ENVIAR))
def test_matriz_enviar(c, pasta):
    caminho, tipo = caminhos(c)[pasta]
    for usuario, esperado in zip(quem(c), ENVIAR[pasta]):
        c2 = caminhos(c)[pasta]  # caminho novo a cada papel
        r = tenta(c, usuario, 'arquivo_preparar_envio', pasta, c2[0], 100, tipo)
        if usuario is None:
            assert r == 'sem_sessao'
        elif esperado:
            assert r == 'enviar', (pasta, usuario)
            assert linha(c, pasta, c2[0])[0] == 'pendente'
        else:
            assert r == 'sem_permissao', (pasta, usuario)
            assert linha(c, pasta, c2[0]) is None


@pytest.mark.parametrize('pasta', list(LER))
def test_matriz_excluir(c, pasta):
    caminho, _ = caminhos(c)[pasta]
    servico(c, pasta, caminho)
    for usuario in (c.part, c.fora, None):
        r = tenta(c, usuario, 'arquivo_marcar_exclusao', pasta, caminho)
        assert r == ('sem_sessao' if usuario is None else 'sem_permissao')
        assert linha(c, pasta, caminho)[0] == 'confirmado'
    r = tenta(c, c.admin, 'arquivo_marcar_exclusao', pasta, caminho)
    if pasta == 'organizacao':
        assert r in (None, '')
        assert linha(c, pasta, caminho)[0] == 'excluir'
    else:
        assert r == 'sem_permissao'
        assert linha(c, pasta, caminho)[0] == 'confirmado'


def test_ler_so_confirmados_e_limite_de_200(c):
    ok, _ = caminhos(c)['fotos']
    pend, tipo = caminhos(c)['fotos']
    servico(c, 'fotos', ok)
    assert rpc(c, c.part, 'arquivo_preparar_envio', 'fotos', pend, 10, tipo) == 'enviar'
    itens = json.dumps([{'pasta': 'fotos', 'caminho': ok}, {'pasta': 'fotos', 'caminho': pend},
                        {'pasta': 'fotos', 'caminho': f'{c.obra}/nao/existe.jpg'}])
    assert rpc(c, c.part, 'arquivo_pode_ler', itens) == [{'pasta': 'fotos', 'caminho': ok}]
    muitos = json.dumps([{'pasta': 'fotos', 'caminho': ok}] * 201)
    assert tenta(c, c.part, 'arquivo_pode_ler', muitos) == 'fora_do_limite'


def test_limites_de_tamanho_e_tipo(c):
    pasta = 'plantas'
    cam, tipo = caminhos(c)[pasta]
    assert tenta(c, c.admin, 'arquivo_preparar_envio', pasta, cam, 5 * MB + 1, tipo) == 'fora_do_limite'
    assert tenta(c, c.admin, 'arquivo_preparar_envio', pasta, cam, 100, 'image/png') == 'fora_do_limite'
    assert tenta(c, c.admin, 'arquivo_preparar_envio', pasta, cam, -1, tipo) == 'fora_do_limite'
    assert linha(c, pasta, cam) is None
    assert tenta(c, c.admin, 'arquivo_preparar_envio', pasta, cam, 5 * MB, tipo) == 'enviar'
    foto, tf = caminhos(c)['fotos']
    assert tenta(c, c.part, 'arquivo_preparar_envio', 'fotos', foto, 10 * MB + 1, tf) == 'fora_do_limite'
    org, to = caminhos(c)['organizacao']
    assert tenta(c, c.admin, 'arquivo_preparar_envio', 'organizacao', org, MB + 1, to) == 'fora_do_limite'
    assert tenta(c, c.admin, 'arquivo_preparar_envio', 'organizacao', org, MB, 'image/webp') == 'enviar'
    doc, td = caminhos(c)['documentos']
    assert tenta(c, c.admin, 'arquivo_preparar_envio', 'documentos', doc, 100 * MB, 'image/gif') == 'fora_do_limite'
    assert tenta(c, c.admin, 'arquivo_preparar_envio', 'documentos', doc, 100 * MB, 'image/vnd.dwg') == 'enviar'
    assert su(c.dsn, "select tamanho_max, tipos from privado.limite_pasta('relatorios')")[0][0] == 5 * 1024 * MB


@pytest.mark.parametrize('caminho', ['/abs/x.jpg', 'a/../b.jpg', '../x.jpg', 'a/..', '', 'x' * 301])
def test_caminho_invalido(c, caminho):
    assert tenta(c, c.admin, 'arquivo_preparar_envio', 'plantas', caminho, 10, 'image/webp') == 'caminho_invalido'
    assert tenta(c, c.admin, 'arquivo_preparar_envio', 'inexistente', 'x', 10, 'image/webp') == 'caminho_invalido'
    assert tenta(c, None, 'arquivo_registrar_servico', 'plantas', caminho, 10, 'image/webp',
                 papel='service_role') == 'caminho_invalido'


def test_caminho_fora_do_padrao_e_sem_permissao(c):
    assert tenta(c, c.part, 'arquivo_preparar_envio', 'fotos', f'{c.obra}/x/y.jpg', 10, 'image/jpeg') == 'sem_permissao'
    outra = str(uuid.uuid4())
    assert tenta(c, c.admin, 'arquivo_preparar_envio', 'plantas', f'{outra}/R01/a.webp', 10,
                 'image/webp') == 'sem_permissao'


def test_reenvio_de_confirmado_nao_volta_a_pendente(c):
    for pasta in ('originais', 'modelos', 'documentos', 'organizacao', 'plantas'):
        cam, tipo = caminhos(c)[pasta]
        assert rpc(c, c.admin, 'arquivo_preparar_envio', pasta, cam, 10, tipo) == 'enviar'
        assert rpc(c, None, 'arquivo_confirmar', pasta, cam, 10, tipo, c.admin, papel='service_role') == 'confirmado'
        assert rpc(c, c.admin, 'arquivo_preparar_envio', pasta, cam, 99, tipo) == 'ja_confirmado'
        assert linha(c, pasta, cam)[:2] == ('confirmado', 10)


def test_reenvio_de_foto(c):
    cam, tipo = caminhos(c)['fotos']
    outro = c.cen.gestor_a
    assert rpc(c, c.part, 'arquivo_preparar_envio', 'fotos', cam, 10, tipo) == 'enviar'
    # mesmo autor: ok, atualiza tamanho
    assert rpc(c, c.part, 'arquivo_preparar_envio', 'fotos', cam, 20, tipo) == 'enviar'
    assert linha(c, 'fotos', cam)[1] == 20
    # outro autor (também participante): sem permissão
    assert tenta(c, outro, 'arquivo_preparar_envio', 'fotos', cam, 30, tipo) == 'sem_permissao'
    # confirmada (ainda não registrada): ja_confirmado, sem voltar a pendente
    assert rpc(c, None, 'arquivo_confirmar', 'fotos', cam, 20, tipo, c.part, papel='service_role') == 'confirmado'
    assert rpc(c, c.part, 'arquivo_preparar_envio', 'fotos', cam, 25, tipo) == 'ja_confirmado'
    assert linha(c, 'fotos', cam)[:2] == ('confirmado', 20)
    # outro autor continua sem permissão
    assert tenta(c, outro, 'arquivo_preparar_envio', 'fotos', cam, 25, tipo) == 'sem_permissao'
    # registrada: ja_confirmado
    reg = cam.split('/')[1]
    foto_id = cam.split('/')[2][:-4]
    su(c.dsn, 'insert into public.registro (id, obra_id, ambiente_id, tipo, legenda, autor_id, capturado_em) '
              "values (%s, %s, %s, 'servico', 'x', %s, now())", (reg, c.obra, c.cen.amb_a, c.part))
    su(c.dsn, 'insert into public.foto (id, obra_id, registro_id, storage_path, largura, altura, bytes, ordem) '
              'values (%s, %s, %s, %s, 1, 1, 1, 0)', (foto_id, c.obra, reg, cam))
    assert rpc(c, c.part, 'arquivo_preparar_envio', 'fotos', cam, 25, tipo) == 'ja_confirmado'
    assert rpc(c, outro, 'arquivo_preparar_envio', 'fotos', cam, 25, tipo) == 'ja_confirmado'
    assert tenta(c, c.fora, 'arquivo_preparar_envio', 'fotos', cam, 25, tipo) == 'sem_permissao'


def test_confirmar(c):
    cam, tipo = caminhos(c)['fotos']
    conf = lambda *a: rpc(c, None, 'arquivo_confirmar', 'fotos', cam, *a, papel='service_role')  # noqa: E731
    assert conf(10, tipo, c.part) == 'nao_encontrado'
    rpc(c, c.part, 'arquivo_preparar_envio', 'fotos', cam, 10, tipo)
    assert conf(10, tipo, c.cen.gestor_a) == 'nao_encontrado'  # outro autor
    assert conf(11, tipo, c.part) == 'divergente'
    assert conf(10, 'image/png', c.part) == 'divergente'
    assert linha(c, 'fotos', cam)[0] == 'pendente'
    assert conf(10, tipo, c.part) == 'confirmado'
    assert su(c.dsn, 'select confirmado_em is not null from public.arquivo where caminho = %s', (cam,))[0][0]
    assert conf(10, tipo, c.part) == 'nao_encontrado'  # já não está pendente
    cam2, _ = caminhos(c)['fotos']
    rpc(c, c.part, 'arquivo_preparar_envio', 'fotos', cam2, 10, tipo)
    assert rpc(c, None, 'arquivo_confirmar', 'fotos', cam2, 10, tipo, None, papel='service_role') == 'confirmado'


def test_limite_de_300_pendentes(c):
    u = uuid.uuid4()
    su(c.dsn, 'insert into auth.users (id, email) values (%s, %s)', (u, f'{u}@teste.invalid'))
    su(c.dsn, 'insert into public.usuario (id, telegram_id, nome) values (%s, %s, %s)',
       (u, uuid.uuid4().int % 10**15, 'Fulano'))
    su(c.dsn, "insert into public.participacao (obra_id, usuario_id, papel) values (%s, %s, 'equipe')", (c.obra, u))
    su(c.dsn, "insert into public.arquivo (pasta, caminho, tamanho, tipo, autor) "
              "select 'fotos', %s || '/' || gen_random_uuid() || '/' || gen_random_uuid() || '.jpg', 1, "
              "'image/jpeg', %s from generate_series(1, 300)", (c.obra, u))
    cam, tipo = caminhos(c)['fotos']
    assert tenta(c, u, 'arquivo_preparar_envio', 'fotos', cam, 10, tipo) == 'fora_do_limite'
    # reenviar um já pendente não conta como novo
    pend = su(c.dsn, 'select caminho from public.arquivo where autor = %s limit 1', (u,))[0][0]
    assert rpc(c, u, 'arquivo_preparar_envio', 'fotos', pend, 10, tipo) == 'enviar'


def test_em_exclusao(c):
    cam, tipo = caminhos(c)['organizacao']
    servico(c, 'organizacao', cam)
    rpc(c, c.admin, 'arquivo_marcar_exclusao', 'organizacao', cam)
    assert tenta(c, c.admin, 'arquivo_preparar_envio', 'organizacao', cam, 10, tipo) == 'em_exclusao'
    item = json.dumps([{'pasta': 'organizacao', 'caminho': cam}])
    assert rpc(c, c.part, 'arquivo_pode_ler', item) == []


def test_fila_de_manutencao(c):
    tag = uuid.uuid4().hex
    base = 'insert into public.arquivo (pasta, caminho, tamanho, tipo, situacao, atualizado_em) '
    for nome, situacao, idade in (('velho-pend', 'pendente', 8), ('novo-pend', 'pendente', 1),
                                  ('velho-conf', 'confirmado', 30), ('exc', 'excluir', 0)):
        su(c.dsn, base + "values ('relatorios', %s, 1, 'application/pdf', %s, now() - make_interval(days => %s))",
           (f'{tag}/{nome}.pdf', situacao, idade))
    fila = sql(c.dsn, 'select caminho from public.arquivo_fila_manutencao(10000)', papel='service_role')
    assert {r[0] for r in fila if r[0].startswith(tag)} == {f'{tag}/velho-pend.pdf', f'{tag}/exc.pdf'}
    assert len(sql(c.dsn, 'select * from public.arquivo_fila_manutencao(1)', papel='service_role')) == 1
    ids = [r[0] for r in su(c.dsn, 'select id from public.arquivo where caminho like %s', (tag + '/%',))]
    rpc(c, None, 'arquivo_remover', ids, papel='service_role')
    assert su(c.dsn, 'select count(*) from public.arquivo where caminho like %s', (tag + '/%',))[0][0] == 0


def test_marcar_exclusao_prefixo(c):
    obra = str(uuid.uuid4())
    outra = str(uuid.uuid4())
    for pasta, cam in (('relatorios', f'{obra}/a.pdf'), ('boletins', f'{obra}/b.pdf'),
                       ('relatorios', f'{outra}/a.pdf'), ('documentos', f'{obra}/d.pdf')):
        servico(c, pasta, cam)
    n = rpc(c, None, 'arquivo_marcar_exclusao_prefixo', ['relatorios', 'boletins'], obra + '/', papel='service_role')
    assert n == 2
    assert linha(c, 'relatorios', f'{obra}/a.pdf')[0] == 'excluir'
    assert linha(c, 'boletins', f'{obra}/b.pdf')[0] == 'excluir'
    assert linha(c, 'relatorios', f'{outra}/a.pdf')[0] == 'confirmado'
    assert linha(c, 'documentos', f'{obra}/d.pdf')[0] == 'confirmado'
    # idempotente
    assert rpc(c, None, 'arquivo_marcar_exclusao_prefixo', ['relatorios', 'boletins'], obra + '/',
               papel='service_role') == 0


def test_sem_registro(c):
    tag = uuid.uuid4().hex
    servico(c, 'relatorios', f'{tag}/a.pdf')
    r = rpc(c, None, 'arquivo_sem_registro', [f'relatorios/{tag}/a.pdf', f'relatorios/{tag}/b.pdf',
                                                f'boletins/{tag}/a.pdf'], papel='service_role')
    assert r == [f'boletins/{tag}/a.pdf', f'relatorios/{tag}/b.pdf']


def test_registrar_servico_sobrescreve_e_limita(c):
    cam, tipo = caminhos(c)['plantas']
    servico(c, 'plantas', cam, 10)
    servico(c, 'plantas', cam, 20)
    assert linha(c, 'plantas', cam) == ('confirmado', 20, 'image/webp', None)
    assert tenta(c, None, 'arquivo_registrar_servico', 'plantas', cam, 6 * MB, tipo,
                 papel='service_role') == 'fora_do_limite'


@pytest.mark.parametrize('chamada', [
    ('arquivo_confirmar', ('fotos', 'x', 1, 'image/jpeg', None)),
    ('arquivo_registrar_servico', ('fotos', 'x', 1, 'image/jpeg')),
    ('arquivo_fila_manutencao', (10,)),
    ('arquivo_remover', ([1],)),
    ('arquivo_marcar_exclusao_prefixo', (['fotos'], 'x/')),
    ('arquivo_sem_registro', (['fotos/x'],)),
])
def test_rpcs_de_servico_negadas(c, chamada):
    nome, args = chamada
    marcas = ', '.join(['%s'] * len(args))
    for papel, usuario in (('authenticated', c.admin), ('anon', None)):
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            sql(c.dsn, f'select * from public.{nome}({marcas})', args, papel=papel, usuario=usuario)


def test_rpcs_de_usuario_negadas_a_anon_e_tabela_so_admin_le(c):
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        sql(c.dsn, "select public.arquivo_preparar_envio('fotos', 'x', 1, 'image/jpeg')", papel='anon')
    cam, _ = caminhos(c)['relatorios']
    servico(c, 'relatorios', cam)
    q = 'select count(*) from public.arquivo where caminho = %s'
    assert sql(c.dsn, q, (cam,), usuario=c.admin)[0][0] == 1
    assert sql(c.dsn, q, (cam,), usuario=c.part)[0][0] == 0
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        sql(c.dsn, "insert into public.arquivo (pasta, caminho, tamanho, tipo) values ('fotos', 'x', 1, 'y')",
            usuario=c.admin)
