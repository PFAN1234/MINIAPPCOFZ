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

OBRAS = ["hto", "cofz"]
HTO = extrair_mod.carregar_obra("hto")


def _prancha(obra):
    recorte = obra["prancha"]["recorte_edificio"]
    mascaras = [m["retangulo"] for m in obra["prancha"]["mascaras"]]
    return recorte, mascaras


@pytest.fixture(scope="module")
def resultado():
    return extrair_mod.extrair(HTO, extrair_mod.ler_paginas(HTO))


@pytest.fixture(scope="module", params=OBRAS)
def obra_e_resultado(request):
    obra = extrair_mod.carregar_obra(request.param)
    return obra, extrair_mod.extrair(obra, extrair_mod.ler_paginas(obra))


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


def test_arquivo_commitado_esta_atualizado(obra_e_resultado):
    obra, resultado = obra_e_resultado
    commitado = json.loads((ROOT / "data" / obra["slug"] / "ambientes.json").read_text(encoding="utf-8"))
    assert commitado == resultado, f"rode python3 scripts/extrair_ambientes.py --obra {obra['slug']}"


def test_cabecalho_vem_da_configuracao(obra_e_resultado):
    obra, resultado = obra_e_resultado
    assert resultado["obra"] == obra["slug"]
    assert resultado["status"] == obra["status"]
    assert [p["id"] for p in resultado["pavimentos"]] == [p["codigo"] for p in obra["pavimentos"]]
    assert {a["revisao"] for a in resultado["ambientes"]} == {obra["revisao"]}


def test_ids_unicos(obra_e_resultado):
    _, resultado = obra_e_resultado
    ids = [a["id"] for a in resultado["ambientes"]]
    assert len(ids) == len(set(ids))
    assert not any(r["motivo"] == "área sem nome acima" for r in resultado["revisar"])


def test_marcadores_normalizados_e_dentro_do_recorte(obra_e_resultado):
    obra, resultado = obra_e_resultado
    x0, y0, x1, y1 = _prancha(obra)[0]
    for a, m in _marcadores(resultado):
        assert 0 <= m["x"] <= 1 and 0 <= m["y"] <= 1, a["id"]
        assert x0 <= m["x"] <= x1 and y0 <= m["y"] <= y1, a["id"]


def test_pino_acima_do_nome(obra_e_resultado):
    _, resultado = obra_e_resultado
    for a, m in _marcadores(resultado):
        bx0, by0, bx1, _ = m["rotulo_bbox"]
        assert m["y"] == by0, a["id"]
        assert bx0 <= m["x"] <= bx1, a["id"]


def test_marcadores_fora_das_mascaras(obra_e_resultado):
    obra, resultado = obra_e_resultado
    for a, m in _marcadores(resultado):
        for x0, y0, x1, y1 in _prancha(obra)[1]:
            assert not (x0 <= m["x"] <= x1 and y0 <= m["y"] <= y1), (a["id"], (x0, y0, x1, y1))


@pytest.mark.parametrize("entrada,esperado", [
    ("APTO. AUTORIDADES (01)", "Apto. Autoridades 01"),
    ("BHO AUT. (02)", "Banheiro Autoridades 02"),
    ("VEST. FEM.", "Vestiário feminino"),
    ("BHO Tripulação", "Banheiro Tripulação"),
])
def test_nome_operacional(entrada, esperado):
    assert extrair_mod.nome_operacional(entrada, HTO["nomes_fixos"]) == esperado


# --- Função pura com spans sintéticos ----------------------------------------

def _rotulo(nome, area, x, y, extras=()):
    """Spans de um rótulo como na planta: nome com 'A=xx m²' logo abaixo."""
    largura = 4 * len(nome)
    spans = [
        {"text": nome, "bbox": [x - largura / 2, y, x + largura / 2, y + 6.6], "size": 5.5, "direction": [1.0, 0.0]},
        {"text": f"A={area} m²", "bbox": [x - 15, y + 7.7, x + 15, y + 14.3], "size": 5.5, "direction": [1.0, 0.0]},
    ]
    return spans + list(extras)


def _obra_sintetica(**extra):
    obra = {
        "slug": "teste", "nome": "Teste", "status": "aguardando_revisao_humana", "revisao": "R01",
        "pasta_pdf": "DOCS TESTE/PDF",
        "pavimentos": [{"codigo": "terreo", "nome": "Térreo", "ordem": 1, "pdf": "X-R01.pdf", "pagina": 1}],
        "prancha": {"recorte_edificio": [0, 0, 1, 1], "mascaras": []},
        "nomes_fixos": {"WC FEM": "WC feminino"},
        "categorias": {}, "renomear": [], "revisao_humana": None,
    }
    obra.update(extra)
    extrair_mod.validar_obra(obra)
    return obra


def _paginas(spans):
    return {"terreo": {"largura": 1000.0, "altura": 500.0, "spans": spans}}


def test_codigo_de_mobiliario_colado_nao_vira_nome():
    # Códigos de mobiliário (fonte 6) ao lado ou um pouco acima da área não podem ganhar do nome.
    mo = [
        {"text": "MO3", "bbox": [262.0, 107.5, 275.0, 115.7], "size": 6.0, "direction": [1.0, 0.0]},
        {"text": "GD", "bbox": [205.0, 104.0, 214.0, 112.2], "size": 6.0, "direction": [1.0, 0.0]},
    ]
    spans = _rotulo("SALA DE REUNIÕES", "30.77", 240, 100, mo) + _rotulo("COPA", "15.16", 240, 300)
    res = extrair_mod.extrair(_obra_sintetica(), _paginas(spans))
    assert sorted(a["nome_planta"] for a in res["ambientes"]) == ["COPA", "SALA DE REUNIÕES"]


def test_nomes_repetidos_numerados_e_renomear_por_area():
    spans = (_rotulo("CIRCULAÇÃO", "21.47", 100, 100) + _rotulo("CIRCULAÇÃO", "8.64", 400, 100)
             + _rotulo("CIRCULAÇÃO", "15.29", 700, 100) + _rotulo("WC FEM", "14.12", 100, 300))
    res = extrair_mod.extrair(_obra_sintetica(), _paginas(spans))
    nomes = {a["area_m2"]: a["nome_operacional"] for a in res["ambientes"]}
    assert nomes == {8.64: "Circulação 1", 15.29: "Circulação 2", 21.47: "Circulação 3", 14.12: "WC feminino"}
    assert next(a for a in res["ambientes"] if a["nome_planta"] == "WC FEM")["categoria"] == "banheiro"

    renomear = [{"pavimento": "terreo", "nome_planta": "CIRCULAÇÃO", "area_m2": 21.47, "nome_operacional": "Corredor oeste"}]
    obra = _obra_sintetica(renomear=renomear, categorias={"WC FEM": "vestiario"})
    res = extrair_mod.extrair(obra, _paginas(spans))
    nomes = {a["area_m2"]: a["nome_operacional"] for a in res["ambientes"]}
    assert nomes == {8.64: "Circulação 1", 15.29: "Circulação 2", 21.47: "Corredor oeste", 14.12: "WC feminino"}
    assert "terreo-corredor-oeste" in {a["id"] for a in res["ambientes"]}
    assert next(a for a in res["ambientes"] if a["nome_planta"] == "WC FEM")["categoria"] == "vestiario"


def test_renomear_sem_ambiente_falha():
    renomear = [{"pavimento": "terreo", "nome_planta": "CIRCULAÇÃO", "area_m2": 99.0, "nome_operacional": "X"}]
    with pytest.raises(SystemExit, match="renomear"):
        extrair_mod.extrair(_obra_sintetica(renomear=renomear), _paginas(_rotulo("CIRCULAÇÃO", "8.64", 100, 100)))


def test_status_revisado_exige_revisao_da_mesma_planta():
    with pytest.raises(SystemExit, match="revisão humana"):
        _obra_sintetica(status="revisado", revisao_humana={"revisao_planta": "R00", "decisoes": []})
    with pytest.raises(SystemExit, match="revisão"):
        _obra_sintetica(pavimentos=[{"codigo": "terreo", "nome": "Térreo", "pdf": "X-R02.pdf"}])


def test_ambiente_manual_entra_na_lista_ordenado():
    manuais = [{"pavimento": "terreo", "nome_operacional": "Banheiro da copa", "categoria": "banheiro",
                "marcador": {"x": 0.5, "y": 0.25}}]
    spans = _rotulo("COPA", "15.16", 240, 300) + _rotulo("WC FEM", "14.12", 100, 300)
    res = extrair_mod.extrair(_obra_sintetica(ambientes_manuais=manuais), _paginas(spans))
    assert [a["nome_operacional"] for a in res["ambientes"]] == ["Banheiro da copa", "Copa", "WC feminino"]
    manual = res["ambientes"][0]
    assert manual["id"] == "terreo-banheiro-da-copa"
    assert manual["nome_planta"] is None and manual["area_m2"] is None
    assert manual["marcadores"] == [{"x": 0.5, "y": 0.25, "rotulo_bbox": [0.5, 0.25, 0.5, 0.25]}]
    assert res["revisar"] == [{"pavimento": "terreo", "motivo": "ambiente sem rótulo na planta; pino colocado à mão",
                               "nome": "Banheiro da copa"}]


def test_ambiente_manual_invalido_falha():
    manuais = [{"pavimento": "1pav", "nome_operacional": "X", "categoria": "servico", "marcador": {"x": 0.5, "y": 0.5}}]
    with pytest.raises(SystemExit, match="pavimento"):
        _obra_sintetica(ambientes_manuais=manuais)
    manuais = [{"pavimento": "terreo", "nome_operacional": "X", "categoria": "servico", "marcador": {"x": 1.5, "y": 0.5}}]
    with pytest.raises(SystemExit, match="0–1"):
        _obra_sintetica(ambientes_manuais=manuais)
