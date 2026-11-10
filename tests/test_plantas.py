import hashlib
import json
from pathlib import Path

import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
MANIFESTO = json.loads((ROOT / "data/hto/plantas.json").read_text(encoding="utf-8"))
AMBIENTES = json.loads((ROOT / "data/hto/ambientes.json").read_text(encoding="utf-8"))
PAVIMENTOS = MANIFESTO["pavimentos"]
IDS = [p["id"] for p in PAVIMENTOS]


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
    esperados = {a["id"] for a in AMBIENTES["ambientes"] if a["pavimento"] == pav["id"]}
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
