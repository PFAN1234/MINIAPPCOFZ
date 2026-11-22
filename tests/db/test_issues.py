"""Testes das issues da Central de modelos (migration 20261129090000_issues.sql).

Tabelas sem acesso direto, RPCs `admin_*_issue*` só para admin, importação BCF idempotente e a
pasta `issues` do R2 (pode_arquivo, limites, exclusão de obra). O banco é compartilhado na sessão:
cada teste usa obras e uuids próprios.
"""
import json
import uuid
from types import SimpleNamespace

import pytest

psycopg = pytest.importorskip('psycopg', reason='psycopg não instalado')

from conftest import sessao  # noqa: E402

MB = 1048576
u = uuid.uuid4


def sql(dsn, comando, params=(), papel='authenticated', usuario=None):
    with sessao(dsn, usuario, papel=papel) as cur:
        cur.execute(comando, params)
        return cur.fetchall() if cur.description else None


def su(dsn, comando, params=()):
    return sql(dsn, comando, params, papel=None)


@pytest.fixture
def c(dsn, cenario):
    """Cenário + dois admins. `part` participa da obra A (não é admin); `fora` não tem obra."""
    admins = []
    for nome in ('Admin Um', 'Admin Dois'):
        a = u()
        su(dsn, 'insert into auth.users (id, email) values (%s, %s)', (a, f'{a}@teste.invalid'))
        su(dsn, 'insert into public.usuario (id, telegram_id, nome) values (%s, %s, %s)',
           (a, u().int % 10**15, nome))
        su(dsn, 'insert into public.admin_app (usuario_id) values (%s)', (a,))
        admins.append(a)
    return SimpleNamespace(dsn=dsn, cen=cenario, admin=admins[0], admin2=admins[1], part=cenario.equipe_a,
                           fora=cenario.sem_obra, obra=str(cenario.obra_a), obra_b=str(cenario.obra_b))


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


def j(x):
    return json.dumps(x)


def salvar(c, **campos):
    campos.setdefault('obra_id', c.obra)
    campos.setdefault('titulo', 'Pilar fora de prumo')
    return rpc(c, c.admin, 'admin_salvar_issue', j(campos))


def listar(c, obra=None):
    return rpc(c, c.admin, 'admin_listar_issues', obra or c.obra)


def subir_imagem(c, obra, issue, vista):
    caminho = f'{obra}/{issue}/{vista}.png'
    su(c.dsn, "insert into public.arquivo (pasta, caminho, tamanho, tipo, situacao) "
              "values ('issues', %s, 10, 'image/png', 'confirmado') on conflict (pasta, caminho) "
              "do update set situacao = 'confirmado'", (caminho,))
    return caminho


# Acesso ---------------------------------------------------------------------------------------

def test_nao_admin_bloqueado_em_todas_as_rpcs(c):
    issue = salvar(c)['id']
    chamadas = [
        ('admin_listar_issues', (c.obra,)),
        ('admin_salvar_issue', (j({'obra_id': c.obra, 'titulo': 'x'}),)),
        ('admin_comentar_issue', (issue, 'oi', None)),
        ('admin_salvar_vista_issue', (issue, str(u()), j({}), None)),
        ('admin_importar_bcf', (c.obra, '[]')),
    ]
    for nome, args in chamadas:
        for quem in (c.part, c.fora):
            assert tenta(c, quem, nome, *args) == 'Apenas admins do Mini App podem fazer isto', (nome, quem)
        assert tenta(c, None, nome, *args) == 'Usuário não autenticado', nome
        with pytest.raises(psycopg.Error):
            sql(c.dsn, f'select public.{nome}({", ".join(["%s"] * len(args))})', args, papel='anon')


def test_tabelas_sem_acesso_direto(c):
    salvar(c)
    for tabela in ('issue', 'issue_vista', 'issue_comentario'):
        with pytest.raises(psycopg.Error):
            sql(c.dsn, f'select * from public.{tabela}', usuario=c.admin)


# Criar e atualizar ----------------------------------------------------------------------------

def test_numeracao_por_obra(c):
    assert salvar(c)['numero'] == 1
    assert salvar(c)['numero'] == 2
    assert salvar(c, obra_id=c.obra_b)['numero'] == 1
    assert salvar(c)['numero'] == 3
    lista = listar(c)
    assert [i['numero'] for i in lista] == [3, 2, 1]
    assert lista[0]['status'] == 'aberta' and lista[0]['tipo'] == 'problema' and lista[0]['prioridade'] == 'normal'
    assert lista[0]['criado_por'] == str(c.admin) and lista[0]['criado_por_nome'] == 'Admin Um'
    assert lista[0]['vistas'] == [] and lista[0]['comentarios'] == []


def test_atualizar_parcial(c):
    r = salvar(c, descricao='Desc', tipo='conflito', prazo='2026-12-31', responsavel_id=str(c.admin2))
    antes = listar(c)[0]
    r2 = rpc(c, c.admin, 'admin_salvar_issue', j({'id': r['id'], 'status': 'em_andamento', 'prioridade': 'alta'}))
    assert r2 == {'id': r['id'], 'numero': r['numero']}
    depois = listar(c)[0]
    assert depois['status'] == 'em_andamento' and depois['prioridade'] == 'alta'
    for k in ('titulo', 'descricao', 'tipo', 'prazo', 'responsavel_id', 'criado_em'):
        assert depois[k] == antes[k], k
    assert depois['responsavel_nome'] == 'Admin Dois'
    assert depois['atualizado_em'] > antes['atualizado_em']
    # chaves presentes com null limpam os campos opcionais
    rpc(c, c.admin, 'admin_salvar_issue', j({'id': r['id'], 'prazo': None, 'responsavel_id': None, 'descricao': None}))
    limpo = listar(c)[0]
    assert limpo['prazo'] is None and limpo['responsavel_id'] is None and limpo['descricao'] is None


def test_validacoes(c):
    ok = salvar(c)['id']
    assert 'título' in tenta(c, c.admin, 'admin_salvar_issue', j({'obra_id': c.obra}))
    assert 'título' in tenta(c, c.admin, 'admin_salvar_issue', j({'obra_id': c.obra, 'titulo': '  '}))
    assert 'título' in tenta(c, c.admin, 'admin_salvar_issue', j({'obra_id': c.obra, 'titulo': 'x' * 201}))
    assert 'título' in tenta(c, c.admin, 'admin_salvar_issue', j({'id': ok, 'titulo': ''}))
    assert salvar(c, titulo='x' * 200)['numero'] >= 2
    assert 'Tipo inválido' in tenta(c, c.admin, 'admin_salvar_issue', j({'obra_id': c.obra, 'titulo': 'a', 'tipo': 'x'}))
    assert 'Prioridade inválida' in tenta(c, c.admin, 'admin_salvar_issue', j({'id': ok, 'prioridade': 'urgente'}))
    assert 'Status inválido' in tenta(c, c.admin, 'admin_salvar_issue', j({'id': ok, 'status': 'feita'}))
    assert 'Prazo inválido' in tenta(c, c.admin, 'admin_salvar_issue', j({'id': ok, 'prazo': '31/12/2026'}))
    assert 'Obra inválida' in tenta(c, c.admin, 'admin_salvar_issue', j({'titulo': 'a'}))
    assert 'Obra não encontrada' in tenta(c, c.admin, 'admin_salvar_issue', j({'obra_id': str(u()), 'titulo': 'a'}))
    assert 'Issue não encontrada' in tenta(c, c.admin, 'admin_salvar_issue', j({'id': str(u()), 'titulo': 'a'}))


def test_responsavel_precisa_ser_admin(c):
    msg = tenta(c, c.admin, 'admin_salvar_issue', j({'obra_id': c.obra, 'titulo': 'a', 'responsavel_id': str(c.part)}))
    assert msg == 'O responsável precisa ser administrador do app'
    ok = salvar(c)['id']
    assert tenta(c, c.admin, 'admin_salvar_issue', j({'id': ok, 'responsavel_id': str(c.fora)})) == msg
    assert salvar(c, responsavel_id=str(c.admin2))['numero'] == 2


# Comentários e vistas -------------------------------------------------------------------------

def test_comentar(c):
    a, b = salvar(c)['id'], salvar(c)['id']
    vista_a = str(u())
    rpc(c, c.admin, 'admin_salvar_vista_issue', a, vista_a, j({'camera': 1}), None)
    antes = [i for i in listar(c) if i['id'] == a][0]
    cid = rpc(c, c.admin, 'admin_comentar_issue', a, ' Vi no local ', vista_a)
    com = rpc(c, c.admin2, 'admin_comentar_issue', a, 'Sem vista')
    assert cid and com
    depois = [i for i in listar(c) if i['id'] == a][0]
    assert depois['atualizado_em'] > antes['atualizado_em']
    cs = depois['comentarios']
    assert [x['texto'] for x in cs] == ['Vi no local', 'Sem vista']
    assert cs[0]['vista_id'] == vista_a and cs[0]['autor_nome'] == 'Admin Um' and cs[1]['vista_id'] is None
    assert cs[1]['autor_nome'] == 'Admin Dois'
    # vista de outra issue, texto vazio/longo e issue inexistente
    assert 'não pertence' in tenta(c, c.admin, 'admin_comentar_issue', b, 'x', vista_a)
    assert 'comentário' in tenta(c, c.admin, 'admin_comentar_issue', a, '  ', None)
    assert 'comentário' in tenta(c, c.admin, 'admin_comentar_issue', a, 'x' * 5001, None)
    assert 'Issue não encontrada' in tenta(c, c.admin, 'admin_comentar_issue', str(u()), 'x', None)


def test_salvar_vista(c):
    issue = salvar(c)['id']
    outra = salvar(c)['id']
    vid = str(u())
    cam = f'{c.obra}/{issue}/{vid}.png'
    # sem a imagem enviada: recusa; sem imagem: aceita
    assert 'não encontrada' in tenta(c, c.admin, 'admin_salvar_vista_issue', issue, vid, j({'a': 1}), cam)
    # caminho errado (outra issue, outra extensão, outra vista)
    subir_imagem(c, c.obra, outra, vid)
    for ruim in (f'{c.obra}/{outra}/{vid}.png', f'{c.obra}/{issue}/{vid}.jpg', f'{c.obra}/{issue}/{u()}.png',
                 f'{c.obra_b}/{issue}/{vid}.png'):
        assert 'Caminho da imagem inválido' in tenta(c, c.admin, 'admin_salvar_vista_issue', issue, vid, j({}), ruim)
    # arquivo pendente (não confirmado) também recusa
    su(c.dsn, "insert into public.arquivo (pasta, caminho, tamanho, tipo, situacao) "
              "values ('issues', %s, 10, 'image/png', 'pendente')", (cam,))
    assert 'não encontrada' in tenta(c, c.admin, 'admin_salvar_vista_issue', issue, vid, j({}), cam)
    subir_imagem(c, c.obra, issue, vid)
    assert rpc(c, c.admin, 'admin_salvar_vista_issue', issue, vid, j({'a': 1}), cam) == vid
    # idempotente: repetir e atualizar não duplica
    assert rpc(c, c.admin, 'admin_salvar_vista_issue', issue, vid, j({'a': 2}), cam) == vid
    assert rpc(c, c.admin, 'admin_salvar_vista_issue', issue, vid, j({'a': 3}), None) == vid
    vistas = [i for i in listar(c) if i['id'] == issue][0]['vistas']
    assert len(vistas) == 1 and vistas[0]['vista'] == {'a': 3} and vistas[0]['imagem_path'] == cam
    # a mesma vista não migra para outra issue
    assert 'outra issue' in tenta(c, c.admin, 'admin_salvar_vista_issue', outra, vid, j({}), None)
    assert 'Vista inválida' in tenta(c, c.admin, 'admin_salvar_vista_issue', issue, str(u()), '[]', None)


# Importação BCF -------------------------------------------------------------------------------

def topico(vista_id=None, caminho=None):
    vg, cg = str(u()), str(u())
    t = {'guid': str(u()), 'titulo': 'Conflito viga x duto', 'descricao': 'Detalhe', 'tipo': 'conflito',
         'prioridade': 'alta', 'status': 'em_andamento', 'prazo': '2026-12-01',
         'criado_em': '2026-01-02T10:00:00Z',
         'comentarios': [{'guid': cg, 'texto': 'Confirmado', 'criado_em': '2026-01-03T10:00:00Z', 'vista_guid': vg},
                         {'guid': str(u()), 'texto': 'Sem vista'}],
         'vistas': [{'guid': vg, 'vista': {'cam': [1, 2, 3]}, 'criado_em': '2026-01-02T11:00:00Z'}]}
    if vista_id:
        t['vistas'][0]['id'] = vista_id
        t['vistas'][0]['imagem_path'] = caminho
    return t


def test_importar_bcf_idempotente(c):
    salvar(c)  # número 1
    t1, t2 = topico(), topico()
    r = rpc(c, c.admin, 'admin_importar_bcf', c.obra, j([t1, t2]))
    assert r == {'criadas': 2, 'atualizadas': 0}
    assert rpc(c, c.admin, 'admin_importar_bcf', c.obra, j([t1, t2])) == {'criadas': 0, 'atualizadas': 2}
    lista = listar(c)
    assert [i['numero'] for i in lista] == [3, 2, 1]
    imp = [i for i in lista if i['guid'] == t1['guid']][0]
    assert imp['titulo'] == 'Conflito viga x duto' and imp['status'] == 'em_andamento' and imp['prazo'] == '2026-12-01'
    assert imp['criado_em'].startswith('2026-01-02')
    assert len(imp['vistas']) == 1 and len(imp['comentarios']) == 2
    com = imp['comentarios'][0]
    assert com['autor_id'] is None and com['vista_id'] == imp['vistas'][0]['id'] and com['texto'] == 'Confirmado'
    # reimportar com texto novo atualiza no lugar
    t1['titulo'] = 'Novo título'
    t1['comentarios'][0]['texto'] = 'Editado'
    assert rpc(c, c.admin, 'admin_importar_bcf', c.obra, j([t1]))['atualizadas'] == 1
    imp = [i for i in listar(c) if i['guid'] == t1['guid']][0]
    assert imp['titulo'] == 'Novo título' and imp['comentarios'][0]['texto'] == 'Editado'
    assert len(imp['comentarios']) == 2 and len(imp['vistas']) == 1


def test_importar_bcf_misturado_e_imagem(c):
    existente = topico()
    rpc(c, c.admin, 'admin_importar_bcf', c.obra, j([existente]))
    # a issue nova ainda não tem id: o cliente gera o id da vista e o caminho usa o id da issue.
    # Como o id da issue vem do banco, a imagem só casa se a vista já existe; testa com vista existente.
    issue = [i for i in listar(c) if i['guid'] == existente['guid']][0]
    vista = issue['vistas'][0]
    caminho = subir_imagem(c, c.obra, issue['id'], vista['id'])
    existente['vistas'][0]['imagem_path'] = caminho
    novo = topico()
    r = rpc(c, c.admin, 'admin_importar_bcf', c.obra, j([existente, novo]))
    assert r == {'criadas': 1, 'atualizadas': 1}
    issue = [i for i in listar(c) if i['guid'] == existente['guid']][0]
    assert issue['vistas'][0]['imagem_path'] == caminho
    # imagem não enviada ou com caminho errado: erro
    outro = topico()
    rpc(c, c.admin, 'admin_importar_bcf', c.obra, j([outro]))
    outro['vistas'][0]['imagem_path'] = f'{c.obra}/{issue["id"]}/{u()}.png'
    assert 'Caminho da imagem inválido' in tenta(c, c.admin, 'admin_importar_bcf', c.obra, j([outro]))


def test_importar_bcf_erros(c):
    t = topico()
    rpc(c, c.admin, 'admin_importar_bcf', c.obra, j([t]))
    assert 'outra obra' in tenta(c, c.admin, 'admin_importar_bcf', c.obra_b, j([t]))
    assert listar(c, c.obra_b) == []
    assert 'GUID' in tenta(c, c.admin, 'admin_importar_bcf', c.obra, j([{'titulo': 'x'}]))
    assert 'título' in tenta(c, c.admin, 'admin_importar_bcf', c.obra, j([{'guid': str(u())}]))
    assert 'Status inválido' in tenta(c, c.admin, 'admin_importar_bcf', c.obra, j([{**topico(), 'status': 'x'}]))
    assert 'Tópicos inválidos' in tenta(c, c.admin, 'admin_importar_bcf', c.obra, '{}')
    ruim = topico()
    ruim['comentarios'][0]['vista_guid'] = str(u())
    assert 'vista inexistente' in tenta(c, c.admin, 'admin_importar_bcf', c.obra, j([ruim]))
    assert 'Obra não encontrada' in tenta(c, c.admin, 'admin_importar_bcf', str(u()), '[]')
    # erro no meio desfaz tudo (uma transação por chamada)
    bom = topico()
    assert tenta(c, c.admin, 'admin_importar_bcf', c.obra, j([bom, {'guid': 'x'}])).startswith('GUID')
    assert not [i for i in listar(c) if i['guid'] == bom['guid']]


# Central de obras -----------------------------------------------------------------------------

def test_central_obras_conta_abertas(c):
    def linha():
        r = rpc(c, c.admin, 'admin_central_obras')
        return [o for o in r if o['obra_id'] == c.obra][0]
    assert linha()['issues_abertas'] == 0
    a, b, d = salvar(c)['id'], salvar(c)['id'], salvar(c)['id']
    rpc(c, c.admin, 'admin_salvar_issue', j({'id': b, 'status': 'em_andamento'}))
    rpc(c, c.admin, 'admin_salvar_issue', j({'id': d, 'status': 'resolvida'}))
    assert linha()['issues_abertas'] == 2
    rpc(c, c.admin, 'admin_salvar_issue', j({'id': a, 'status': 'fechada'}))
    assert linha()['issues_abertas'] == 1
    salvar(c, obra_id=c.obra_b)
    assert linha()['issues_abertas'] == 1
    assert linha()['atualizado_em'] is not None


# Pasta `issues` no R2 -------------------------------------------------------------------------

def pode(c, usuario, acao, caminho, pasta='issues'):
    return sql(c.dsn, 'select privado.pode_arquivo(%s, %s, %s)', (acao, pasta, caminho), usuario=usuario)[0][0]


def test_pode_arquivo_issues(c):
    cam = f'{c.obra}/{u()}/{u()}.png'
    assert pode(c, c.admin, 'ler', cam) and pode(c, c.admin, 'enviar', cam)
    for quem in (c.part, c.fora, None):
        assert not pode(c, quem, 'ler', cam) and not pode(c, quem, 'enviar', cam)
    assert not pode(c, c.admin, 'excluir', cam)
    for ruim in (f'{c.obra}/{u()}/{u()}.jpg', f'{c.obra}/{u()}.png', f'{c.obra}/{u()}/{u()}/{u()}.png',
                 f'{u()}/{u()}/{u()}.png', f'{c.obra}/x/{u()}.png', f'{c.obra}/{u()}/{"a" * 64}.pdf'):
        assert not pode(c, c.admin, 'enviar', ruim), ruim


def test_limites_issues(c):
    cam = f'{c.obra}/{u()}/{u()}.png'
    prep = lambda tam, tipo: tenta(c, c.admin, 'arquivo_preparar_envio', 'issues', cam, tam, tipo)  # noqa: E731
    assert prep(5 * MB, 'image/png') == 'enviar'
    assert prep(5 * MB + 1, 'image/png') == 'fora_do_limite'
    assert prep(10, 'image/jpeg') == 'fora_do_limite'
    assert tenta(c, c.part, 'arquivo_preparar_envio', 'issues', cam, 10, 'image/png') == 'sem_permissao'
    assert tenta(c, c.admin, 'arquivo_preparar_envio', 'issues', f'{c.obra}/x.png', 10, 'image/png') in (
        'sem_permissao', 'caminho_invalido')
    rpc(c, None, 'arquivo_registrar_servico', 'issues', cam, 10, 'image/png', papel='service_role')
    assert su(c.dsn, "select situacao from public.arquivo where pasta = 'issues' and caminho = %s", (cam,)) == [
        ('confirmado',)]


def test_exclusao_de_obra_cobre_issues(c):
    obra = u()
    su(c.dsn, 'insert into public.obra (id, slug, nome, etapa_id) values (%s, %s, %s, %s)',
       (obra, f'x-{obra.hex[:8]}', 'Obra X', c.cen.etapa))
    issue = rpc(c, c.admin, 'admin_salvar_issue', j({'obra_id': str(obra), 'titulo': 'a'}))['id']
    vid = str(u())
    cam = subir_imagem(c, str(obra), issue, vid)
    rpc(c, c.admin, 'admin_salvar_vista_issue', issue, vid, j({}), cam)
    rpc(c, c.admin, 'admin_comentar_issue', issue, 'x', vid)
    slug = su(c.dsn, 'select slug from public.obra where id = %s', (obra,))[0][0]
    rpc(c, c.admin, 'admin_excluir_obra', slug, 'Obra X')
    assert su(c.dsn, "select situacao from public.arquivo where pasta = 'issues' and caminho = %s", (cam,)) == [
        ('excluir',)]
    for tabela in ('issue', 'issue_vista', 'issue_comentario'):
        assert su(c.dsn, f'select count(*) from public.{tabela} where '
                         + ('obra_id' if tabela == 'issue' else 'issue_id') + ' = %s',
                  (obra if tabela == 'issue' else issue,))[0][0] == 0


def test_varredura_de_orfaos_respeita_imagem_de_issue(c):
    issue = salvar(c)['id']
    vid = str(u())
    cam = subir_imagem(c, c.obra, issue, vid)
    rpc(c, c.admin, 'admin_salvar_vista_issue', issue, vid, j({}), cam)
    solta = subir_imagem(c, c.obra, issue, str(u()))
    su(c.dsn, "update public.arquivo set criado_em = now() - interval '30 days' "
              "where pasta = 'issues' and caminho in (%s, %s)", (cam, solta))
    su(c.dsn, 'select privado.varrer_orfaos_storage()')
    orfaos = {r[0] for r in su(c.dsn, "select caminho from public.orfao_storage where bucket = 'issues' "
                                      "and removido_em is null")}
    assert solta in orfaos and cam not in orfaos
