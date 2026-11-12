"""scripts/gerar_geometria.py: vínculo ambiente ↔ IfcSpace e geometria no referencial do ARQ.frag."""
import importlib.util
import json
import math
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))


def _carregar(nome, rel):
    spec = importlib.util.spec_from_file_location(nome, ROOT / rel)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


mod = _carregar("gerar_geometria", "scripts/gerar_geometria.py")

INVENTARIO = ROOT / "artifacts/validation/ifc/CE01-14PE01-ARQ-R05-inspection.json"
pytestmark = pytest.mark.skipif(not INVENTARIO.exists(), reason="inventário do IFC ausente")

DADOS = json.loads((ROOT / "data/hto/ambientes.json").read_text(encoding="utf-8"))
AMB = {a["id"]: a for a in DADOS["ambientes"]}
GEO, _INFO = mod.calcular("hto")
SQL = mod.gerar_sql(GEO)


def _lado(p, q):
    return math.hypot(p[0] - q[0], p[1] - q[1])


def test_apto_101_liga_ao_guid_e_tem_contorno_retangular():
    g = GEO["ambientes"]["terreo-apto-101"]
    assert g["guid"] == "0vfo$Cu9vBkhdNguKiGtzT"
    c = g["contorno"]
    assert len(c) == 4
    lados = sorted(_lado(c[i], c[(i + 1) % 4]) for i in range(4))
    assert lados[0] == pytest.approx(3.96, abs=0.01) and lados[1] == pytest.approx(3.96, abs=0.01)
    assert lados[2] == pytest.approx(6.03, abs=0.01) and lados[3] == pytest.approx(6.03, abs=0.01)
    assert g["area_m2"] == pytest.approx(23.88, abs=0.01)
    assert g["y_piso"] == pytest.approx(-0.805, abs=1e-9)
    assert g["y_teto"] == pytest.approx(1.795, abs=1e-9)


def test_banheiro_101_liga_ao_guid():
    assert GEO["ambientes"]["terreo-banheiro-101"]["guid"] == "08arOxA3r6oAwA$PXqJ0ly"


def test_transformacao_ifc_para_frag_do_contrato():
    t = json.loads((ROOT / "data/hto/obra.json").read_text(encoding="utf-8"))["ra"]["ifc_para_frag"]
    ix, iy = 191.01668699387676, 298.0742746757135
    # cálculo independente, direto das fórmulas do contrato
    th, tx, ty = -0.016167004574873148, 197.0365965562527, 333.84178410152947
    u = math.cos(th) * (ix - tx) + math.sin(th) * (iy - ty)
    v = -math.sin(th) * (ix - tx) + math.cos(th) * (iy - ty)
    fx, fy, fz = mod.ifc_para_frag(t, ix, iy, 0.5)
    assert fx == pytest.approx(-u, abs=1e-9)
    assert fz == pytest.approx(v, abs=1e-9)
    assert fy == pytest.approx(0.5 - 1.19, abs=1e-12)


def test_nenhum_guid_repetido():
    guids = [g["guid"] for g in GEO["ambientes"].values()]
    assert len(guids) == len(set(guids))


def test_contornos_validos_e_area_confere_com_a_planta():
    for cod, g in GEO["ambientes"].items():
        c = g["contorno"]
        assert len(c) >= 3, cod
        assert c[0] != c[-1], cod
        area = mod.area_laco(c)
        assert area > 0, f"{cod}: contorno fora do sentido adotado"
        # o contorno é só o anel externo: soma-se o furo (se houver) à área da planta
        esperada = AMB[cod]["area_m2"] + _INFO["com_furo"].get(cod, 0.0)
        assert abs(area) == pytest.approx(esperada, rel=0.02), cod
        assert g["y_teto"] - g["y_piso"] == pytest.approx(2.6, abs=1e-9), cod


def test_ambientes_com_furo_no_ifcspace():
    assert sorted(_INFO["com_furo"]) == ["1pav-circulacao", "terreo-lobby"]


def test_vestiario_masculino_arco_simplificado():
    # o arco discretizado (114 vértices no IFC) vira poucos pontos com tolerância de 1 cm
    inv = json.loads(INVENTARIO.read_text(encoding="utf-8"))
    sp = next(s for s in inv["spaces"] if s["guid"] == "1X$_tLf0fF9e27wM7c9tiD")
    bruto = len(sp["footprint_world_xy_m"]["coordinates"][0]) - 1
    t = json.loads((ROOT / "data/hto/obra.json").read_text(encoding="utf-8"))["ra"]["ifc_para_frag"]
    simples = mod.contorno_frag(sp["footprint_world_xy_m"]["coordinates"][0], t)
    assert len(simples) < bruto / 2
    assert mod.area_laco(simples) == pytest.approx(sp["footprint_area_m2"], rel=0.005)


def test_ao_menos_80_por_cento_vinculados_por_pavimento():
    for pav in ("terreo", "1pav"):
        todos = [a["id"] for a in DADOS["ambientes"] if a["pavimento"] == pav]
        ligados = [c for c in todos if c in GEO["ambientes"]]
        assert len(ligados) / len(todos) >= 0.8, pav


def test_sem_vinculo_tem_codigo_e_motivo_e_nao_cruza_com_vinculados():
    for s in GEO["sem_vinculo"]:
        assert s["codigo"] in AMB and s["motivo"]
        assert s["codigo"] not in GEO["ambientes"]
    assert len(GEO["ambientes"]) + len(GEO["sem_vinculo"]) == len(DADOS["ambientes"])


def test_calibracao_derivada_reproduz_a_documentada_no_terreo():
    ra = json.loads((ROOT / "data/hto/obra.json").read_text(encoding="utf-8"))["ra"]
    doc = ra["pavimentos"]["terreo"]["calibracao"]
    inv = json.loads(INVENTARIO.read_text(encoding="utf-8"))
    pl = {p["id"]: p["pagina_pt"] for p in json.loads((ROOT / "data/hto/plantas.json").read_text(encoding="utf-8"))["pavimentos"]}
    w, h = pl["terreo"]
    esp = mod.carregar_espacos(inv, ra["pavimentos"]["terreo"]["ifc"])
    amb = [a for a in DADOS["ambientes"] if a["pavimento"] == "terreo"]
    pm = {a["id"]: (a["marcadores"][0]["x"] * w, a["marcadores"][0]["y"] * h)
          for a in amb if len(a["marcadores"]) == 1 and a["area_m2"] is not None}
    areas = {a["id"]: a["area_m2"] for a in amb if a["area_m2"] is not None}
    vies = mod._vies_de_referencia(doc, esp, pm, areas)
    d = mod.derivar_calibracao(pm, esp, areas, doc["escala"], vies)
    assert math.hypot(d["tx"] - doc["tx"], d["ty"] - doc["ty"]) < 1.0


def test_calibracao_sem_maioria_nitida_falha():
    esp = [{"area": 10.0 + i, "centro": (float(i), float(i))} for i in range(8)]
    areas = {f"a{i}": 10.0 + i for i in range(8)}
    # marcadores espalhados: cada par vota um deslocamento diferente
    pm = {f"a{i}": (i * 500.0, i * 900.0) for i in range(8)}
    with pytest.raises(ValueError, match="maioria"):
        mod.derivar_calibracao(pm, esp, areas, 22.68)


def test_calibracao_do_primeiro_pavimento_gravada():
    c = GEO["calibracao"]["1pav"]
    assert c["origem"] == "derivada" and c["concordantes"] >= 10
    assert c["escala"] == pytest.approx(22.677821011674272)
    assert GEO["calibracao"]["terreo"]["origem"] == "documentada"


def test_seed_tem_uma_linha_por_ambiente_vinculado_e_e_deterministico():
    linhas = SQL.splitlines()
    assert sum(l.startswith("insert into public.ambiente_geometria ") for l in linhas) == len(GEO["ambientes"])
    assert sum(l.startswith("insert into public.ra_referencial ") for l in linhas) == 1
    assert "\nbegin;\n" in SQL and SQL.rstrip("\n").endswith("commit;") and SQL.endswith("\n")
    assert "on conflict (ambiente_id) do update" in SQL
    assert "delete from public.ambiente_geometria" in SQL
    geo2, _ = mod.calcular("hto")
    assert mod.gerar_sql(geo2) == SQL


def test_arquivos_commitados_estao_atualizados():
    assert (ROOT / "data/hto/geometria.json").read_text(encoding="utf-8") == mod.serializar(GEO), \
        "rode python3 scripts/gerar_geometria.py --obra hto"
    assert (ROOT / "supabase/seed/hto_geometria.sql").read_text(encoding="utf-8") == SQL
