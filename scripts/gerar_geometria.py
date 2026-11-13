"""Liga cada ambiente da obra a um IfcSpace e grava a geometria no referencial do ARQ.frag.

Entradas (por obra, ``data/<slug>/``): ``ambientes.json`` (marcadores normalizados 0–1 na página
do PDF e área em m²), ``plantas.json`` (tamanho da página em pontos PDF) e ``obra.json`` (chave
``ra``: inventário do IFC, pavimento do app → pavimento do IFC, calibração PDF→IFC por pavimento,
transformação IFC→frag, referencial, piso acabado e pé-direito). Contrato: ``docs/contrato-ra.md``.

Saídas: ``data/<slug>/geometria.json`` e ``supabase/seed/<slug>_geometria.sql`` (transacional e
idempotente). Não escreve nada em ``DOCS <SIGLA>/`` nem em ``artifacts/``.

Como o vínculo é feito
----------------------
1. O marcador do ambiente (centro do rótulo, topo do nome) vai de coordenadas normalizadas para
   pontos PDF (``x × largura``, ``y × altura``) e daí para o IFC pela calibração do pavimento.
2. Candidatos: IfcSpaces do mesmo pavimento cujo polígono contém o ponto ou que estão a menos de
   ``tolerancia_marcador_m`` (o marcador fica no topo do nome e pode cair um pouco fora).
3. O vínculo só vale se a área confere: ``|área do ambiente − área do espaço| ≤ max(0,05 m², 1%)``.
   Entre os candidatos de área compatível vale o mais próximo (contido = distância 0).
4. Ambiente com dois marcadores: os dois têm de dar o mesmo espaço; senão vai para ``sem_vinculo``.
5. Um IfcSpace ligado a dois ambientes: os dois vão para ``sem_vinculo``. Nada é forçado.

Calibração do 1º pavimento
--------------------------
Não há calibração documentada. ``derivar_calibracao`` a deduz (ver a função): mesma escala e troca
de eixos do térreo, deslocamentos por votação entre pares (marcador, centróide do espaço) de área
única e igual, refinados por mínimos quadrados. A calibração achada é gravada em ``calibracao`` de
``geometria.json``. Se a votação não tiver maioria nítida, o script falha.

Contorno
--------
Polígono (anel externo; furos são ignorados e avisados no resumo) do IfcSpace levado ao referencial do frag (fórmulas do contrato), sem repetir o primeiro
ponto, simplificado com tolerância de 1 cm (Douglas-Peucker + remoção de colineares), 4 casas
decimais. Sentido adotado: área com sinal pela fórmula do laço em (x, z) POSITIVA, isto é,
anti-horário no plano matemático com x para a direita e z para cima. Visto de cima no Three.js
(z aponta para o observador, para baixo na tela) o percurso aparece no sentido horário.

Uso (na raiz do repositório)::

    python3 scripts/gerar_geometria.py --obra hto
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from gerar_seed import carregar_obra, literal  # noqa: E402

TOL_AREA_ABS_M2 = 0.05
TOL_AREA_REL = 0.01
TOL_SIMPLIFICAR_M = 0.01
CASAS = 4
# Votação do 1º pavimento
TOL_AREA_UNICA_M2 = 0.02
RAIO_VOTO_PT = 25.0        # vizinhança de um voto (≈ 1,1 m): cobre a imprecisão do marcador
MIN_PARES = 5


# ---------------------------------------------------------------- geometria básica

def area_laco(pts: list[list[float]]) -> float:
    """Área com sinal pela fórmula do laço (positiva = anti-horário no plano dos dois eixos)."""
    n = len(pts)
    return 0.5 * sum(pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1] for i in range(n))


def ponto_em_poligono(p, poly) -> bool:
    x, y = p
    dentro = False
    n = len(poly)
    for k in range(n):
        x1, y1 = poly[k]
        x2, y2 = poly[(k + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            dentro = not dentro
    return dentro


def dist_ponto_segmento(p, a, b) -> float:
    dx, dy = b[0] - a[0], b[1] - a[1]
    d2 = dx * dx + dy * dy
    t = 0.0 if d2 == 0 else max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / d2))
    return math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))


def distancia_ao_poligono(p, poly) -> float:
    """0 se o ponto está dentro; senão a distância até a borda."""
    if ponto_em_poligono(p, poly):
        return 0.0
    n = len(poly)
    return min(dist_ponto_segmento(p, poly[k], poly[(k + 1) % n]) for k in range(n))


def centroide(poly) -> tuple[float, float]:
    a2 = 0.0
    cx = cy = 0.0
    n = len(poly)
    for k in range(n):
        x1, y1 = poly[k]
        x2, y2 = poly[(k + 1) % n]
        c = x1 * y2 - x2 * y1
        a2 += c
        cx += (x1 + x2) * c
        cy += (y1 + y2) * c
    return cx / (3 * a2), cy / (3 * a2)


def sem_fechamento(anel: list) -> list[list[float]]:
    """Anel GeoJSON sem o ponto final repetido."""
    pts = [list(map(float, p[:2])) for p in anel]
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    return pts


def _douglas_peucker(pts: list, tol: float) -> list:
    """Douglas-Peucker em polilinha aberta; mantém os extremos."""
    if len(pts) < 3:
        return list(pts)
    a, b = pts[0], pts[-1]
    idx, dmax = 0, -1.0
    for i in range(1, len(pts) - 1):
        d = dist_ponto_segmento(pts[i], a, b)
        if d > dmax:
            idx, dmax = i, d
    if dmax <= tol:
        return [a, b]
    return _douglas_peucker(pts[: idx + 1], tol)[:-1] + _douglas_peucker(pts[idx:], tol)


def simplificar_anel(pts: list[list[float]], tol: float = TOL_SIMPLIFICAR_M) -> list[list[float]]:
    """Simplifica um anel fechado (sem repetir o primeiro ponto): Douglas-Peucker + colineares.

    O anel é cortado em dois pontos extremos (o mais distante do primeiro e o mais distante deste),
    que nunca são removidos como colineares de verdade; depois um laço remove vértices a menos de
    ``tol`` da reta entre os vizinhos (colineares e arcos discretizados) até estabilizar.
    """
    unicos: list[list[float]] = []
    for p in pts:
        if not unicos or math.hypot(p[0] - unicos[-1][0], p[1] - unicos[-1][1]) > 1e-9:
            unicos.append(p)
    if len(unicos) > 1 and math.hypot(unicos[0][0] - unicos[-1][0], unicos[0][1] - unicos[-1][1]) <= 1e-9:
        unicos.pop()
    if len(unicos) <= 3:
        return unicos
    i1 = max(range(len(unicos)), key=lambda i: math.hypot(unicos[i][0] - unicos[0][0], unicos[i][1] - unicos[0][1]))
    i2 = max(range(len(unicos)), key=lambda i: math.hypot(unicos[i][0] - unicos[i1][0], unicos[i][1] - unicos[i1][1]))
    a, b = sorted((i1, i2))
    lado1 = unicos[a: b + 1]
    lado2 = unicos[b:] + unicos[: a + 1]
    anel = _douglas_peucker(lado1, tol)[:-1] + _douglas_peucker(lado2, tol)[:-1]
    mudou = True
    while mudou and len(anel) > 3:
        mudou = False
        for i in range(len(anel)):
            ant, prox = anel[i - 1], anel[(i + 1) % len(anel)]
            if dist_ponto_segmento(anel[i], ant, prox) <= tol:
                del anel[i]
                mudou = True
                break
    return anel


# ---------------------------------------------------------------- transformações

def ifc_para_pdf(cal: dict, ix: float, iy: float) -> tuple[float, float]:
    """IFC (m) → ponto PDF: pdf_x = escala·iy + tx ; pdf_y = escala·ix + ty."""
    return cal["escala"] * iy + cal["tx"], cal["escala"] * ix + cal["ty"]


def pdf_para_ifc(cal: dict, px: float, py: float) -> tuple[float, float]:
    return (py - cal["ty"]) / cal["escala"], (px - cal["tx"]) / cal["escala"]


def ifc_para_frag(t: dict, ix: float, iy: float, iz: float = 0.0) -> tuple[float, float, float]:
    """IFC → referencial do ARQ.frag (contrato): frag_x = −u, frag_z = v, frag_y = iz + dy."""
    c, s = math.cos(t["theta"]), math.sin(t["theta"])
    u = c * (ix - t["tx"]) + s * (iy - t["ty"])
    v = -s * (ix - t["tx"]) + c * (iy - t["ty"])
    return -u, iz + t["dy"], v


def frag_para_ifc(t: dict, x: float, z: float) -> tuple[float, float]:
    """Inversa de `ifc_para_frag` no plano: (frag_x, frag_z) → (ix, iy)."""
    c, s = math.cos(t["theta"]), math.sin(t["theta"])
    u, v = -x, z
    return t["tx"] + c * u - s * v, t["ty"] + s * u + c * v


def contorno_pagina(contorno: list, t: dict, cal: dict, pagina_pt: tuple[float, float]) -> list[list[float]]:
    """Cantos do contorno (mesma ordem) como [x, y] normalizados de 0 a 1 na página da planta."""
    saida = []
    for x, z in contorno:
        px, py = ifc_para_pdf(cal, *frag_para_ifc(t, x, z))
        saida.append([round(px / pagina_pt[0], 5), round(py / pagina_pt[1], 5)])
    return saida


def contorno_frag(anel_ifc: list, t: dict) -> list[list[float]]:
    """Contorno [[x, z], ...] anti-horário (área do laço > 0), simplificado, 4 casas, sem fechar."""
    pts = [list(ifc_para_frag(t, p[0], p[1])[0::2]) for p in sem_fechamento(anel_ifc)]
    pts = simplificar_anel(pts)
    if area_laco(pts) < 0:
        pts.reverse()
    return [[round(x, CASAS), round(z, CASAS)] for x, z in pts]


# ---------------------------------------------------------------- calibração do 1º pavimento

def pares_de_votacao(marcadores_pt: dict, espacos: list[dict], areas_amb: dict) -> list[tuple]:
    """Pares (código, deslocamento tx, ty) com área única e igual (tolerância 0,02 m²).

    ``marcadores_pt``: código → (px, py) de ambientes com UM marcador e área conhecida.
    ``espacos``: lista com ``area`` e ``centro`` (ix, iy). ``areas_amb``: código → área.
    O deslocamento sai de ``tx = px − escala·cy`` e ``ty = py − escala·cx`` (escala aplicada fora).
    """
    pares = []
    for cod, (px, py) in marcadores_pt.items():
        a = areas_amb[cod]
        outros = [c for c, b in areas_amb.items() if abs(b - a) <= TOL_AREA_UNICA_M2]
        cand = [s for s in espacos if abs(s["area"] - a) <= TOL_AREA_UNICA_M2]
        if len(outros) == 1 and len(cand) == 1:
            pares.append((cod, px, py, cand[0]["centro"]))
    return pares


def derivar_calibracao(marcadores_pt: dict, espacos: list[dict], areas_amb: dict, escala: float,
                       vies_pt: tuple[float, float] = (0.0, 0.0)) -> dict:
    """Deriva a calibração PDF→IFC de um pavimento sem calibração documentada.

    Hipóteses: escala e troca de eixos iguais às do térreo (1:125; pdf_x ~ ifc_y, pdf_y ~ ifc_x).
    Só os deslocamentos (tx, ty) são incógnitas.

    1. Pares: ambiente com um marcador e área única no pavimento × IfcSpace de área única e igual
       (|Δ| ≤ 0,02 m²). Cada par vota um deslocamento ``tx = px − escala·cy``, ``ty = py − escala·cx``,
       com (cx, cy) o centróide do espaço e ``vies_pt`` descontado (o marcador está no topo do nome,
       não no centróide: o viés do rótulo é medido num pavimento já calibrado).
    2. Votação: o voto com mais vizinhos a menos de 25 pt (≈ 1,1 m) vence. Exige ao menos 5 votos
       vizinhos e maioria nítida: o vencedor precisa ter mais da metade dos pares e pelo menos o
       dobro dos votos do melhor grupo concorrente (fora da vizinhança do vencedor).
    3. Refinamento: os pares concordantes (votos a menos de 25 pt da estimativa) ajustam os
       deslocamentos com a escala fixa. A média (mínimos quadrados puros) é puxada pelos rótulos
       grandes, que ficam longe do centróide; por isso o ajuste usa a mediana por eixo (mínimos
       desvios absolutos), repetida até estabilizar. No térreo isso reproduz a calibração
       documentada a menos de 1 ponto PDF (a média daria cerca de 1,1 pt).

    Falha com ``ValueError`` se não houver maioria nítida. Devolve ``{escala, tx, ty, pares,
    concordantes, rms_pt}``.
    """
    votos = []
    for cod, px, py, (cx, cy) in pares_de_votacao(marcadores_pt, espacos, areas_amb):
        votos.append((cod, px - vies_pt[0] - escala * cy, py - vies_pt[1] - escala * cx))
    if len(votos) < MIN_PARES:
        raise ValueError(f"calibração: só {len(votos)} pares de área única (mínimo {MIN_PARES})")

    def vizinhos(centro, lista):
        return [v for v in lista if math.hypot(v[1] - centro[0], v[2] - centro[1]) <= RAIO_VOTO_PT]

    melhor = max(votos, key=lambda v: len(vizinhos((v[1], v[2]), votos)))
    grupo = vizinhos((melhor[1], melhor[2]), votos)
    if len(grupo) < MIN_PARES or len(grupo) * 2 <= len(votos):
        raise ValueError(f"calibração: sem maioria nítida ({len(grupo)} de {len(votos)} votos concordam)")
    fora = [v for v in votos if math.hypot(v[1] - melhor[1], v[2] - melhor[2]) > 2 * RAIO_VOTO_PT]
    if fora:
        rival = max(len(vizinhos((v[1], v[2]), fora)) for v in fora)
        if rival * 2 > len(grupo):
            raise ValueError(f"calibração: maioria não nítida (melhor grupo {len(grupo)}, rival {rival})")

    mediana = lambda l: sorted(l)[len(l) // 2] if len(l) % 2 else sum(sorted(l)[len(l) // 2 - 1: len(l) // 2 + 1]) / 2
    tx, ty = mediana([v[1] for v in grupo]), mediana([v[2] for v in grupo])
    inliers = grupo
    for _ in range(50):
        inliers = [v for v in votos if math.hypot(v[1] - tx, v[2] - ty) <= RAIO_VOTO_PT]
        if len(inliers) < MIN_PARES:
            raise ValueError("calibração: poucos pares concordantes no refinamento")
        ntx, nty = mediana([v[1] for v in inliers]), mediana([v[2] for v in inliers])
        if math.hypot(ntx - tx, nty - ty) < 1e-9:
            break
        tx, ty = ntx, nty
    rms = math.sqrt(sum((v[1] - tx) ** 2 + (v[2] - ty) ** 2 for v in inliers) / len(inliers))
    return {"escala": escala, "tx": round(tx, 3), "ty": round(ty, 3), "pares": len(votos),
            "concordantes": len(inliers), "rms_pt": round(rms, 2)}


def medir_vies_marcador(marcadores_pt: dict, espacos_por_cod: dict, cal: dict) -> tuple[float, float]:
    """Mediana de (marcador − centróide projetado em pontos PDF) num pavimento calibrado.

    Mede o quanto o marcador (topo do nome) fica afastado do centróide do espaço.
    """
    dx, dy = [], []
    for cod, (px, py) in marcadores_pt.items():
        ex = espacos_por_cod.get(cod)
        if ex is None:
            continue
        qx, qy = ifc_para_pdf(cal, *ex["centro"])
        dx.append(px - qx)
        dy.append(py - qy)
    if not dx:
        return 0.0, 0.0
    dx.sort()
    dy.sort()
    m = len(dx) // 2
    med = lambda l: l[m] if len(l) % 2 else (l[m - 1] + l[m]) / 2
    return med(dx), med(dy)


# ---------------------------------------------------------------- vínculo

def area_confere(a: float | None, b: float) -> bool:
    return a is not None and abs(a - b) <= max(TOL_AREA_ABS_M2, TOL_AREA_REL * a)


def carregar_espacos(inventario: dict, nomes_ifc: list[str]) -> list[dict]:
    """IfcSpaces dos pavimentos IFC dados, com anel externo, área, centro e zmin."""
    saida = []
    for s in inventario["spaces"]:
        if s["parent"]["name"] not in nomes_ifc:
            continue
        anel = sem_fechamento(s["footprint_world_xy_m"]["coordinates"][0])
        saida.append({
            "guid": s["guid"], "name": s["name"], "anel": anel, "area": s["footprint_area_m2"],
            "centro": centroide(anel), "zmin": s["bbox_world_m"][0][2],
            "furos_m2": sum(abs(area_laco(sem_fechamento(r))) for r in s["footprint_world_xy_m"]["coordinates"][1:]),
        })
    return saida


def vincular(amb: dict, espacos: list[dict], cal: dict, pagina_pt: tuple[float, float], tol_m: float):
    """Devolve ``(espaco, None)`` ou ``(None, motivo)`` para um ambiente."""
    if amb["area_m2"] is None:
        return None, "sem área na planta (\"Não incluso\"): o vínculo não pode ser confirmado pela área"
    escolhidos = []
    for i, mk in enumerate(amb["marcadores"], start=1):
        px, py = mk["x"] * pagina_pt[0], mk["y"] * pagina_pt[1]
        ponto = pdf_para_ifc(cal, px, py)
        perto = []
        for s in espacos:
            d = distancia_ao_poligono(ponto, s["anel"])
            if d <= tol_m:
                perto.append((d, s))
        if not perto:
            mesma = sorted(((distancia_ao_poligono(ponto, s["anel"]), s) for s in espacos
                            if area_confere(amb["area_m2"], s["area"])), key=lambda p: p[0])
            dica = ""
            if mesma and mesma[0][0] <= 5 * tol_m:
                dica = (f"; o IfcSpace '{mesma[0][1]['name']}' de mesma área ({mesma[0][1]['area']:.2f} m²) "
                        f"está a {mesma[0][0]:.2f} m — conferir à mão")
            return None, f"marcador {i} sem IfcSpace do pavimento a menos de {tol_m:g} m{dica}"
        ok = sorted((p for p in perto if area_confere(amb["area_m2"], p[1]["area"])), key=lambda p: p[0])
        if not ok:
            vistos = ", ".join(f"'{s['name']}' ({s['area']:.2f} m²)" for _, s in sorted(perto, key=lambda p: p[0]))
            return None, (f"marcador {i}: área do ambiente {amb['area_m2']:.2f} m² não confere com "
                          f"os IfcSpaces próximos: {vistos}")
        if len(ok) > 1 and abs(ok[1][0] - ok[0][0]) < 0.01:
            return None, f"marcador {i} ambíguo entre os IfcSpaces '{ok[0][1]['name']}' e '{ok[1][1]['name']}'"
        escolhidos.append(ok[0][1])
    guids = {s["guid"] for s in escolhidos}
    if len(guids) > 1:
        nomes = ", ".join(f"'{s['name']}'" for s in escolhidos)
        return None, f"os {len(escolhidos)} marcadores caem em IfcSpaces diferentes ({nomes}); vínculo não definido"
    return escolhidos[0], None


# ---------------------------------------------------------------- orquestração

def _ler(caminho: Path) -> dict:
    return json.loads(caminho.read_text(encoding="utf-8"))


def calcular(slug: str, dados: dict | None = None, plantas: dict | None = None,
             obra: dict | None = None, inventario: dict | None = None) -> tuple[dict, dict]:
    """Calcula ``geometria.json`` (dict) e o resumo. Não escreve nada."""
    obra = obra or carregar_obra(slug)
    ra = obra.get("ra")
    if not ra:
        raise SystemExit(f"data/{slug}/obra.json sem a chave 'ra'")
    base = ROOT / "data" / slug
    dados = dados or _ler(base / "ambientes.json")
    plantas = plantas or _ler(base / "plantas.json")
    inventario = inventario or _ler(ROOT / ra["inventario_ifc"])
    pag = {p["id"]: tuple(p["pagina_pt"]) for p in plantas["pavimentos"]}
    t, tol_m = ra["ifc_para_frag"], ra.get("tolerancia_marcador_m", 1.0)

    # espaços e calibração por pavimento (documentada primeiro; derivada para o que faltar)
    espacos = {p: carregar_espacos(inventario, cfg["ifc"]) for p, cfg in ra["pavimentos"].items()}
    cals: dict[str, dict] = {}
    cal_saida: dict[str, dict] = {}
    por_pav: dict[str, list[dict]] = {}
    for amb in dados["ambientes"]:
        por_pav.setdefault(amb["pavimento"], []).append(amb)

    def marcadores_unicos(pav):
        return {a["id"]: (a["marcadores"][0]["x"] * pag[pav][0], a["marcadores"][0]["y"] * pag[pav][1])
                for a in por_pav.get(pav, []) if len(a["marcadores"]) == 1 and a["area_m2"] is not None}

    def areas(pav):
        return {a["id"]: a["area_m2"] for a in por_pav.get(pav, []) if a["area_m2"] is not None}

    vies = (0.0, 0.0)
    for pav, cfg in ra["pavimentos"].items():
        if cfg.get("calibracao"):
            cals[pav] = cfg["calibracao"]
            cal_saida[pav] = {**cfg["calibracao"], "origem": "documentada"}
            if vies == (0.0, 0.0):
                vies = _vies_de_referencia(cals[pav], espacos[pav], marcadores_unicos(pav), areas(pav))
    for pav, cfg in ra["pavimentos"].items():
        if pav in cals:
            continue
        escala = next(c["escala"] for c in cals.values())
        try:
            d = derivar_calibracao(marcadores_unicos(pav), espacos[pav], areas(pav), escala, vies)
        except ValueError as e:
            raise SystemExit(f"{pav}: {e}")
        cals[pav] = {"escala": d["escala"], "tx": d["tx"], "ty": d["ty"]}
        cal_saida[pav] = {**d, "origem": "derivada", "vies_marcador_pt": [round(vies[0], 2), round(vies[1], 2)]}

    # vínculo
    ligados: dict[str, tuple[dict, dict]] = {}   # código → (ambiente, espaço)
    sem_vinculo: list[dict] = []
    for amb in dados["ambientes"]:
        pav = amb["pavimento"]
        if pav not in cals:
            sem_vinculo.append({"codigo": amb["id"], "motivo": f"pavimento '{pav}' sem configuração em ra.pavimentos"})
            continue
        esp, motivo = vincular(amb, espacos[pav], cals[pav], pag[pav], tol_m)
        if esp is None:
            sem_vinculo.append({"codigo": amb["id"], "motivo": motivo})
        else:
            ligados[amb["id"]] = (amb, esp)
    por_guid: dict[str, list[str]] = {}
    for cod, (_, esp) in ligados.items():
        por_guid.setdefault(esp["guid"], []).append(cod)
    for guid, cods in por_guid.items():
        if len(cods) > 1:
            for cod in cods:
                del ligados[cod]
                sem_vinculo.append({"codigo": cod, "motivo": f"IfcSpace {guid} ligado a mais de um ambiente: {', '.join(sorted(cods))}"})

    ambientes: dict[str, dict] = {}
    com_furo: dict[str, float] = {}
    for amb in dados["ambientes"]:
        if amb["id"] not in ligados:
            continue
        _, esp = ligados[amb["id"]]
        contorno = contorno_frag(esp["anel"], t)
        if esp["furos_m2"] > 0:
            com_furo[amb["id"]] = round(esp["furos_m2"], 2)
        piso = esp["zmin"] + ra["piso_acabado_m"]
        y_piso = round(ifc_para_frag(t, 0, 0, piso)[1], CASAS)
        y_teto = round(ifc_para_frag(t, 0, 0, piso + ra["pe_direito_m"])[1], CASAS)
        ambientes[amb["id"]] = {"guid": esp["guid"], "contorno": contorno,
                                "contorno_pagina": contorno_pagina(contorno, t, cals[amb["pavimento"]], pag[amb["pavimento"]]),
                                "y_piso": y_piso, "y_teto": y_teto,
                                "area_m2": round(abs(area_laco(contorno)), 2)}
    ref = ra["referencial"]
    geo = {
        "obra": slug,
        "referencial": {"sigla": ref["sigla"], "revisao": ref["revisao"], "coordenadas": ref["coordenadas"]},
        "calibracao": cal_saida,
        "ambientes": ambientes,
        "sem_vinculo": sorted(sem_vinculo, key=lambda s: s["codigo"]),
    }
    return geo, {"total_por_pav": {p: len(v) for p, v in por_pav.items()}, "com_furo": com_furo}


def _vies_de_referencia(cal, espacos, marcadores, areas_amb) -> tuple[float, float]:
    """Viés do rótulo medido num pavimento calibrado, nos pares de área única."""
    pares = pares_de_votacao(marcadores, espacos, areas_amb)
    return medir_vies_marcador({c: (px, py) for c, px, py, _ in pares}, {c: {"centro": ct} for c, _, _, ct in pares}, cal)


def gerar_sql(geo: dict) -> str:
    slug = geo["obra"]
    ref = geo["referencial"]
    linhas = [
        f"-- Gerado por scripts/gerar_geometria.py a partir de data/{slug}/geometria.json — não editar à mão",
        "",
        "begin;",
        "",
        "insert into public.ra_referencial (obra_id, sigla, revisao, coordenadas) "
        f"select o.id, {literal(ref['sigla'])}, {literal(ref['revisao'])}, {literal(ref['coordenadas'])} "
        f"from public.obra o where o.slug = {literal(slug)} "
        "on conflict (obra_id) do update set sigla = excluded.sigla, revisao = excluded.revisao, "
        "coordenadas = excluded.coordenadas, atualizado_em = now();",
        "",
    ]
    for cod, g in geo["ambientes"].items():
        linhas.append(
            "insert into public.ambiente_geometria (ambiente_id, guid, contorno, contorno_pagina, y_piso, y_teto, origem) "
            f"select a.id, {literal(g['guid'])}, {literal(g['contorno'])}, {literal(g['contorno_pagina'])}, {literal(g['y_piso'])}, "
            f"{literal(g['y_teto'])}, 'ifcspace' "
            "from public.obra o join public.ambiente a on a.obra_id = o.id "
            f"and a.codigo = {literal(cod)} where o.slug = {literal(slug)} "
            "on conflict (ambiente_id) do update set guid = excluded.guid, contorno = excluded.contorno, contorno_pagina = excluded.contorno_pagina, "
            "y_piso = excluded.y_piso, y_teto = excluded.y_teto, origem = excluded.origem, "
            "atualizado_em = now();"
        )
    lista = ", ".join(literal(c) for c in geo["ambientes"])
    linhas += [
        "",
        "delete from public.ambiente_geometria g using public.ambiente a, public.obra o "
        f"where g.ambiente_id = a.id and a.obra_id = o.id and o.slug = {literal(slug)} "
        f"and a.codigo <> all (array[{lista}]::text[]);",
        "",
        "commit;",
        "",
    ]
    return "\n".join(linhas)


def serializar(geo: dict) -> str:
    return json.dumps(geo, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Gera a geometria dos ambientes para a RA.")
    ap.add_argument("--obra", required=True, help="slug da obra (pasta data/<slug>/ com obra.json)")
    args = ap.parse_args(argv)
    try:
        obra = carregar_obra(args.obra)
    except (ValueError, FileNotFoundError) as e:
        raise SystemExit(str(e))
    geo, info = calcular(obra["slug"], obra=obra)
    base = ROOT / "data" / obra["slug"]
    (base / "geometria.json").write_text(serializar(geo), encoding="utf-8")
    saida = ROOT / "supabase" / "seed" / f"{obra['slug']}_geometria.sql"
    saida.parent.mkdir(parents=True, exist_ok=True)
    saida.write_text(gerar_sql(geo), encoding="utf-8")

    dados = _ler(base / "ambientes.json")
    pav_de = {a["id"]: a["pavimento"] for a in dados["ambientes"]}
    for pav, total in info["total_por_pav"].items():
        n = sum(1 for c in geo["ambientes"] if pav_de[c] == pav)
        print(f"{pav}: {n} de {total} ambientes vinculados")
    for pav, c in geo["calibracao"].items():
        extra = f" ({c['concordantes']} de {c['pares']} pares, rms {c['rms_pt']} pt)" if c["origem"] == "derivada" else ""
        print(f"calibração {pav} [{c['origem']}]: escala {c['escala']}, tx {c['tx']}, ty {c['ty']}{extra}")
    for cod, m2 in info["com_furo"].items():
        print(f"Atenção: {cod} tem furo de {m2} m² no IfcSpace; o contorno usa só o anel externo (área do contorno > área da planta)")
    print(f"Sem vínculo: {len(geo['sem_vinculo'])}")
    for s in geo["sem_vinculo"]:
        print(f"  - {s['codigo']}: {s['motivo']}")
    print(f"Gerado: {(base / 'geometria.json').relative_to(ROOT)}")
    print(f"Gerado: {saida.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
