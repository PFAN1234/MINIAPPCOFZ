"""Revisões da planta: códigos estáveis, ambientes removidos, diferenças e seed.

Usa spans sintéticos (sem o PDF), no estilo de tests/test_ambientes.py.
"""
import copy
import importlib.util
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


def _rotulo(nome, area, x, y):
    """Spans de um rótulo como na planta: nome com 'A=xx m²' logo abaixo."""
    largura = 4 * len(nome)
    return [
        {"text": nome, "bbox": [x - largura / 2, y, x + largura / 2, y + 6.6], "size": 5.5, "direction": [1.0, 0.0]},
        {"text": f"A={area} m²", "bbox": [x - 15, y + 7.7, x + 15, y + 14.3], "size": 5.5, "direction": [1.0, 0.0]},
    ]


def _obra(revisao="R01", **extra):
    obra = {
        "slug": "teste", "nome": "Teste", "status": "aguardando_revisao_humana", "revisao": revisao,
        "pasta_pdf": "DOCS TESTE/PDF",
        "pavimentos": [{"codigo": "terreo", "nome": "Térreo", "ordem": 1, "pdf": f"X-{revisao}.pdf", "pagina": 1}],
        "prancha": {"recorte_edificio": [0, 0, 1, 1], "mascaras": []},
        "nomes_fixos": {}, "categorias": {}, "renomear": [], "revisao_humana": None,
    }
    obra.update(extra)
    extrair_mod.validar_obra(obra)
    return obra


def _paginas(*rotulos):
    spans = [s for r in rotulos for s in _rotulo(*r)]
    return {"terreo": {"largura": 1000.0, "altura": 500.0, "spans": spans}}


# Revisão R01: copa, DML e recepção.
R01 = _paginas(("COPA", "15.16", 240, 300), ("DML", "2.90", 600, 300), ("RECEPÇÃO", "20.49", 800, 100))
# Revisão R02: a copa vira "COZINHA" no mesmo lugar, o DML some, entra uma sala longe dali
# e a recepção muda de área.
R02 = _paginas(("COZINHA", "15.16", 240, 300), ("SALA NOVA", "9.00", 100, 50), ("RECEPÇÃO", "21.00", 800, 100))


def _extrair(obra, paginas, base=None):
    return extrair_mod.extrair(obra, paginas, copy.deepcopy(base))


@pytest.fixture(scope="module")
def r01():
    return _extrair(_obra(), R01)


@pytest.fixture(scope="module")
def r02(r01):
    return _extrair(_obra("R02"), R02, r01)


def _ids(res):
    return [a["id"] for a in res["ambientes"]]


# --- Extrator ----------------------------------------------------------------

def test_sem_base_comportamento_atual(r01):
    assert _ids(r01) == ["terreo-copa", "terreo-dml", "terreo-recepcao"]
    assert r01["ambientes_removidos"] == []
    assert r01["diferencas"] == extrair_mod.diferencas_vazias()
    assert not extrair_mod.tem_diferencas(r01["diferencas"])


def test_id_igual_mantido_e_idempotente(r01):
    de_novo = _extrair(_obra(), R01, r01)
    assert _ids(de_novo) == _ids(r01)
    assert de_novo["ambientes_removidos"] == []
    assert not extrair_mod.tem_diferencas(de_novo["diferencas"])
    assert _extrair(_obra(), R01, de_novo) == de_novo


def test_nova_revisao_relata_novos_removidos_e_area(r02):
    dif = r02["diferencas"]
    assert dif["revisao_base"] == "R01"
    assert [n["id"] for n in dif["novos"]] == ["terreo-cozinha", "terreo-sala-nova"]
    assert [r["id"] for r in dif["removidos"]] == ["terreo-copa", "terreo-dml"]
    assert dif["area_alterada"] == [
        {"id": "terreo-recepcao", "nome_operacional": "Recepção", "antes": 20.49, "depois": 21.0}]
    assert dif["herdados"] == [] and dif["nome_alterado"] == [] and dif["marcador_deslocado"] == []


def test_removido_entra_em_ambientes_removidos_com_sucessor(r02):
    assert r02["ambientes_removidos"] == [
        {"id": "terreo-copa", "pavimento": "terreo", "nome_operacional": "Copa", "revisao_ultima": "R01"},
        {"id": "terreo-dml", "pavimento": "terreo", "nome_operacional": "Dml", "revisao_ultima": "R01"},
    ]
    copa, dml = r02["diferencas"]["removidos"]
    assert copa["sucessor_sugerido"]["id"] == "terreo-cozinha"
    assert "pino a 0,000" in copa["sucessor_sugerido"]["motivo"]
    assert "mesma área" in copa["sucessor_sugerido"]["motivo"]
    assert dml["sucessor_sugerido"] is None
    # A sugestão só é relatada: o código novo continua o calculado.
    assert "terreo-cozinha" in _ids(r02) and "terreo-copa" not in _ids(r02)


def test_nova_revisao_rodada_de_novo_da_o_mesmo_arquivo(r02):
    assert _extrair(_obra("R02"), R02, r02) == r02


def test_manter_codigo_herda_codigo_antigo(r01, r02):
    obra = _obra("R02", manter_codigo={"terreo-cozinha": "terreo-copa"})
    # Depois de ler o relatório (base = saída de R02, onde a copa já está em removidos).
    res = _extrair(obra, R02, r02)
    cozinha = next(a for a in res["ambientes"] if a["nome_planta"] == "COZINHA")
    assert cozinha["id"] == "terreo-copa" and cozinha["nome_operacional"] == "Cozinha"
    assert [r["id"] for r in res["ambientes_removidos"]] == ["terreo-dml"]
    dif = res["diferencas"]
    assert dif["herdados"] == [{"id": "terreo-copa", "id_calculado": "terreo-cozinha", "pavimento": "terreo",
                                "nome_antes": "Copa", "nome_operacional": "Cozinha", "reativado": False}]
    assert [n["id"] for n in dif["novos"]] == ["terreo-sala-nova"]
    assert [r["id"] for r in dif["removidos"]] == ["terreo-dml"]
    assert dif["revisao_base"] == "R01"
    # O mesmo resultado direto da base R01, e estável ao rodar de novo.
    assert _extrair(obra, R02, r01) == res
    assert _extrair(obra, R02, res) == res


def test_manter_codigo_reativa_id_de_removidos(r02):
    # Numa revisão seguinte, o DML volta com outro nome e herda o código antigo.
    r03 = _paginas(("COZINHA", "15.16", 240, 300), ("SALA NOVA", "9.00", 100, 50),
                   ("RECEPÇÃO", "21.00", 800, 100), ("DEPÓSITO", "2.90", 600, 300))
    obra = _obra("R03", manter_codigo={"terreo-deposito": "terreo-dml"})
    res = _extrair(obra, r03, r02)
    assert "terreo-dml" in _ids(res)
    assert [r["id"] for r in res["ambientes_removidos"]] == ["terreo-copa"]
    assert res["diferencas"]["herdados"] == [{
        "id": "terreo-dml", "id_calculado": "terreo-deposito", "pavimento": "terreo",
        "nome_antes": "Dml", "nome_operacional": "Depósito", "reativado": True}]
    assert _extrair(obra, r03, res) == res


@pytest.mark.parametrize("manter,erro", [
    ({"terreo-inexistente": "terreo-copa"}, "sem ambiente correspondente"),
    ({"terreo-cozinha": "terreo-nunca-existiu"}, "não existem na base"),
    ({"terreo-cozinha": "terreo-recepcao"}, "colide"),
    ({"terreo-cozinha": "terreo-copa", "terreo-sala-nova": "terreo-copa"}, "mesmo id antigo"),
    ({"terreo-cozinha": "terreo-cozinha"}, "igual ao antigo"),
])
def test_manter_codigo_invalido_falha(r01, manter, erro):
    with pytest.raises(SystemExit, match=erro):
        _extrair(_obra("R02", manter_codigo=manter), R02, r01)


def test_manter_codigo_entre_pavimentos_falha(r01):
    base = copy.deepcopy(r01)
    base["ambientes_removidos"] = [{"id": "1pav-copa", "pavimento": "1pav", "nome_operacional": "Copa",
                                    "revisao_ultima": "R00"}]
    with pytest.raises(SystemExit, match="pavimentos diferentes"):
        _extrair(_obra("R02", manter_codigo={"terreo-cozinha": "1pav-copa"}), R02, base)


def test_manter_codigo_sem_base_falha():
    with pytest.raises(SystemExit, match="base"):
        _extrair(_obra("R02", manter_codigo={"terreo-cozinha": "terreo-copa"}), R02)


def test_manter_codigo_mal_formado_falha():
    with pytest.raises(SystemExit, match="manter_codigo"):
        _obra(manter_codigo=["terreo-copa"])


def test_removidos_acumulam_e_ambiente_que_volta_sai(r02):
    # R03: some a sala nova; o DML (removido em R02) continua em removidos.
    r03 = _paginas(("COZINHA", "15.16", 240, 300), ("RECEPÇÃO", "21.00", 800, 100))
    res3 = _extrair(_obra("R03"), r03, r02)
    assert [r["id"] for r in res3["ambientes_removidos"]] == ["terreo-copa", "terreo-dml", "terreo-sala-nova"]
    assert next(r for r in res3["ambientes_removidos"] if r["id"] == "terreo-dml")["revisao_ultima"] == "R01"
    assert [r["id"] for r in res3["diferencas"]["removidos"]] == ["terreo-sala-nova"]
    # R04: o DML volta com o mesmo nome (mesmo id) e sai de removidos.
    r04 = _paginas(("COZINHA", "15.16", 240, 300), ("RECEPÇÃO", "21.00", 800, 100), ("DML", "2.90", 600, 300))
    res4 = _extrair(_obra("R04"), r04, res3)
    assert "terreo-dml" in _ids(res4)
    assert [r["id"] for r in res4["ambientes_removidos"]] == ["terreo-copa", "terreo-sala-nova"]
    assert [n["id"] for n in res4["diferencas"]["novos"]] == ["terreo-dml"]


def test_nome_alterado_mantendo_codigo_e_pino_deslocado(r01):
    # "Copa" vira "COPA" (mesmo slug) e a recepção muda de lugar.
    paginas = _paginas(("COPA", "15.16", 240, 300), ("DML", "2.90", 600, 300), ("RECEPÇÃO", "20.49", 850, 150))
    res = _extrair(_obra("R02", nomes_fixos={"COPA": "COPA"}), paginas, r01)
    dif = res["diferencas"]
    assert dif["nome_alterado"] == [{"id": "terreo-copa", "antes": "Copa", "depois": "COPA"}]
    assert [d["id"] for d in dif["marcador_deslocado"]] == ["terreo-recepcao"]
    assert dif["marcador_deslocado"][0]["distancia"] > extrair_mod.LIMIAR_DESLOCAMENTO
    assert dif["novos"] == [] and dif["removidos"] == []


def test_relatorio_explica_como_confirmar_renomeacao(r02):
    texto = "\n".join(extrair_mod.relatorio_diferencas(r02["diferencas"], "teste"))
    assert "terreo-copa (Copa) -> provável sucessor terreo-cozinha" in texto
    assert '"manter_codigo": {"terreo-cozinha": "terreo-copa"}' in texto
    assert "data/teste/obra.json" in texto
    assert "terreo-recepcao: 20.49 -> 21.0 m²" in texto
    assert extrair_mod.relatorio_diferencas(extrair_mod.diferencas_vazias(), "teste") == [
        "Diferenças em relação à lista anterior: nenhuma."]


# --- Seed --------------------------------------------------------------------

def _plantas(dados, revisao):
    detalhes = {a["id"]: {"recorte_pt": [0.0, 0.0, 10.0, 10.0], "largura": 20, "altura": 20}
                for a in dados["ambientes"]}
    return {"obra": dados["obra"], "pavimentos": [{
        "id": "terreo", "revisao": revisao, "sha256": "abc", "pagina_pt": [1000.0, 500.0],
        "recorte_pt": [0.0, 0.0, 1000.0, 500.0],
        "imagens": {"planta": {"largura": 200, "altura": 100}, "planta-hd": {"largura": 400, "altura": 200}},
        "detalhes": detalhes,
    }]}


def _seed(dados, revisao):
    return seed_mod.gerar(dados, _plantas(dados, revisao), {"slug": "teste", "nome": "Teste"})


def test_seed_desativa_planta_anterior_antes_do_insert(r02):
    linhas = _seed(r02, "R02").splitlines()
    i_update = next(i for i, linha in enumerate(linhas) if linha.startswith("update public.planta "))
    i_insert = next(i for i, linha in enumerate(linhas) if linha.startswith("insert into public.planta "))
    assert i_update < i_insert
    update = linhas[i_update]
    assert "set ativa = false" in update
    assert "p.codigo = 'terreo'" in update and "o.slug = 'teste'" in update
    assert "pl.revisao <> 'R02'" in update and "pl.ativa" in update


def test_seed_inativa_removidos_e_grava_ativo(r02):
    sql = _seed(r02, "R02")
    linhas = sql.splitlines()
    inativar = [linha for linha in linhas if linha.startswith("update public.ambiente ")]
    assert len(inativar) == 2
    assert all("set ativo = false" in linha for linha in inativar)
    assert any("a.codigo = 'terreo-copa'" in linha for linha in inativar)
    assert any("a.codigo = 'terreo-dml'" in linha for linha in inativar)
    inserts = [linha for linha in linhas if linha.startswith("insert into public.ambiente ")]
    assert len(inserts) == 3
    assert all(", ativo)" in linha and "ativo = excluded.ativo" in linha for linha in inserts)
    # Inativação depois do upsert dos ambientes; nada é apagado.
    assert linhas.index(inativar[0]) > linhas.index(inserts[-1])
    assert "delete " not in sql


def test_seed_sem_removidos_nao_inativa_nada(r01):
    assert "update public.ambiente " not in _seed(r01, "R01")


def test_seed_recusa_id_ativo_e_removido(r02):
    dados = copy.deepcopy(r02)
    dados["ambientes_removidos"].append({"id": "terreo-recepcao", "pavimento": "terreo",
                                         "nome_operacional": "Recepção", "revisao_ultima": "R01"})
    with pytest.raises(ValueError, match="terreo-recepcao"):
        _seed(dados, "R02")
