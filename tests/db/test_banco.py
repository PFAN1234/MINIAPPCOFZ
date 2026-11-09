"""Testes das migrations da fase 2 (RLS, Storage e RPCs). Contrato: docs/esquema-fase2.md."""
import json
import threading
import uuid
from datetime import datetime, timedelta, timezone

import pytest

psycopg = pytest.importorskip('psycopg', reason='psycopg não instalado')
from psycopg import errors  # noqa: E402

from conftest import sessao  # noqa: E402

CONCLUIR = 'select * from public.concluir_registro(%s, %s, %s, %s, %s, %s::jsonb)'
ENCERRAR = 'select * from public.encerrar_pendencia(%s, %s, %s, %s::jsonb)'
AGORA = datetime.now(timezone.utc)


def concluir(c, usuario, amb, tipo='servico', legenda='Contrapiso concluído', fotos=None, rid=None,
             capturado_em=AGORA - timedelta(minutes=1), subir=True, obra=None):
    """Chama concluir_registro como `usuario`; devolve (id, linha). `fotos`: nº de fotos (padrão 1)."""
    rid = rid or uuid.uuid4()
    lista = [c.foto(obra or c.obra_a, rid, subir=subir) for _ in range(1 if fotos is None else fotos)]
    with sessao(c.dsn, usuario) as cur:
        cur.execute(CONCLUIR, (rid, amb, tipo, legenda, capturado_em, json.dumps(lista)))
        return rid, cur.fetchone()


def contar(dsn, tabela, **filtros):
    onde = ' and '.join(f'{k} = %s' for k in filtros) or 'true'
    with sessao(dsn, papel=None) as cur:
        cur.execute(f'select count(*) from public.{tabela} where {onde}', tuple(filtros.values()))
        return cur.fetchone()[0]


# --- Isolamento entre obras ---------------------------------------------------

def test_usuario_de_outra_obra_nao_le_nada_da_obra_alheia(cenario):
    c = cenario
    rid, _ = concluir(c, c.equipe_a, c.amb_a)
    # o dono vê
    with sessao(c.dsn, c.equipe_a) as cur:
        for tabela in ('obra', 'ambiente', 'registro', 'foto', 'publicacao_telegram', 'pavimento'):
            cur.execute(f'select count(*) from public.{tabela}')
            assert cur.fetchone()[0] >= 1, tabela
    # gestor da obra B não vê nada da obra A
    with sessao(c.dsn, c.gestor_b) as cur:
        cur.execute('select count(*) from public.obra where id = %s', (c.obra_a,))
        assert cur.fetchone()[0] == 0
        for tabela in ('ambiente', 'registro', 'foto', 'pavimento', 'publicacao_telegram', 'encerramento'):
            cur.execute(f'select count(*) from public.{tabela} where obra_id = %s', (c.obra_a,))
            assert cur.fetchone()[0] == 0, tabela
        cur.execute('select count(*) from public.registro where id = %s', (rid,))
        assert cur.fetchone()[0] == 0
    # quem não participa de obra alguma também não vê
    with sessao(c.dsn, c.sem_obra) as cur:
        cur.execute('select count(*) from public.registro')
        assert cur.fetchone()[0] == 0


def test_concluir_registro_em_obra_alheia_falha_com_42501(cenario):
    c = cenario
    with pytest.raises(errors.InsufficientPrivilege) as e:
        concluir(c, c.gestor_b, c.amb_a)
    assert e.value.sqlstate == '42501'
    assert contar(c.dsn, 'registro', obra_id=c.obra_a) == 0


def test_usuario_ve_apenas_quem_divide_obra(cenario):
    c = cenario
    with sessao(c.dsn, c.equipe_a) as cur:
        cur.execute('select id from public.usuario')
        ids = {r[0] for r in cur.fetchall()}
    assert ids == {c.equipe_a, c.gestor_a}


def test_participacao_visivel_a_propria_e_ao_gestor(cenario):
    c = cenario
    with sessao(c.dsn, c.equipe_a) as cur:
        cur.execute('select usuario_id from public.participacao')
        assert {r[0] for r in cur.fetchall()} == {c.equipe_a}
    with sessao(c.dsn, c.gestor_a) as cur:
        cur.execute('select usuario_id from public.participacao where obra_id = %s', (c.obra_a,))
        assert {r[0] for r in cur.fetchall()} == {c.gestor_a, c.equipe_a}


# --- anon e gravação direta ---------------------------------------------------

@pytest.mark.parametrize('tabela', ['obra', 'usuario', 'participacao', 'solicitacao_acesso', 'pavimento',
                                    'ambiente', 'registro', 'encerramento', 'foto', 'publicacao_telegram'])
def test_anon_nao_le_nenhuma_tabela(cenario, tabela):
    with pytest.raises(errors.InsufficientPrivilege):
        with sessao(cenario.dsn, papel='anon') as cur:
            cur.execute(f'select * from public.{tabela}')


def test_anon_nao_executa_rpcs(cenario):
    c = cenario
    with pytest.raises(errors.InsufficientPrivilege):
        with sessao(c.dsn, papel='anon') as cur:
            cur.execute(CONCLUIR, (uuid.uuid4(), c.amb_a, 'servico', 'x', AGORA, '[]'))


def test_escrita_direta_em_registro_e_negada(cenario):
    c = cenario
    rid, _ = concluir(c, c.equipe_a, c.amb_a)
    comandos = [
        ("insert into public.registro (id, obra_id, ambiente_id, tipo, legenda, autor_id, capturado_em) "
         "values (%s, %s, %s, 'servico', 'x', %s, now())", (uuid.uuid4(), c.obra_a, c.amb_a, c.equipe_a)),
        ("update public.registro set legenda = 'alterada' where id = %s", (rid,)),
        ('delete from public.registro where id = %s', (rid,)),
    ]
    for comando, params in comandos:
        with pytest.raises(errors.InsufficientPrivilege):
            with sessao(c.dsn, c.gestor_a) as cur:
                cur.execute(comando, params)
    assert contar(c.dsn, 'registro', id=rid) == 1


def test_chamada_sem_usuario_autenticado_falha_com_28000(cenario):
    c = cenario
    with pytest.raises(errors.Error) as e:
        with sessao(c.dsn) as cur:  # papel authenticated, sem claim sub
            cur.execute(CONCLUIR, (uuid.uuid4(), c.amb_a, 'servico', 'x', AGORA, '[]'))
    assert e.value.sqlstate == '28000'


# --- concluir_registro --------------------------------------------------------

def test_concluir_servico_feliz(cenario):
    c = cenario
    rid, linha = concluir(c, c.equipe_a, c.amb_a, tipo='servico', legenda='  Reboco pronto  ', fotos=2)
    assert linha[0] == rid
    with sessao(c.dsn, c.equipe_a) as cur:
        cur.execute('select obra_id, tipo, legenda, situacao, autor_id from public.registro where id = %s', (rid,))
        assert cur.fetchone() == (c.obra_a, 'servico', 'Reboco pronto', None, c.equipe_a)
        cur.execute('select storage_path, ordem, registro_id, encerramento_id from public.foto '
                    'where registro_id = %s order by ordem', (rid,))
        fotos = cur.fetchall()
        assert [f[1] for f in fotos] == [0, 1]
        assert all(f[0] == f'{c.obra_a}/{rid}/{f[0].split("/")[-1]}' and f[0].endswith('.jpg') for f in fotos)
        cur.execute('select estado, encerramento_id from public.publicacao_telegram where registro_id = %s', (rid,))
        assert cur.fetchall() == [('pendente', None)]


def test_concluir_pendencia_feliz(cenario):
    c = cenario
    rid, _ = concluir(c, c.equipe_a, c.amb_a, tipo='pendencia', legenda='Falta rejunte')
    with sessao(c.dsn, c.equipe_a) as cur:
        cur.execute('select tipo, situacao from public.registro where id = %s', (rid,))
        assert cur.fetchone() == ('pendencia', 'aberta')
    assert contar(c.dsn, 'foto', registro_id=rid) == 1
    assert contar(c.dsn, 'publicacao_telegram', registro_id=rid, estado='pendente') == 1


def test_concluir_repetido_nao_duplica(cenario):
    c = cenario
    rid = uuid.uuid4()
    fotos = [c.foto(c.obra_a, rid)]
    args = (rid, c.amb_a, 'servico', 'Piso assentado', AGORA, json.dumps(fotos))
    for _ in range(3):
        with sessao(c.dsn, c.equipe_a) as cur:
            cur.execute(CONCLUIR, args)
            assert cur.fetchone()[0] == rid
    assert contar(c.dsn, 'registro', id=rid) == 1
    assert contar(c.dsn, 'foto', registro_id=rid) == 1
    assert contar(c.dsn, 'publicacao_telegram', registro_id=rid) == 1


def test_mesmo_id_com_outro_ambiente_ou_outro_autor_da_23505(cenario):
    c = cenario
    rid, _ = concluir(c, c.equipe_a, c.amb_a)
    with pytest.raises(errors.UniqueViolation):
        concluir(c, c.equipe_a, c.amb_a2, rid=rid)
    with pytest.raises(errors.UniqueViolation):
        concluir(c, c.gestor_a, c.amb_a, rid=rid)
    assert contar(c.dsn, 'registro', id=rid) == 1
    assert contar(c.dsn, 'foto', registro_id=rid) == 1


def test_foto_sem_objeto_no_storage_falha_e_nada_e_gravado(cenario):
    c = cenario
    rid = uuid.uuid4()
    with pytest.raises(errors.Error) as e:
        concluir(c, c.equipe_a, c.amb_a, rid=rid, subir=False)
    assert e.value.sqlstate == 'P0002'
    for tabela in ('registro', 'publicacao_telegram'):
        assert contar(c.dsn, tabela, obra_id=c.obra_a) == 0
    assert contar(c.dsn, 'foto', registro_id=rid) == 0


def test_objeto_de_outro_registro_nao_serve_como_foto(cenario):
    """O caminho é derivado do id do registro: objeto em outra pasta não vale."""
    c = cenario
    rid = uuid.uuid4()
    foto = c.foto(c.obra_a, uuid.uuid4())  # objeto existe, mas sob outro registro
    with pytest.raises(errors.Error) as e:
        with sessao(c.dsn, c.equipe_a) as cur:
            cur.execute(CONCLUIR, (rid, c.amb_a, 'servico', 'x', AGORA, json.dumps([foto])))
    assert e.value.sqlstate == 'P0002'


@pytest.mark.parametrize('legenda', ['', '   ', '\n\t ', None, 'x' * 1001])
def test_legenda_invalida_da_22023(cenario, legenda):
    c = cenario
    with pytest.raises(errors.Error) as e:
        concluir(c, c.equipe_a, c.amb_a, legenda=legenda)
    assert e.value.sqlstate == '22023'
    assert contar(c.dsn, 'registro', obra_id=c.obra_a) == 0


@pytest.mark.parametrize('qtd', [0, 11])
def test_quantidade_de_fotos_invalida_da_22023(cenario, qtd):
    c = cenario
    with pytest.raises(errors.Error) as e:
        concluir(c, c.equipe_a, c.amb_a, fotos=qtd)
    assert e.value.sqlstate == '22023'
    assert contar(c.dsn, 'registro', obra_id=c.obra_a) == 0


def test_outras_validacoes_da_22023(cenario):
    c = cenario
    with pytest.raises(errors.Error) as e:
        concluir(c, c.equipe_a, c.amb_a, tipo='outro')
    assert e.value.sqlstate == '22023'
    with pytest.raises(errors.Error) as e:
        concluir(c, c.equipe_a, c.amb_a, capturado_em=AGORA + timedelta(hours=1))
    assert e.value.sqlstate == '22023'
    # fotos com id repetido e campos não numéricos
    rid = uuid.uuid4()
    f = c.foto(c.obra_a, rid)
    for lista in ([f, f], [{**f, 'largura': 0}], [{**f, 'bytes': '12'}], [{'id': 'nao-e-uuid'}], 'texto'):
        with pytest.raises(errors.Error) as e:
            with sessao(c.dsn, c.equipe_a) as cur:
                cur.execute(CONCLUIR, (rid, c.amb_a, 'servico', 'x', AGORA, json.dumps(lista)))
        assert e.value.sqlstate == '22023', lista
    assert contar(c.dsn, 'registro', obra_id=c.obra_a) == 0


def test_ambiente_inexistente_da_p0002(cenario):
    c = cenario
    with pytest.raises(errors.Error) as e:
        concluir(c, c.equipe_a, uuid.uuid4())
    assert e.value.sqlstate == 'P0002'


# --- encerrar_pendencia -------------------------------------------------------

def encerrar(c, usuario, rid_pend, eid=None, obs='Corrigido', fotos=1):
    eid = eid or uuid.uuid4()
    lista = [c.foto(c.obra_a, rid_pend) for _ in range(fotos)]
    with sessao(c.dsn, usuario) as cur:
        cur.execute(ENCERRAR, (eid, rid_pend, obs, json.dumps(lista)))
        return eid, cur.fetchone()


def test_encerrar_por_equipe_da_42501(cenario):
    c = cenario
    pend, _ = concluir(c, c.equipe_a, c.amb_a, tipo='pendencia')
    with pytest.raises(errors.InsufficientPrivilege):
        encerrar(c, c.equipe_a, pend)
    with pytest.raises(errors.InsufficientPrivilege):
        encerrar(c, c.gestor_b, pend)  # gestor de outra obra
    assert contar(c.dsn, 'encerramento', registro_id=pend) == 0


def test_encerrar_por_gestor_resolve(cenario):
    c = cenario
    pend, _ = concluir(c, c.equipe_a, c.amb_a, tipo='pendencia')
    eid, linha = encerrar(c, c.gestor_a, pend, obs='  Rejunte feito  ', fotos=2)
    assert linha[0] == eid
    with sessao(c.dsn, c.equipe_a) as cur:
        cur.execute('select situacao from public.registro where id = %s', (pend,))
        assert cur.fetchone() == ('resolvida',)
        cur.execute('select gestor_id, observacao, obra_id from public.encerramento where id = %s', (eid,))
        assert cur.fetchone() == (c.gestor_a, 'Rejunte feito', c.obra_a)
        cur.execute('select storage_path, ordem from public.foto where encerramento_id = %s order by ordem', (eid,))
        fotos = cur.fetchall()
        assert len(fotos) == 2 and [f[1] for f in fotos] == [0, 1]
        assert all(f[0].startswith(f'{c.obra_a}/{pend}/') for f in fotos)
        cur.execute('select estado from public.publicacao_telegram where encerramento_id = %s', (eid,))
        assert cur.fetchall() == [('pendente',)]


def test_encerrar_repetido_devolve_o_mesmo_e_outro_id_da_23505(cenario):
    c = cenario
    pend, _ = concluir(c, c.equipe_a, c.amb_a, tipo='pendencia')
    eid = uuid.uuid4()
    fotos = [c.foto(c.obra_a, pend)]
    for _ in range(2):
        with sessao(c.dsn, c.gestor_a) as cur:
            cur.execute(ENCERRAR, (eid, pend, 'ok', json.dumps(fotos)))
            assert cur.fetchone()[0] == eid
    assert contar(c.dsn, 'encerramento', registro_id=pend) == 1
    assert contar(c.dsn, 'foto', encerramento_id=eid) == 1
    assert contar(c.dsn, 'publicacao_telegram', encerramento_id=eid) == 1
    with pytest.raises(errors.UniqueViolation):
        encerrar(c, c.gestor_a, pend)
    assert contar(c.dsn, 'encerramento', registro_id=pend) == 1


def test_encerrar_registro_de_servico_da_22023(cenario):
    c = cenario
    serv, _ = concluir(c, c.equipe_a, c.amb_a, tipo='servico')
    with pytest.raises(errors.Error) as e:
        encerrar(c, c.gestor_a, serv)
    assert e.value.sqlstate == '22023'


def test_encerrar_validacoes(cenario):
    c = cenario
    pend, _ = concluir(c, c.equipe_a, c.amb_a, tipo='pendencia')
    with pytest.raises(errors.Error) as e:
        encerrar(c, c.gestor_a, pend, fotos=0)
    assert e.value.sqlstate == '22023'
    with pytest.raises(errors.Error) as e:
        encerrar(c, c.gestor_a, pend, obs='x' * 1001)
    assert e.value.sqlstate == '22023'
    with pytest.raises(errors.Error) as e:
        with sessao(c.dsn, c.gestor_a) as cur:
            cur.execute(ENCERRAR, (uuid.uuid4(), pend, None, json.dumps([c.foto(c.obra_a, pend, subir=False)])))
    assert e.value.sqlstate == 'P0002'
    with pytest.raises(errors.Error) as e:
        encerrar(c, c.gestor_a, uuid.uuid4())
    assert e.value.sqlstate == 'P0002'
    with sessao(c.dsn, c.equipe_a) as cur:
        cur.execute('select situacao from public.registro where id = %s', (pend,))
        assert cur.fetchone() == ('aberta',)


def test_encerrar_sem_observacao_e_permitido(cenario):
    c = cenario
    pend, _ = concluir(c, c.equipe_a, c.amb_a, tipo='pendencia')
    eid, _ = encerrar(c, c.gestor_a, pend, obs=None)
    with sessao(c.dsn, c.gestor_a) as cur:
        cur.execute('select observacao from public.encerramento where id = %s', (eid,))
        assert cur.fetchone() == (None,)


def test_encerrar_concorrente_so_um_vence(cenario):
    c = cenario
    pend, _ = concluir(c, c.equipe_a, c.amb_a, tipo='pendencia')
    ids = [uuid.uuid4(), uuid.uuid4()]
    fotos = [json.dumps([c.foto(c.obra_a, pend)]) for _ in ids]
    barreira = threading.Barrier(2)
    resultados = [None, None]

    def tarefa(i):
        try:
            with sessao(c.dsn, c.gestor_a) as cur:
                cur.execute('select 1')  # abre a transação antes de largar juntos
                barreira.wait(timeout=10)
                cur.execute(ENCERRAR, (ids[i], pend, 'ok', fotos[i]))
                resultados[i] = ('ok', cur.fetchone()[0])
        except psycopg.Error as e:
            resultados[i] = ('erro', e.sqlstate)

    ts = [threading.Thread(target=tarefa, args=(i,)) for i in range(2)]
    for t in ts:
        t.start()
    for t in ts:
        t.join(timeout=30)
    vencedores = [r for r in resultados if r and r[0] == 'ok']
    perdedores = [r for r in resultados if r and r[0] == 'erro']
    assert len(vencedores) == 1, resultados
    assert perdedores == [('erro', '23505')], resultados
    assert contar(c.dsn, 'encerramento', registro_id=pend) == 1
    with sessao(c.dsn, papel=None) as cur:
        cur.execute('select count(*) from public.foto where obra_id = %s and encerramento_id is not null',
                    (c.obra_a,))
        assert cur.fetchone()[0] == 1
    assert contar(c.dsn, 'publicacao_telegram', obra_id=c.obra_a) == 2  # a do registro + a do vencedor


def test_concluir_concorrente_com_mesmo_id_nao_duplica(cenario):
    c = cenario
    rid = uuid.uuid4()
    fotos = json.dumps([c.foto(c.obra_a, rid)])
    barreira = threading.Barrier(2)
    resultados = []

    def tarefa():
        try:
            with sessao(c.dsn, c.equipe_a) as cur:
                cur.execute('select 1')
                barreira.wait(timeout=10)
                cur.execute(CONCLUIR, (rid, c.amb_a, 'servico', 'x', AGORA, fotos))
                resultados.append(('ok', cur.fetchone()[0]))
        except psycopg.Error as e:
            resultados.append(('erro', e.sqlstate))

    ts = [threading.Thread(target=tarefa) for _ in range(2)]
    for t in ts:
        t.start()
    for t in ts:
        t.join(timeout=30)
    assert resultados == [('ok', rid), ('ok', rid)]
    assert contar(c.dsn, 'registro', id=rid) == 1
    assert contar(c.dsn, 'foto', registro_id=rid) == 1
    assert contar(c.dsn, 'publicacao_telegram', registro_id=rid) == 1


# --- Storage ------------------------------------------------------------------

def inserir_objeto(c, usuario, pasta, nome='a.jpg'):
    with sessao(c.dsn, usuario) as cur:
        cur.execute("insert into storage.objects (bucket_id, name, owner_id) values ('fotos', %s, %s)",
                    (f'{pasta}/{uuid.uuid4()}/{nome}', str(usuario)))


def test_bucket_fotos_privado_com_limite_e_mime(cenario):
    with sessao(cenario.dsn, papel=None) as cur:
        cur.execute("select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'fotos'")
        assert cur.fetchone() == (False, 10 * 1024 * 1024, ['image/jpeg'])


def test_storage_participante_insere_na_propria_obra(cenario):
    c = cenario
    inserir_objeto(c, c.equipe_a, c.obra_a)


@pytest.mark.parametrize('pasta', ['{outra}', 'nao-e-uuid', '', '{outra}x', '00000000-0000-0000-0000-000000000000'])
def test_storage_nao_insere_em_outra_obra_nem_pasta_invalida(cenario, pasta):
    c = cenario
    pasta = pasta.format(outra=c.obra_b)
    with pytest.raises(errors.InsufficientPrivilege) as e:  # negação por RLS, nunca erro de cast
        inserir_objeto(c, c.equipe_a, pasta)
    assert e.value.sqlstate == '42501'


def test_storage_objeto_sem_pasta_e_outro_bucket_negados(cenario):
    c = cenario
    with pytest.raises(errors.InsufficientPrivilege):
        with sessao(c.dsn, c.equipe_a) as cur:
            cur.execute("insert into storage.objects (bucket_id, name, owner_id) values ('fotos', 'solto.jpg', %s)",
                        (str(c.equipe_a),))
    with sessao(c.dsn, papel=None) as cur:
        cur.execute("insert into storage.buckets (id, name) values ('outro', 'outro')")
    with pytest.raises(errors.InsufficientPrivilege):
        with sessao(c.dsn, c.equipe_a) as cur:
            cur.execute("insert into storage.objects (bucket_id, name, owner_id) values ('outro', %s, %s)",
                        (f'{c.obra_a}/x/a.jpg', str(c.equipe_a)))


def test_storage_leitura_update_e_delete(cenario):
    c = cenario
    inserir_objeto(c, c.equipe_a, c.obra_a, 'meu.jpg')
    with sessao(c.dsn, papel=None) as cur:
        cur.execute("insert into storage.objects (bucket_id, name, owner_id) values ('fotos', %s, %s)",
                    (f'{c.obra_b}/x/b.jpg', str(c.gestor_b)))
    with sessao(c.dsn, c.equipe_a) as cur:
        cur.execute("select name from storage.objects where bucket_id = 'fotos' and name like %s", (f'{c.obra_a}/%',))
        assert len(cur.fetchall()) == 1
        cur.execute("select name from storage.objects where bucket_id = 'fotos' and name like %s", (f'{c.obra_b}/%',))
        assert cur.fetchall() == []
        # update do próprio objeto (reenvio) afeta 1 linha; o de outro dono, 0
        cur.execute("update storage.objects set owner_id = owner_id where name like %s", (f'{c.obra_a}/%',))
        assert cur.rowcount == 1
    with sessao(c.dsn, c.gestor_a) as cur:
        cur.execute("update storage.objects set owner_id = owner_id where name like %s", (f'{c.obra_a}/%',))
        assert cur.rowcount == 0  # participa, mas não é o dono
        cur.execute("delete from storage.objects where name like %s", (f'{c.obra_a}/%',))
        assert cur.rowcount == 0  # sem política de delete
    with pytest.raises(errors.InsufficientPrivilege):
        with sessao(c.dsn, papel='anon') as cur:
            cur.execute('select * from storage.objects')


def test_storage_foto_vinculada_nao_pode_ser_sobrescrita(cenario):
    c = cenario
    rid, fid = uuid.uuid4(), uuid.uuid4()
    nome = f'{c.obra_a}/{rid}/{fid}.jpg'
    with sessao(c.dsn, c.equipe_a) as cur:
        cur.execute("insert into storage.objects (bucket_id, name, owner_id) values ('fotos', %s, %s)",
                    (nome, str(c.equipe_a)))
    with sessao(c.dsn, c.equipe_a) as cur:  # antes de concluir: reenvio permitido
        cur.execute("update storage.objects set owner_id = owner_id where name = %s", (nome,))
        assert cur.rowcount == 1
    with sessao(c.dsn, c.equipe_a) as cur:
        cur.execute(CONCLUIR, (rid, c.amb_a, 'pendencia', 'Fissura na parede', AGORA - timedelta(minutes=1),
                               json.dumps([{'id': str(fid), 'largura': 800, 'altura': 600, 'bytes': 1}])))
    with sessao(c.dsn, c.equipe_a) as cur:  # depois: a evidência fica travada
        cur.execute("update storage.objects set owner_id = owner_id where name = %s", (nome,))
        assert cur.rowcount == 0


# --- solicitacao_acesso -------------------------------------------------------

def test_solicitacao_propria_pendente_e_aceita(cenario):
    c = cenario
    with sessao(c.dsn, c.sem_obra) as cur:
        cur.execute('insert into public.solicitacao_acesso (obra_id, usuario_id) values (%s, %s)',
                    (c.obra_a, c.sem_obra))
        cur.execute("select estado from public.solicitacao_acesso where usuario_id = %s", (c.sem_obra,))
        assert cur.fetchall() == [('pendente',)]
    with sessao(c.dsn, c.gestor_a) as cur:  # o gestor da obra enxerga
        cur.execute('select usuario_id from public.solicitacao_acesso where obra_id = %s', (c.obra_a,))
        assert cur.fetchall() == [(c.sem_obra,)]
    with sessao(c.dsn, c.gestor_b) as cur:  # outra obra não
        cur.execute('select count(*) from public.solicitacao_acesso where obra_id = %s', (c.obra_a,))
        assert cur.fetchone()[0] == 0


def test_solicitacao_em_nome_de_outro_ou_aprovada_e_negada(cenario):
    c = cenario
    with pytest.raises(errors.InsufficientPrivilege):
        with sessao(c.dsn, c.sem_obra) as cur:
            cur.execute('insert into public.solicitacao_acesso (obra_id, usuario_id) values (%s, %s)',
                        (c.obra_a, c.equipe_a))
    with pytest.raises(errors.InsufficientPrivilege):
        with sessao(c.dsn, c.sem_obra) as cur:
            cur.execute("insert into public.solicitacao_acesso (obra_id, usuario_id, estado) "
                        "values (%s, %s, 'aprovada')", (c.obra_a, c.sem_obra))
    with pytest.raises(errors.InsufficientPrivilege):
        with sessao(c.dsn, c.sem_obra) as cur:
            cur.execute("insert into public.solicitacao_acesso (obra_id, usuario_id, decidido_por) "
                        "values (%s, %s, %s)", (c.obra_a, c.sem_obra, c.gestor_a))
    assert contar(c.dsn, 'solicitacao_acesso', obra_id=c.obra_a) == 0


def test_solicitacao_pendente_duplicada_da_23505(cenario):
    c = cenario
    with sessao(c.dsn, c.sem_obra) as cur:
        cur.execute('insert into public.solicitacao_acesso (obra_id, usuario_id) values (%s, %s)',
                    (c.obra_a, c.sem_obra))
    with pytest.raises(errors.UniqueViolation):
        with sessao(c.dsn, c.sem_obra) as cur:
            cur.execute('insert into public.solicitacao_acesso (obra_id, usuario_id) values (%s, %s)',
                        (c.obra_a, c.sem_obra))
