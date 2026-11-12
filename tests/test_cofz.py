"""Dados da obra COFZ (prancha DE009 R06, pavimento único; 17 rótulos e 2 ambientes manuais)."""
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
seed_mod = _carregar("gerar_seed", "scripts/gerar_seed.py")
publicar_mod = _carregar("publicar_plantas", "scripts/publicar_plantas.py")

OBRA = extrair_mod.carregar_obra("cofz")
DADOS = json.loads((ROOT / "data/cofz/ambientes.json").read_text(encoding="utf-8"))
PLANTAS = json.loads((ROOT / "data/cofz/plantas.json").read_text(encoding="utf-8"))
AMBIENTES = DADOS["ambientes"]

# Os 17 rótulos da planta: (nome na planta, área).
ROTULOS = sorted([
    ("WC PCD", 3.52), ("WC FEM", 14.12), ("WC MASC", 12.02), ("CPD", 2.58), ("DML", 2.90),
    ("CIRCULAÇÃO", 21.47), ("CIRCULAÇÃO", 8.64), ("CIRCULAÇÃO", 15.29), ("COPA", 15.16),
    ("SALA DA CHEFIA", 22.77), ("DA", 20.44), ("SALA DE CONTROLE", 15.33), ("SALÃO DE ACESSO", 42.41),
    ("COMISSÃO DE OBRAS", 46.81), ("SALA IMERSIVA", 55.82), ("RECEPÇÃO", 20.49), ("SALA DE REUNIÕES", 30.77),
])


def _por_planta(nome):
    achados = [a for a in AMBIENTES if a["nome_planta"] == nome]
    assert len(achados) == 1, (nome, len(achados))
    return achados[0]


def test_configuracao():
    assert OBRA["slug"] == "cofz" and OBRA["nome"] == "COFZ"
    assert OBRA["revisao"] == "R06"
    assert [(p["codigo"], p["nome"]) for p in OBRA["pavimentos"]] == [("terreo", "Térreo")]
    assert DADOS["status"] == "aguardando_revisao_humana"


def test_dezessete_rotulos_e_dois_ambientes_manuais():
    assert len(AMBIENTES) == 19
    rotulados = [a for a in AMBIENTES if a["nome_planta"] is not None]
    assert sorted((a["nome_planta"], a["area_m2"]) for a in rotulados) == ROTULOS
    assert all(a["pavimento"] == "terreo" and a["revisao"] == "R06" for a in AMBIENTES)
    assert all(len(a["marcadores"]) == 1 for a in AMBIENTES)


@pytest.mark.parametrize("id_,nome,categoria", [
    ("terreo-wc-da-chefia", "WC da chefia", "banheiro"),
    ("terreo-sala-de-apoio", "Sala de apoio", "area_comum"),
])
def test_ambientes_manuais(id_, nome, categoria):
    (amb,) = [a for a in AMBIENTES if a["id"] == id_]
    assert amb["nome_operacional"] == nome and amb["categoria"] == categoria
    assert amb["nome_planta"] is None and amb["area_m2"] is None
    (m,) = amb["marcadores"]
    x0, y0, x1, y1 = OBRA["prancha"]["recorte_edificio"]
    assert x0 <= m["x"] <= x1 and y0 <= m["y"] <= y1
    assert m["rotulo_bbox"] == [m["x"], m["y"], m["x"], m["y"]]
    assert {"pavimento": "terreo", "motivo": "ambiente sem rótulo na planta; pino colocado à mão",
            "nome": nome} in DADOS["revisar"]
    assert id_ in PLANTAS["pavimentos"][0]["detalhes"]


def test_manuais_dentro_do_comodo_certo():
    # Caixas dos cômodos medidas na prancha (normalizadas): o pino não pode sair delas.
    comodos = {"terreo-wc-da-chefia": (0.2545, 0.4175, 0.294, 0.4445),
               "terreo-sala-de-apoio": (0.7045, 0.4265, 0.7285, 0.50)}
    for id_, (x0, y0, x1, y1) in comodos.items():
        (amb,) = [a for a in AMBIENTES if a["id"] == id_]
        m = amb["marcadores"][0]
        assert x0 < m["x"] < x1 and y0 < m["y"] < y1, id_


def test_areas_conhecidas():
    assert _por_planta("SALA IMERSIVA")["area_m2"] == 55.82
    assert _por_planta("COMISSÃO DE OBRAS")["area_m2"] == 46.81


def test_tres_circulacoes_distintas():
    circ = [a for a in AMBIENTES if a["nome_planta"] == "CIRCULAÇÃO"]
    assert len(circ) == 3
    assert len({a["id"] for a in circ}) == 3
    assert sorted(a["area_m2"] for a in circ) == [8.64, 15.29, 21.47]
    assert all(a["categoria"] == "circulacao" for a in circ)
    marcadores = {(a["marcadores"][0]["x"], a["marcadores"][0]["y"]) for a in circ}
    assert len(marcadores) == 3
    assert any(r["motivo"].startswith("mesmo nome") for r in DADOS["revisar"])


@pytest.mark.parametrize("nome,operacional", [
    ("WC PCD", "WC PCD"), ("WC FEM", "WC feminino"), ("WC MASC", "WC masculino"),
    ("CPD", "CPD"), ("DML", "DML"), ("DA", "Sala DA"),
    ("SALA IMERSIVA", "Sala imersiva"), ("RECEPÇÃO", "Recepção"),
])
def test_nomes_operacionais(nome, operacional):
    assert _por_planta(nome)["nome_operacional"] == operacional


def test_categorias():
    esperado = {"WC PCD": "banheiro", "WC FEM": "banheiro", "WC MASC": "banheiro",
                "CPD": "servico", "DML": "servico", "COPA": "servico", "RECEPÇÃO": "servico"}
    for a in AMBIENTES:
        if a["nome_planta"] in ("CIRCULAÇÃO", None):
            continue
        assert a["categoria"] == esperado.get(a["nome_planta"], "area_comum"), a["nome_planta"]


def test_marcadores_dentro_do_recorte():
    x0, y0, x1, y1 = OBRA["prancha"]["recorte_edificio"]
    for a in AMBIENTES:
        for m in a["marcadores"]:
            assert x0 <= m["x"] <= x1 and y0 <= m["y"] <= y1, a["id"]


def test_limites_de_tamanho_iguais_aos_da_hto():
    (pav,) = PLANTAS["pavimentos"]
    assert pav["imagens"]["planta"]["bytes"] < 1_500_000
    assert max(pav["imagens"]["planta"]["largura"], pav["imagens"]["planta"]["altura"]) <= 2401
    assert max(pav["imagens"]["planta-hd"]["largura"], pav["imagens"]["planta-hd"]["altura"]) <= 4097
    assert len(pav["detalhes"]) == 19
    for id_, det in pav["detalhes"].items():
        assert det["bytes"] < 250_000, id_


def test_seed_da_cofz_atualizado():
    sql = seed_mod.gerar(DADOS)
    assert (ROOT / "supabase/seed/cofz.sql").read_text(encoding="utf-8") == sql, \
        "supabase/seed/cofz.sql desatualizado: rode python3 scripts/gerar_seed.py --obra cofz"
    linhas = sql.splitlines()
    assert linhas[0].startswith("-- Gerado por scripts/gerar_seed.py a partir de data/cofz/ambientes.json")
    assert "insert into public.obra (slug, nome, etapa_id) values ('cofz', 'COFZ', (select e.id from public.etapa e where e.slug = '2a-etapa'))" in sql
    assert "'hto'" not in sql
    assert sum(linha.startswith("insert into public.ambiente ") for linha in linhas) == 19
    assert sum(linha.startswith("insert into public.planta_detalhe ") for linha in linhas) == 19
    linha_wc = next(linha for linha in linhas if "'terreo-wc-da-chefia', 'WC da chefia'" in linha)
    assert "'WC da chefia', null, 'banheiro', null, 'R06'," in linha_wc
    assert "o.id::text || '/R06/terreo/planta.webp'" in sql


def test_publicacao_usa_a_pasta_da_obra():
    base = publicar_mod.base_da_obra("cofz")
    assert base == ROOT / "data/cofz/plantas"
    caminhos = [c for _, c in publicar_mod.mapear_caminhos(base, "OBRA")]
    assert len(caminhos) == 2 + 19
    assert "OBRA/R06/terreo/ambientes/terreo-da.webp" not in caminhos
    assert "OBRA/R06/terreo/planta.webp" in caminhos
    with pytest.raises(SystemExit):
        publicar_mod.base_da_obra("../hto")
