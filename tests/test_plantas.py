import hashlib
import json
from pathlib import Path

import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OBRAS = ["hto", "cofz"]


def _ler(slug, arquivo):
    return json.loads((ROOT / "data" / slug / arquivo).read_text(encoding="utf-8"))


AMBIENTES = {slug: _ler(slug, "ambientes.json") for slug in OBRAS}
CONFIG = {slug: _ler(slug, "obra.json") for slug in OBRAS}
# Cada pavimento leva junto o slug da obra; os limites de tamanho valem para todas as obras.
PAVIMENTOS = [dict(p, obra=slug) for slug in OBRAS for p in _ler(slug, "plantas.json")["pavimentos"]]
IDS = [f"{p['obra']}-{p['id']}" for p in PAVIMENTOS]


def _imagens(pav):
    yield from pav["imagens"].values()
    yield from pav["detalhes"].values()


@pytest.mark.parametrize("pav", PAVIMENTOS, ids=IDS)
def test_arquivos_existem_e_bytes_batem(pav):
    for img in _imagens(pav):
        arq = ROOT / img["arquivo"]
        assert arq.is_file(), img["arquivo"]
        assert arq.stat().st_size == img["bytes"], img["arquivo"]
    assert (ROOT / pav["prova"]).is_file()


@pytest.mark.parametrize("pav", PAVIMENTOS, ids=IDS)
def test_limites_de_tamanho(pav):
    assert pav["imagens"]["planta"]["bytes"] < 1_500_000
    for id_, det in pav["detalhes"].items():
        assert det["bytes"] < 250_000, id_


@pytest.mark.parametrize("pav", PAVIMENTOS, ids=IDS)
def test_detalhe_para_cada_ambiente(pav):
    esperados = {a["id"] for a in AMBIENTES[pav["obra"]]["ambientes"] if a["pavimento"] == pav["id"]}
    assert esperados
    assert set(pav["detalhes"]) == esperados


@pytest.mark.parametrize("pav", PAVIMENTOS, ids=IDS)
def test_sha256_do_pdf(pav):
    pdf = ROOT / pav["pdf"]
    assert pdf.parent.name == "PDF" and pdf.is_file()
    assert hashlib.sha256(pdf.read_bytes()).hexdigest() == pav["sha256"]


@pytest.mark.parametrize("pav", PAVIMENTOS, ids=IDS)
def test_dimensoes_das_imagens(pav):
    amostra = [pav["imagens"]["planta"], pav["imagens"]["planta-hd"], next(iter(pav["detalhes"].values()))]
    for img in amostra:
        with Image.open(ROOT / img["arquivo"]) as im:
            assert im.size == (img["largura"], img["altura"]), img["arquivo"]


@pytest.mark.parametrize("pav", PAVIMENTOS, ids=IDS)
def test_caminhos_dentro_da_pasta_da_obra(pav):
    base = f"data/{pav['obra']}/plantas/{pav['revisao']}/{pav['id']}/"
    for img in _imagens(pav):
        assert img["arquivo"].startswith(base), img["arquivo"]
    assert pav["prova"] == base + "prova.png"


@pytest.mark.parametrize("pav", PAVIMENTOS, ids=IDS)
def test_recorte_e_mascaras_da_configuracao(pav):
    prancha = CONFIG[pav["obra"]]["prancha"]
    w, h = pav["pagina_pt"]
    x0, y0, x1, y1 = prancha["recorte_edificio"]
    assert pav["recorte_pt"] == [round(v, 3) for v in (x0 * w, y0 * h, x1 * w, y1 * h)]
    assert pav["mascaras_normalizadas"] == [m["retangulo"] for m in prancha["mascaras"]]
    assert pav["revisao"] == CONFIG[pav["obra"]]["revisao"]
