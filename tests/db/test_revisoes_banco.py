"""Nova revisão da planta aplicada pelo seed (migration 20261111130000_ambiente_ativo.sql).

Gera os seeds com scripts/gerar_seed.py a partir de listas sintéticas (as mesmas
de tests/test_revisoes.py), aplica a revisão R01 e depois a R02 e confere: a
planta anterior fica inativa (com os detalhes), a nova ativa, os ambientes
removidos ficam inativos e os registros antigos continuam lá.
"""
import copy
import importlib.util
import json
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

psycopg = pytest.importorskip('psycopg', reason='psycopg não instalado')

from conftest import sessao  # noqa: E402

RAIZ = Path(__file__).resolve().parents[2]


def _carregar(nome, rel):
    spec = importlib.util.spec_from_file_location(nome, RAIZ / rel)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


extrair_mod = _carregar('extrair_ambientes', 'scripts/extrair_ambientes.py')
seed_mod = _carregar('gerar_seed', 'scripts/gerar_seed.py')


def _rotulo(nome, area, x, y):
    largura = 4 * len(nome)
    return [
        {'text': nome, 'bbox': [x - largura / 2, y, x + largura / 2, y + 6.6], 'size': 5.5, 'direction': [1.0, 0.0]},
        {'text': f'A={area} m²', 'bbox': [x - 15, y + 7.7, x + 15, y + 14.3], 'size': 5.5, 'direction': [1.0, 0.0]},
    ]


def _paginas(*rotulos):
    return {'terreo': {'largura': 1000.0, 'altura': 500.0, 'spans': [s for r in rotulos for s in _rotulo(*r)]}}


def _obra(slug, revisao, **extra):
    obra = {
        'slug': slug, 'nome': f'Obra {slug}', 'status': 'aguardando_revisao_humana', 'revisao': revisao,
        'pasta_pdf': 'DOCS TESTE/PDF',
        'pavimentos': [{'codigo': 'terreo', 'nome': 'Térreo', 'ordem': 1, 'pdf': f'X-{revisao}.pdf', 'pagina': 1}],
        'prancha': {'recorte_edificio': [0, 0, 1, 1], 'mascaras': []},
        'nomes_fixos': {}, 'categorias': {}, 'renomear': [], 'revisao_humana': None,
    }
    obra.update(extra)
    return obra


R01 = _paginas(('COPA', '15.16', 240, 300), ('DML', '2.90', 600, 300), ('RECEPÇÃO', '20.49', 800, 100))
R02 = _paginas(('COZINHA', '15.16', 240, 300), ('SALA NOVA', '9.00', 100, 50), ('RECEPÇÃO', '21.00', 800, 100))


def _plantas(dados, revisao):
    detalhes = {a['id']: {'recorte_pt': [0.0, 0.0, 10.0, 10.0], 'largura': 20, 'altura': 20}
                for a in dados['ambientes']}
    return {'obra': dados['obra'], 'pavimentos': [{
        'id': 'terreo', 'revisao': revisao, 'sha256': 'abc', 'pagina_pt': [1000.0, 500.0],
        'recorte_pt': [0.0, 0.0, 1000.0, 500.0],
        'imagens': {'planta': {'largura': 200, 'altura': 100}, 'planta-hd': {'largura': 400, 'altura': 200}},
        'detalhes': detalhes,
    }]}


def _seed(obra, dados):
    return seed_mod.gerar(dados, _plantas(dados, obra['revisao']), {'slug': obra['slug'], 'nome': obra['nome']})


def _aplicar(dsn, sql_seed, vezes=1):
    for _ in range(vezes):
        with psycopg.connect(dsn, autocommit=True) as conn:
            conn.execute(sql_seed)


def _membro_e_registro(dsn, slug, codigo):
    """Cria um usuário da equipe da obra e um registro (pela RPC) no ambiente `codigo`."""
    uid, rid, fid = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    with sessao(dsn, papel=None) as cur:
        cur.execute('select id from public.obra where slug = %s', (slug,))
        obra = cur.fetchone()[0]
        cur.execute('select id from public.ambiente where obra_id = %s and codigo = %s', (obra, codigo))
        amb = cur.fetchone()[0]
        cur.execute('insert into auth.users (id, email) values (%s, %s)', (uid, f'{uid}@teste.invalid'))
        cur.execute('insert into public.usuario (id, telegram_id, nome) values (%s, %s, %s)',
                    (uid, uuid.uuid4().int % 10**15, 'Equipe'))
        cur.execute("insert into public.participacao (obra_id, usuario_id, papel) values (%s, %s, 'equipe')",
                    (obra, uid))
    registro = _concluir(dsn, uid, obra, amb, rid, fid)
    return uid, obra, amb, registro


def _concluir(dsn, uid, obra, amb, rid=None, fid=None):
    rid, fid = rid or uuid.uuid4(), fid or uuid.uuid4()
    with sessao(dsn, papel=None) as cur:
        cur.execute('insert into storage.objects (bucket_id, name, owner_id) values (%s, %s, %s)',
                    ('fotos', f'{obra}/{rid}/{fid}.jpg', str(uid)))
    fotos = [{'id': str(fid), 'largura': 800, 'altura': 600, 'bytes': 12345}]
    with sessao(dsn, uid) as cur:
        cur.execute('select id from public.concluir_registro(%s, %s, %s, %s, %s, %s::jsonb)',
                    (rid, amb, 'pendencia', 'Rodapé solto', datetime.now(timezone.utc) - timedelta(minutes=1),
                     json.dumps(fotos)))
        return cur.fetchone()[0]


def _ambientes(dsn, slug):
    with sessao(dsn, papel=None) as cur:
        cur.execute('select a.codigo, a.nome_operacional, a.ativo from public.ambiente a '
                    'join public.obra o on o.id = a.obra_id where o.slug = %s order by a.codigo', (slug,))
        return {c: (n, at) for c, n, at in cur.fetchall()}


def _plantas_no_banco(dsn, slug):
    with sessao(dsn, papel=None) as cur:
        cur.execute('select pl.revisao, pl.ativa, count(d.ambiente_id) from public.planta pl '
                    'join public.obra o on o.id = pl.obra_id '
                    'left join public.planta_detalhe d on d.planta_id = pl.id '
                    'where o.slug = %s group by 1, 2 order by 1', (slug,))
        return cur.fetchall()


def test_coluna_ativo_com_padrao_true(dsn):
    with sessao(dsn, papel=None) as cur:
        cur.execute("select data_type, is_nullable, column_default from information_schema.columns "
                    "where table_schema = 'public' and table_name = 'ambiente' and column_name = 'ativo'")
        assert cur.fetchone() == ('boolean', 'NO', 'true')


def test_nova_revisao_desativa_planta_e_ambientes_removidos(dsn):
    slug = 'rev-' + uuid.uuid4().hex[:8]
    obra1 = _obra(slug, 'R01')
    dados1 = extrair_mod.extrair(obra1, R01)
    _aplicar(dsn, _seed(obra1, dados1))
    assert _plantas_no_banco(dsn, slug) == [('R01', True, 3)]
    uid, obra_id, dml, registro = _membro_e_registro(dsn, slug, 'terreo-dml')

    obra2 = _obra(slug, 'R02')
    dados2 = extrair_mod.extrair(obra2, R02, copy.deepcopy(dados1))
    assert [r['id'] for r in dados2['ambientes_removidos']] == ['terreo-copa', 'terreo-dml']
    _aplicar(dsn, _seed(obra2, dados2), vezes=2)  # idempotente

    # Planta anterior e os detalhes dela ficam como histórico; só a nova está ativa.
    assert _plantas_no_banco(dsn, slug) == [('R01', False, 3), ('R02', True, 3)]
    assert _ambientes(dsn, slug) == {
        'terreo-copa': ('Copa', False),
        'terreo-cozinha': ('Cozinha', True),
        'terreo-dml': ('Dml', False),
        'terreo-recepcao': ('Recepção', True),
        'terreo-sala-nova': ('Sala nova', True),
    }
    with sessao(dsn, papel=None) as cur:
        cur.execute('select ambiente_id, situacao from public.registro where id = %s', (registro,))
        assert cur.fetchone() == (dml, 'aberta')

    # O participante lê a coluna; a RPC não bloqueia registro em ambiente inativo (fila offline).
    with sessao(dsn, uid) as cur:
        cur.execute('select ativo from public.ambiente where id = %s', (dml,))
        assert cur.fetchone() == (False,)
    outro = _concluir(dsn, uid, obra_id, dml)
    with sessao(dsn, papel=None) as cur:
        cur.execute('select count(*) from public.registro where ambiente_id = %s', (dml,))
        assert cur.fetchone()[0] == 2
        cur.execute('select ambiente_id from public.registro where id = %s', (outro,))
        assert cur.fetchone() == (dml,)


def test_manter_codigo_mantem_ambiente_e_registros(dsn):
    slug = 'rev-' + uuid.uuid4().hex[:8]
    obra1 = _obra(slug, 'R01')
    dados1 = extrair_mod.extrair(obra1, R01)
    _aplicar(dsn, _seed(obra1, dados1))
    _, _, copa, registro = _membro_e_registro(dsn, slug, 'terreo-copa')

    obra2 = _obra(slug, 'R02', manter_codigo={'terreo-cozinha': 'terreo-copa'})
    dados2 = extrair_mod.extrair(obra2, R02, copy.deepcopy(dados1))
    _aplicar(dsn, _seed(obra2, dados2))

    ambientes = _ambientes(dsn, slug)
    assert ambientes['terreo-copa'] == ('Cozinha', True)
    assert 'terreo-cozinha' not in ambientes
    assert ambientes['terreo-dml'] == ('Dml', False)
    with sessao(dsn, papel=None) as cur:
        cur.execute('select ambiente_id from public.registro where id = %s', (registro,))
        assert cur.fetchone() == (copa,)
        # O detalhe da planta nova aponta para o mesmo ambiente (mesmo id).
        cur.execute("select count(*) from public.planta_detalhe d join public.planta pl on pl.id = d.planta_id "
                    "where d.ambiente_id = %s and pl.revisao = 'R02' and pl.ativa", (copa,))
        assert cur.fetchone()[0] == 1


def test_id_aplicado_antes_de_confirmar_renomeacao_fica_inativo(dsn):
    """Seed aplicado antes do ``manter_codigo``: o id novo provisório sai da lista e fica inativo."""
    slug = 'rev-' + uuid.uuid4().hex[:8]
    obra1 = _obra(slug, 'R01')
    dados1 = extrair_mod.extrair(obra1, R01)
    _aplicar(dsn, _seed(obra1, dados1))

    obra2 = _obra(slug, 'R02')
    provisorio = extrair_mod.extrair(obra2, R02, copy.deepcopy(dados1))
    _aplicar(dsn, _seed(obra2, provisorio))  # cedo demais: 'terreo-cozinha' chega ao banco
    assert _ambientes(dsn, slug)['terreo-cozinha'] == ('Cozinha', True)

    obra2 = _obra(slug, 'R02', manter_codigo={'terreo-cozinha': 'terreo-copa'})
    dados2 = extrair_mod.extrair(obra2, R02, copy.deepcopy(provisorio))
    _aplicar(dsn, _seed(obra2, dados2))
    ambientes = _ambientes(dsn, slug)
    assert ambientes['terreo-copa'] == ('Cozinha', True)
    assert ambientes['terreo-cozinha'] == ('Cozinha', False)
