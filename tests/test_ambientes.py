import ast
import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def _carregar(nome, rel):
    spec = importlib.util.spec_from_file_location(nome, ROOT / rel)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


extrair_mod = _carregar("extrair_ambientes", "scripts/extrair_ambientes.py")


def _constante_gerar_plantas(nome):
    """Lê uma constante de scripts/gerar_plantas.py sem importar pymupdf."""
    arvore = ast.parse((ROOT / "scripts/gerar_plantas.py").read_text(encoding="utf-8"))
    for no in arvore.body:
        if isinstance(no, ast.Assign) and any(isinstance(t, ast.Name) and t.id == nome for t in no.targets):
            return ast.literal_eval(no.value)
    raise AssertionError(f"constante {nome} não encontrada")


RECORTE = _constante_gerar_plantas("RECORTE_EDIFICIO")
MASCARAS = _constante_gerar_plantas("MASCARAS")


@pytest.fixture(scope="module")
def resultado():
    inventario = json.loads((ROOT / "artifacts/validation/pdf/inventory.json").read_text(encoding="utf-8"))
    return extrair_mod.extrair(inventario)


def _por_nome(resultado, pav, nome):
    achados = [a for a in resultado["ambientes"] if a["pavimento"] == pav and a["nome_operacional"] == nome]
    assert len(achados) == 1, (pav, nome, len(achados))
    return achados[0]


def test_contagem_e_ids_unicos(resultado):
    amb = resultado["ambientes"]
    assert sum(a["pavimento"] == "terreo" for a in amb) == 44
    assert sum(a["pavimento"] == "1pav" for a in amb) == 43
    ids = [a["id"] for a in amb]
    assert len(ids) == len(set(ids))


def test_areas_conhecidas(resultado):
    assert _por_nome(resultado, "terreo", "Apto. 101")["area_m2"] == 23.88
    assert _por_nome(resultado, "terreo", "Salão de eventos")["area_m2"] == 158.59
    assert _por_nome(resultado, "1pav", "Apto. 211")["area_m2"] == 20.58


def test_bho_101_separado_do_apto_101(resultado):
    apto = _por_nome(resultado, "terreo", "Apto. 101")
    bho = _por_nome(resultado, "terreo", "Banheiro 101")
    assert bho["id"] != apto["id"]
    assert bho["categoria"] == "banheiro"
    assert bho["area_m2"] == 5.24
    assert apto["categoria"] == "apartamento"


def test_circulacoes_com_dois_marcadores(resultado):
    assert len(_por_nome(resultado, "terreo", "Circulação sul")["marcadores"]) == 2
    assert len(_por_nome(resultado, "1pav", "Circulação")["marcadores"]) == 2


def test_jardins_numerados_e_revisar(resultado):
    jardins = [a for a in resultado["ambientes"] if a["pavimento"] == "terreo" and a["nome_planta"].upper() == "JARDIM"]
    assert sorted(a["nome_operacional"] for a in jardins) == ["Jardim 1", "Jardim 2"]
    sem_area = [a for a in jardins if a["area_m2"] is None]
    assert len(sem_area) == 1
    assert any(r.get("nome") == sem_area[0]["nome_operacional"] and "Não incluso" in r["motivo"]
               for r in resultado["revisar"])


def _marcadores(resultado):
    for a in resultado["ambientes"]:
        for m in a["marcadores"]:
            yield a, m


def test_marcadores_normalizados_e_dentro_do_recorte(resultado):
    x0, y0, x1, y1 = RECORTE
    for a, m in _marcadores(resultado):
        assert 0 <= m["x"] <= 1 and 0 <= m["y"] <= 1, a["id"]
        assert x0 <= m["x"] <= x1 and y0 <= m["y"] <= y1, a["id"]


def test_pino_acima_do_nome(resultado):
    for a, m in _marcadores(resultado):
        bx0, by0, bx1, _ = m["rotulo_bbox"]
        assert m["y"] == by0, a["id"]
        assert bx0 <= m["x"] <= bx1, a["id"]


def test_marcadores_fora_das_mascaras(resultado):
    for a, m in _marcadores(resultado):
        for x0, y0, x1, y1 in MASCARAS:
            assert not (x0 <= m["x"] <= x1 and y0 <= m["y"] <= y1), (a["id"], (x0, y0, x1, y1))


@pytest.mark.parametrize("entrada,esperado", [
    ("APTO. AUTORIDADES (01)", "Apto. Autoridades 01"),
    ("BHO AUT. (02)", "Banheiro Autoridades 02"),
    ("VEST. FEM.", "Vestiário feminino"),
    ("BHO Tripulação", "Banheiro Tripulação"),
])
def test_nome_operacional(entrada, esperado):
    assert extrair_mod.nome_operacional(entrada) == esperado
