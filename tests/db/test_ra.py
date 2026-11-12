"""Testes da migration da realidade aumentada (RA). Contrato: docs/contrato-ra.md."""
import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest

psycopg = pytest.importorskip('psycopg', reason='psycopg não instalado')
from psycopg import errors  # noqa: E402

from conftest import sessao  # noqa: E402

CONCLUIR = 'select * from public.concluir_registro(%s, %s, %s, %s, %s, %s::jsonb)'
AGORA = datetime.now(timezone.utc)
CONTORNO = [[0, 0], [4, 0], [4, 3], [0, 3]]  # paredes: 4 m, 3 m, 4 m, 3 m
RA = {'par': str(uuid.uuid4()), 'modelos': [{'sigla': 'ELT', 'revisao': 'R01', 'hash': 'abc'}],
      'alinhamento': 'qr', 'pose': {'posicao': [1, 1.6, 2], 'rumo': 0.5, 'fov': 60.0}}


@pytest.fixture(autouse=True)
def admins_limpos(dsn):
    with sessao(dsn, papel=None) as cur:
        cur.execute('delete from public.admin_app')


def tornar_admin(c, *usuarios):
    with sessao(c.dsn, papel=None) as cur:
        for u in usuarios:
            cur.execute('insert into public.admin_app (usuario_id) values (%s) on conflict do nothing', (u,))


def geometria(c, ambiente, contorno=CONTORNO):
    with sessao(c.dsn, papel=None) as cur:
        cur.execute('insert into public.ambiente_geometria (ambiente_id, contorno, y_piso, y_teto) '
                    'values (%s, %s::jsonb, 0, 2.7) on conflict (ambiente_id) do update '
                    'set contorno = excluded.contorno', (ambiente, json.dumps(contorno)))


def qr_direto(c, ambiente):
    with sessao(c.dsn, papel=None) as cur:
        cur.execute('insert into public.ambiente_qr (ambiente_id, parede, distancia_m) values (%s, 0, 1)',
                    (ambiente,))


def referencial(c, obra):
    with sessao(c.dsn, papel=None) as cur:
        cur.execute('insert into public.ra_referencial (obra_id, coordenadas) values (%s, %s::jsonb)',
                    (obra, json.dumps([201.8, -1.19, -327.1, 1, 0, 0, 0, 1, 0])))


def definir_qr(c, usuario, ambiente, parede=0, dist=1.0, altura=1.5, lado=0.18):
    with sessao(c.dsn, usuario) as cur:
        cur.execute('select public.admin_definir_qr(%s, %s, %s, %s, %s)', (ambiente, parede, dist, altura, lado))
        return cur.fetchone()[0]


def concluir(c, usuario, fotos_extra, rid=None):
    """Chama concluir_registro com uma foto por item de `fotos_extra` (campos extras de cada foto)."""
    rid = rid or uuid.uuid4()
    lista = [c.foto(c.obra_a, rid, **extra) for extra in fotos_extra]
    with sessao(c.dsn, usuario) as cur:
        cur.execute(CONCLUIR, (rid, c.amb_a, 'servico', 'Teste RA', AGORA - timedelta(minutes=1),
                               json.dumps(lista)))
        return rid, lista


def fotos_do_registro(c, rid):
    with sessao(c.dsn, papel=None) as cur:
        cur.execute('select id, origem, ra from public.foto where registro_id = %s order by ordem', (rid,))
        return cur.fetchall()


# --- RLS ----------------------------------------------------------------------

def preparar_leitura(c):
    geometria(c, c.amb_a)
    geometria(c, c.amb_b)
    qr_direto(c, c.amb_a)
    qr_direto(c, c.amb_b)
    referencial(c, c.obra_a)
    referencial(c, c.obra_b)


@pytest.mark.parametrize('tabela', ['ra_referencial', 'ambiente_geometria', 'ambiente_qr'])
def test_participante_le_so_a_propria_obra(cenario, tabela):
    c = cenario
    preparar_leitura(c)
    with sessao(c.dsn, c.equipe_a) as cur:
        cur.execute(f'select count(*) from public.{tabela}')
        assert cur.fetchone()[0] == 1
    with sessao(c.dsn, c.gestor_b) as cur:
        cur.execute(f'select count(*) from public.{tabela}')
        assert cur.fetchone()[0] == 1


@pytest.mark.parametrize('tabela', ['ra_referencial', 'ambiente_geometria', 'ambiente_qr'])
def test_sem_obra_nao_le(cenario, tabela):
    c = cenario
    preparar_leitura(c)
    with sessao(c.dsn, c.sem_obra) as cur:
        cur.execute(f'select count(*) from public.{tabela}')
        assert cur.fetchone()[0] == 0


@pytest.mark.parametrize('tabela', ['ra_referencial', 'ambiente_geometria', 'ambiente_qr'])
def test_anon_nao_le(cenario, tabela):
    with pytest.raises(errors.InsufficientPrivilege):
        with sessao(cenario.dsn, papel='anon') as cur:
            cur.execute(f'select * from public.{tabela}')


def test_admin_le_tudo(cenario):
    c = cenario
    preparar_leitura(c)
    tornar_admin(c, c.sem_obra)
    with sessao(c.dsn, c.sem_obra) as cur:
        cur.execute('select count(*) from public.ambiente_geometria where ambiente_id in (%s, %s)',
                    (c.amb_a, c.amb_b))
        assert cur.fetchone()[0] == 2


def test_cliente_nao_escreve(cenario):
    c = cenario
    geometria(c, c.amb_a)
    qr_direto(c, c.amb_a)
    comandos = [
        ('insert into public.ambiente_geometria (ambiente_id, contorno, y_piso, y_teto) '
         "values (%s, '[[0,0],[1,0],[1,1]]', 0, 2)", (c.amb_a2,)),
        ('update public.ambiente_geometria set y_teto = 9 where ambiente_id = %s', (c.amb_a,)),
        ("insert into public.ambiente_qr (ambiente_id, parede, distancia_m) values (%s, 0, 1)", (c.amb_a2,)),
        ('update public.ambiente_qr set parede = 1 where ambiente_id = %s', (c.amb_a,)),
        ('delete from public.ambiente_qr where ambiente_id = %s', (c.amb_a,)),
        ('insert into public.ra_referencial (obra_id, coordenadas) values (%s, %s::jsonb)',
         (c.obra_a, json.dumps([0] * 9))),
    ]
    for comando, params in comandos:
        with pytest.raises(errors.InsufficientPrivilege):
            with sessao(c.dsn, c.gestor_a) as cur:
                cur.execute(comando, params)


# --- concluir_registro --------------------------------------------------------

def test_concluir_sem_campos_novos_vale_normal(cenario):
    c = cenario
    rid, _ = concluir(c, c.equipe_a, [{}])
    [(_, origem, ra)] = fotos_do_registro(c, rid)
    assert origem == 'normal' and ra is None


def test_concluir_grava_origem_e_ra(cenario):
    c = cenario
    rid, lista = concluir(c, c.equipe_a, [
        {'origem': 'ra_limpa', 'ra': RA}, {'origem': 'ra_modelo', 'ra': RA}, {'origem': 'ra_modelo'}, {},
    ])
    linhas = fotos_do_registro(c, rid)
    assert [(str(i), o) for i, o, _ in linhas] == [
        (lista[0]['id'], 'ra_limpa'), (lista[1]['id'], 'ra_modelo'), (lista[2]['id'], 'ra_modelo'),
        (lista[3]['id'], 'normal')]
    assert linhas[0][2] == RA and linhas[1][2] == RA and linhas[2][2] is None and linhas[3][2] is None


@pytest.mark.parametrize('extra', [
    {'origem': 'panoramica'},
    {'origem': 7},
    {'ra': RA},
    {'origem': 'normal', 'ra': RA},
    {'origem': 'ra_limpa', 'ra': [1, 2]},
])
def test_concluir_recusa_origem_ou_ra_invalidos(cenario, extra):
    c = cenario
    rid = uuid.uuid4()
    with pytest.raises(errors.InvalidParameterValue):
        concluir(c, c.equipe_a, [extra], rid=rid)
    with sessao(c.dsn, papel=None) as cur:
        cur.execute('select count(*) from public.registro where id = %s', (rid,))
        assert cur.fetchone()[0] == 0


def test_concluir_repetido_nao_duplica(cenario):
    c = cenario
    rid = uuid.uuid4()
    lista = [c.foto(c.obra_a, rid, origem='ra_limpa', ra=RA)]
    for _ in range(2):
        with sessao(c.dsn, c.equipe_a) as cur:
            cur.execute(CONCLUIR, (rid, c.amb_a, 'servico', 'x', AGORA - timedelta(minutes=1),
                                   json.dumps(lista)))
    assert len(fotos_do_registro(c, rid)) == 1


# --- RPCs de admin ------------------------------------------------------------

def test_definir_qr_grava_e_atualiza(cenario):
    c = cenario
    geometria(c, c.amb_a)
    tornar_admin(c, c.sem_obra)
    r = definir_qr(c, c.sem_obra, c.amb_a, parede=0, dist=1.0)
    assert r['parede'] == 0 and r['altura_m'] == 1.5 and r['lado_m'] == 0.18
    definir_qr(c, c.sem_obra, c.amb_a, parede=1, dist=2.5, altura=1.2, lado=0.25)
    with sessao(c.dsn, papel=None) as cur:
        cur.execute('select parede, distancia_m, altura_m, lado_m, atualizado_por from public.ambiente_qr '
                    'where ambiente_id = %s', (c.amb_a,))
        assert cur.fetchall() == [(1, 2.5, 1.2, 0.25, c.sem_obra)]


def test_definir_qr_recusa_nao_admin(cenario):
    c = cenario
    geometria(c, c.amb_a)
    with pytest.raises(errors.InsufficientPrivilege):
        definir_qr(c, c.gestor_a, c.amb_a)
    with pytest.raises(errors.InsufficientPrivilege):
        with sessao(c.dsn, c.gestor_a) as cur:
            cur.execute('select public.admin_remover_qr(%s)', (c.amb_a,))
    with pytest.raises(errors.InsufficientPrivilege):
        with sessao(c.dsn, papel='anon') as cur:
            cur.execute('select public.admin_definir_qr(%s, 0, 1, 1.5, 0.18)', (c.amb_a,))


@pytest.mark.parametrize('parede, dist, altura, lado', [
    (4, 1.0, 1.5, 0.18),    # parede fora do contorno (4 pontos: 0 a 3)
    (-1, 1.0, 1.5, 0.18),
    (0, 4.01, 1.5, 0.18),   # parede 0 mede 4 m
    (1, 3.5, 1.5, 0.18),    # parede 1 mede 3 m
    (3, 3.01, 1.5, 0.18),   # a última parede fecha no ponto 0
    (0, -0.1, 1.5, 0.18),
    (0, 1.0, 5.5, 0.18),
    (0, 1.0, 1.5, 0.01),
])
def test_definir_qr_recusa_valores_fora_da_geometria(cenario, parede, dist, altura, lado):
    c = cenario
    geometria(c, c.amb_a)
    tornar_admin(c, c.sem_obra)
    with pytest.raises(errors.InvalidParameterValue):
        definir_qr(c, c.sem_obra, c.amb_a, parede, dist, altura, lado)


def test_definir_qr_aceita_a_ultima_parede_inteira(cenario):
    c = cenario
    geometria(c, c.amb_a)
    tornar_admin(c, c.sem_obra)
    assert definir_qr(c, c.sem_obra, c.amb_a, parede=3, dist=3.0)['parede'] == 3


def test_definir_qr_sem_geometria_e_ambiente_inexistente(cenario):
    c = cenario
    tornar_admin(c, c.sem_obra)
    with pytest.raises(errors.InvalidParameterValue):
        definir_qr(c, c.sem_obra, c.amb_a)
    with pytest.raises(errors.NoDataFound):
        definir_qr(c, c.sem_obra, uuid.uuid4())


def test_remover_qr(cenario):
    c = cenario
    geometria(c, c.amb_a)
    tornar_admin(c, c.sem_obra)
    definir_qr(c, c.sem_obra, c.amb_a)
    with sessao(c.dsn, c.sem_obra) as cur:
        cur.execute('select public.admin_remover_qr(%s)', (c.amb_a,))
        assert cur.fetchone()[0] is True
        cur.execute('select public.admin_remover_qr(%s)', (c.amb_a,))
        assert cur.fetchone()[0] is False
        cur.execute('select count(*) from public.ambiente_qr where ambiente_id = %s', (c.amb_a,))
        assert cur.fetchone()[0] == 0


def test_listar_ra_traz_geometria_e_qr(cenario):
    c = cenario
    geometria(c, c.amb_a)
    geometria(c, c.amb_a2)
    tornar_admin(c, c.sem_obra)
    definir_qr(c, c.sem_obra, c.amb_a, parede=2, dist=1.5)
    with sessao(c.dsn, c.sem_obra) as cur:
        cur.execute('select public.admin_listar_ra(%s)', (c.obra_a,))
        lista = cur.fetchone()[0]
    assert [a['codigo'] for a in lista] == ['amb0', 'amb1']
    a = lista[0]
    assert a['ambiente_id'] == str(c.amb_a) and a['nome'] == 'Ambiente 0' and a['pavimento'] == 'Térreo'
    assert a['contorno'] == CONTORNO and a['y_piso'] == 0 and a['y_teto'] == 2.7
    assert a['qr'] == {'parede': 2, 'distancia_m': 1.5, 'altura_m': 1.5, 'lado_m': 0.18}
    assert lista[1]['qr'] is None


def test_listar_ra_ignora_sem_geometria_e_inativos_e_exige_admin(cenario):
    c = cenario
    geometria(c, c.amb_a)
    geometria(c, c.amb_a2)
    with sessao(c.dsn, papel=None) as cur:
        cur.execute('update public.ambiente set ativo = false where id = %s', (c.amb_a2,))
    with pytest.raises(errors.InsufficientPrivilege):
        with sessao(c.dsn, c.gestor_a) as cur:
            cur.execute('select public.admin_listar_ra(%s)', (c.obra_a,))
    tornar_admin(c, c.sem_obra)
    with sessao(c.dsn, c.sem_obra) as cur:
        cur.execute('select public.admin_listar_ra(%s)', (c.obra_a,))
        assert [a['codigo'] for a in cur.fetchone()[0]] == ['amb0']
        cur.execute('select public.admin_listar_ra(%s)', (c.obra_b,))
        assert cur.fetchone()[0] == []


# --- checks -------------------------------------------------------------------

def inserir(c, comando, params=()):
    with sessao(c.dsn, papel=None) as cur:
        cur.execute(comando, params)


@pytest.mark.parametrize('matriz, ok', [
    (None, True), ([1] * 16, True), ([1] * 15, False), ([1] * 17, False), ({'a': 1}, False), ('x', False),
])
def test_check_matriz(cenario, matriz, ok):
    c = cenario
    cmd = ('insert into public.modelo (obra_id, sigla, caminho, bytes, hash, matriz) '
           "values (%s, 'ELT', 'x', 1, 'h', %s::jsonb)")
    params = (c.obra_a, None if matriz is None else json.dumps(matriz))
    if ok:
        inserir(c, cmd, params)
    else:
        with pytest.raises(errors.CheckViolation):
            inserir(c, cmd, params)


@pytest.mark.parametrize('coord, ok', [([0] * 9, True), ([0] * 8, False), ([0] * 10, False), ({}, False)])
def test_check_coordenadas(cenario, coord, ok):
    c = cenario
    cmd = 'insert into public.ra_referencial (obra_id, coordenadas) values (%s, %s::jsonb)'
    if ok:
        inserir(c, cmd, (c.obra_a, json.dumps(coord)))
    else:
        with pytest.raises(errors.CheckViolation):
            inserir(c, cmd, (c.obra_a, json.dumps(coord)))


@pytest.mark.parametrize('contorno, piso, teto, ok', [
    ([[0, 0], [1, 0], [1, 1]], 0, 2.7, True),
    ([[0, 0], [1, 0]], 0, 2.7, False),
    ({'a': 1}, 0, 2.7, False),
    ([[0, 0], [1, 0], [1, 1]], 2.7, 2.7, False),
    ([[0, 0], [1, 0], [1, 1]], 3, 2, False),
])
def test_check_contorno_e_alturas(cenario, contorno, piso, teto, ok):
    c = cenario
    cmd = ('insert into public.ambiente_geometria (ambiente_id, contorno, y_piso, y_teto) '
           'values (%s, %s::jsonb, %s, %s)')
    params = (c.amb_a, json.dumps(contorno), piso, teto)
    if ok:
        inserir(c, cmd, params)
    else:
        with pytest.raises(errors.CheckViolation):
            inserir(c, cmd, params)


@pytest.mark.parametrize('parede, dist, altura, lado', [
    (-1, 1, 1.5, 0.18), (0, -1, 1.5, 0.18), (0, 1, -0.1, 0.18), (0, 1, 5.1, 0.18),
    (0, 1, 1.5, 0.04), (0, 1, 1.5, 1.1),
])
def test_check_qr(cenario, parede, dist, altura, lado):
    c = cenario
    with pytest.raises(errors.CheckViolation):
        inserir(c, 'insert into public.ambiente_qr (ambiente_id, parede, distancia_m, altura_m, lado_m) '
                   'values (%s, %s, %s, %s, %s)', (c.amb_a, parede, dist, altura, lado))


def test_check_foto_ra_nulo_com_origem_normal(cenario):
    c = cenario
    rid, _ = concluir(c, c.equipe_a, [{}])
    with pytest.raises(errors.CheckViolation):
        inserir(c, "update public.foto set ra = '{}'::jsonb where registro_id = %s", (rid,))
    with pytest.raises(errors.CheckViolation):
        inserir(c, "update public.foto set origem = 'xyz' where registro_id = %s", (rid,))
