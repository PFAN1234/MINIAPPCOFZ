"""Extrai os ambientes de uma obra a partir dos rótulos das plantas de arquitetura.

Fonte: os PDFs listados em ``data/<slug>/obra.json`` (pasta ``DOCS <SIGLA>/PDF/``,
somente leitura), lidos com o PyMuPDF. Cada ambiente da planta tem o nome com a
área logo abaixo ("APTO. 101" / "A=23.88 m²"). A área é usada como âncora e o
nome é o span imediatamente acima dela. O pavimento de cada PDF, a revisão, as
abreviações, as categorias, os nomes definidos na revisão humana, os ambientes
sem rótulo acrescentados à mão (``ambientes_manuais``) e o ``status`` vêm da
configuração da obra.

Saída: ``data/<slug>/ambientes.json``. A lista exige revisão humana antes de virar
cadastro; os casos duvidosos aparecem em ``revisar``.

Revisões da planta: se ``ambientes.json`` já existir, ele é lido antes de ser
sobrescrito e serve de base. O código (id) de um ambiente não muda depois de
publicado: id igual ao da base é mantido; uma renomeação confirmada por humano
entra em ``manter_codigo`` (id novo calculado → id antigo) na configuração; ids
da base que somem da planta vão para ``ambientes_removidos`` (acumulativa), que o
seed usa para marcar o ambiente como inativo. As diferenças em relação à base
ficam em ``diferencas`` e são impressas no terminal.

Uso (na raiz do repositório)::

    python3 scripts/extrair_ambientes.py --obra hto
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

AREA_RE = re.compile(r"^A=\s*(?P<valor>[\d.,]+|Não incluso)\s*m²$")
REVISAO_RE = re.compile(r"-(R\d+)\.pdf$", re.I)
SLUG_RE = re.compile(r"^[a-z0-9-]+$")
STATUS_VALIDOS = {"revisado", "aguardando_revisao_humana"}

# Distâncias em pontos PDF (1/72"). Na planta, o nome fica colado acima da área:
# o bbox do nome sobrepõe a área em ~1 pt; o centro horizontal coincide.
GAP_MIN, GAP_MAX = -4.0, 8.0
DESVIO_CENTRO_MAX = 25.0

# Distâncias normalizadas na página (0–1) entre pinos de duas versões da lista.
# Acima de LIMIAR_DESLOCAMENTO o pino entra em ``diferencas.marcador_deslocado``;
# abaixo de LIMIAR_SUCESSOR um ambiente novo é sugerido como sucessor de um removido.
LIMIAR_DESLOCAMENTO = 0.01
LIMIAR_SUCESSOR = 0.03


# --- Configuração da obra ----------------------------------------------------

def caminho_obra(slug: str) -> Path:
    if not SLUG_RE.match(slug):
        raise SystemExit(f"slug inválido: {slug!r} (use letras minúsculas, dígitos e hífen)")
    return ROOT / "data" / slug / "obra.json"


def carregar_obra(slug: str) -> dict:
    """Lê e valida ``data/<slug>/obra.json``."""
    arquivo = caminho_obra(slug)
    if not arquivo.is_file():
        raise SystemExit(f"configuração não encontrada: {arquivo.relative_to(ROOT)}")
    obra = json.loads(arquivo.read_text(encoding="utf-8"))
    validar_obra(obra, slug)
    return obra


def validar_obra(obra: dict, slug: str | None = None) -> None:
    """Falha com mensagem clara se faltar campo obrigatório ou houver incoerência."""
    for campo in ("slug", "nome", "status", "revisao", "pasta_pdf", "pavimentos", "prancha"):
        if campo not in obra:
            raise SystemExit(f"obra.json sem o campo '{campo}'")
    if slug is not None and obra["slug"] != slug:
        raise SystemExit(f"obra.json com slug '{obra['slug']}', esperado '{slug}'")
    if obra["status"] not in STATUS_VALIDOS:
        raise SystemExit(f"status inválido: {obra['status']!r} (use {sorted(STATUS_VALIDOS)})")
    codigos = [p["codigo"] for p in obra["pavimentos"]]
    if len(codigos) != len(set(codigos)) or not codigos:
        raise SystemExit(f"códigos de pavimento vazios ou repetidos: {codigos}")
    for pav in obra["pavimentos"]:
        m = REVISAO_RE.search(pav["pdf"])
        if m and m.group(1).upper() != obra["revisao"].upper():
            raise SystemExit(f"PDF {pav['pdf']} é da revisão {m.group(1)}, mas obra.json diz {obra['revisao']}")
    for manual in obra.get("ambientes_manuais", []):
        for campo in ("pavimento", "nome_operacional", "categoria", "marcador"):
            if campo not in manual:
                raise SystemExit(f"ambiente manual sem o campo '{campo}': {manual}")
        if manual["pavimento"] not in codigos:
            raise SystemExit(f"ambiente manual em pavimento desconhecido: {manual['pavimento']!r}")
        x, y = manual["marcador"].get("x"), manual["marcador"].get("y")
        if not all(isinstance(v, (int, float)) and 0 <= v <= 1 for v in (x, y)):
            raise SystemExit(f"marcador do ambiente manual fora de 0–1: {manual['nome_operacional']!r}")
    manter = obra.get("manter_codigo", {})
    if not isinstance(manter, dict) or not all(
            isinstance(k, str) and isinstance(v, str) and k and v for k, v in manter.items()):
        raise SystemExit("'manter_codigo' deve ser um objeto {\"<id novo calculado>\": \"<id antigo>\"}")
    revisao_humana = obra.get("revisao_humana")
    if obra["status"] == "revisado":
        if not revisao_humana:
            raise SystemExit("status 'revisado' exige 'revisao_humana' preenchida")
        if revisao_humana.get("revisao_planta") != obra["revisao"]:
            raise SystemExit("a revisão humana foi feita em outra revisão da planta: "
                             "volte o status para 'aguardando_revisao_humana' e confira de novo")


def pavimentos_ordenados(obra: dict) -> list[dict]:
    return sorted(obra["pavimentos"], key=lambda p: p.get("ordem", 0))


# --- Leitura do PDF ----------------------------------------------------------

def spans_da_pagina(page) -> list[dict]:
    """Spans de texto da página, montados como em ``inspect_pdfs.py``.

    Cada span tem ``text`` (sem espaços nas pontas), ``bbox`` em pontos PDF
    arredondada em 3 casas, ``size`` e a ``direction`` da linha.
    """
    spans = []
    for bloco in page.get_text("dict")["blocks"]:
        for linha in bloco.get("lines", []):
            for s in linha["spans"]:
                texto = s["text"].strip()
                if not texto:
                    continue
                spans.append({
                    "text": texto,
                    "bbox": [round(v, 3) for v in s["bbox"]],
                    "size": round(s["size"], 3),
                    "direction": list(linha["dir"]),
                })
    return spans


def ler_paginas(obra: dict) -> dict[str, dict]:
    """Lê do PDF a página de cada pavimento: ``{codigo: {largura, altura, spans}}``."""
    import pymupdf  # só aqui: o resto do módulo é testável sem o PyMuPDF

    paginas = {}
    for pav in obra["pavimentos"]:
        pdf = ROOT / obra["pasta_pdf"] / pav["pdf"]
        with pymupdf.open(pdf) as doc:
            page = doc[pav.get("pagina", 1) - 1]
            paginas[pav["codigo"]] = {
                "largura": page.rect.width,
                "altura": page.rect.height,
                "spans": spans_da_pagina(page),
            }
    return paginas


# --- Regras de nome e categoria ----------------------------------------------

def centro_x(b: list[float]) -> float:
    return (b[0] + b[2]) / 2


def parse_area(texto: str) -> float | None:
    m = AREA_RE.match(texto)
    if not m:
        raise ValueError(f"rótulo de área inválido: {texto!r}")
    valor = m.group("valor")
    return None if valor == "Não incluso" else float(valor.replace(",", "."))


def nome_operacional(nome: str, nomes_fixos: dict[str, str] | None = None) -> str:
    """Nome operacional: abreviação da configuração ou regra genérica."""
    if nomes_fixos and nome in nomes_fixos:
        return nomes_fixos[nome]
    m = re.match(r"^APTO\. AUTORIDADES \((\d+)\)$", nome)
    if m:
        return f"Apto. Autoridades {m.group(1)}"
    m = re.match(r"^BHO AUT\. \((\d+)\)$", nome)
    if m:
        return f"Banheiro Autoridades {m.group(1)}"
    m = re.match(r"^APTO\. (\d+)$", nome)
    if m:
        return f"Apto. {m.group(1)}"
    m = re.match(r"^BHO (.+)$", nome)
    if m:
        resto = m.group(1)
        return f"Banheiro {resto if resto[0].isdigit() else resto[0].upper() + resto[1:].lower()}"
    return nome[0].upper() + nome[1:].lower()


def categoria(nome: str, categorias: dict[str, str] | None = None) -> str:
    """Categoria: a da configuração (por nome na planta) ou a regra genérica."""
    if categorias and nome in categorias:
        return categorias[nome]
    n = nome.upper()
    if n.startswith("APTO"):
        return "apartamento"
    if n.startswith(("BHO", "WC")):
        return "banheiro"
    if n.startswith("VEST"):
        return "vestiario"
    if n.startswith("CIRC"):
        return "circulacao"
    if n in {"JARDIM", "PISCINA"}:
        return "externa"
    if re.match(r"^(DML|DEPÓSITO|DESPENSA|CPD|LAVAND|COPA|ALOJAMENTO|ADMIN|RECEPÇÃO)", n):
        return "servico"
    return "area_comum"


def slug(texto: str) -> str:
    s = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


# --- Extração ----------------------------------------------------------------

def parear_rotulos(spans: list[dict]) -> tuple[list[dict], list[str]]:
    """Pareia cada span de área com o nome logo acima. Retorna (pares, áreas sem nome)."""
    areas = [s for s in spans if s["text"].startswith("A=")]
    candidatos_nome = [
        s for s in spans
        if not s["text"].startswith("A=") and s.get("direction", [1.0, 0.0]) == [1.0, 0.0]
    ]
    pares, orfas = [], []
    usados: set[int] = set()
    for a in areas:
        ax = centro_x(a["bbox"])
        opcoes = [
            (i, n) for i, n in enumerate(candidatos_nome)
            if GAP_MIN < a["bbox"][1] - n["bbox"][3] < GAP_MAX
            and abs(centro_x(n["bbox"]) - ax) < DESVIO_CENTRO_MAX
            and i not in usados
        ]
        if not opcoes:
            orfas.append(a["text"])
            continue
        i, n = min(opcoes, key=lambda o: abs(a["bbox"][1] - o[1]["bbox"][3]) + abs(centro_x(o[1]["bbox"]) - ax))
        usados.add(i)
        pares.append({"nome": n, "area": a})
    return pares, orfas


def _chave_renomear(pav: str, nome: str, area: float | None) -> tuple:
    return (pav, nome, None if area is None else round(float(area), 2))


def ambiente_manual(obra: dict, pav_cfg: dict, manual: dict) -> dict:
    """Ambiente sem rótulo na planta, com o pino definido à mão na configuração.

    Não tem nome na planta nem área. O ponto ``x, y`` (normalizado na página) é
    onde fica a ponta do pino; ``rotulo_bbox`` é uma caixa de tamanho zero nesse
    ponto, para os recortes de detalhe ficarem centrados nele.
    """
    x, y = round(float(manual["marcador"]["x"]), 6), round(float(manual["marcador"]["y"]), 6)
    return {
        "pavimento": pav_cfg["codigo"],
        "nome_planta": None,
        "nome_operacional": manual["nome_operacional"],
        "categoria": manual["categoria"],
        "area_m2": None,
        "pdf": f"{obra['pasta_pdf']}/{pav_cfg['pdf']}",
        "pagina": pav_cfg.get("pagina", 1),
        "revisao": obra["revisao"],
        "marcadores": [{"x": x, "y": y, "rotulo_bbox": [x, y, x, y]}],
    }


# --- Revisões: códigos estáveis e diferenças em relação à base ---------------

def ids_conhecidos(base: dict | None) -> set[str]:
    """Ids que já existiram: os ambientes da base e os removidos acumulados nela."""
    if not base:
        return set()
    return ({a["id"] for a in base.get("ambientes", [])}
            | {r["id"] for r in base.get("ambientes_removidos", [])})


def aplicar_manter_codigo(ambientes: list[dict], manter: dict[str, str], base: dict | None) -> dict[str, str]:
    """Troca o id calculado pelo id antigo indicado em ``manter_codigo``.

    Cada chave tem de ser o id calculado de um ambiente extraído e cada valor um
    id que já existiu (na base ou em ``ambientes_removidos``) no mesmo pavimento,
    sem repetição e sem colidir com o id de outro ambiente. Devolve
    ``{id mantido: id calculado}``.
    """
    if not manter:
        return {}
    if base is None:
        raise SystemExit("'manter_codigo' exige o ambientes.json anterior como base, e ele não existe")
    calculados = {a["id"] for a in ambientes}
    sem_ambiente = sorted(k for k in manter if k not in calculados)
    if sem_ambiente:
        raise SystemExit(f"'manter_codigo' sem ambiente correspondente na planta: {sem_ambiente}")
    iguais = sorted(k for k, v in manter.items() if k == v)
    if iguais:
        raise SystemExit(f"'manter_codigo' com id novo igual ao antigo (entrada desnecessária): {iguais}")
    conhecidos = ids_conhecidos(base)
    desconhecidos = sorted(v for v in manter.values() if v not in conhecidos)
    if desconhecidos:
        raise SystemExit("'manter_codigo' aponta para ids que não existem na base nem em "
                         f"'ambientes_removidos': {desconhecidos}")
    valores = list(manter.values())
    repetidos = sorted({v for v in valores if valores.count(v) > 1})
    if repetidos:
        raise SystemExit(f"'manter_codigo' com o mesmo id antigo para mais de um ambiente: {repetidos}")
    colisoes = sorted(v for v in valores if v in calculados and v not in manter)
    if colisoes:
        raise SystemExit("'manter_codigo' colide com o id de outro ambiente extraído: "
                         f"{colisoes} (esse id continua na planta com outro ambiente)")
    pav_antigo = {r["id"]: r["pavimento"] for r in base.get("ambientes_removidos", [])}
    pav_antigo.update({a["id"]: a["pavimento"] for a in base.get("ambientes", [])})
    outro_pav = sorted(f"{a['id']} -> {manter[a['id']]}" for a in ambientes
                       if a["id"] in manter and pav_antigo.get(manter[a["id"]]) != a["pavimento"])
    if outro_pav:
        raise SystemExit(f"'manter_codigo' entre pavimentos diferentes: {outro_pav}")
    herdados = {}
    for a in ambientes:
        if a["id"] in manter:
            herdados[manter[a["id"]]] = a["id"]
            a["id"] = manter[a["id"]]
    return herdados


def _resumo(a: dict) -> dict:
    """O que a comparação usa de cada ambiente."""
    return {
        "id": a["id"],
        "pavimento": a["pavimento"],
        "nome_operacional": a["nome_operacional"],
        "nome_planta": a.get("nome_planta"),
        "area_m2": a.get("area_m2"),
        "revisao": a.get("revisao"),
        "marcadores": [{"x": m["x"], "y": m["y"]} for m in a.get("marcadores", [])],
    }


def _distancia(p: dict, q: dict) -> float:
    return ((p["x"] - q["x"]) ** 2 + (p["y"] - q["y"]) ** 2) ** 0.5


def _distancia_minima(a: list[dict], b: list[dict]) -> float | None:
    """Menor distância entre um pino de ``a`` e um de ``b`` (``None`` se faltar pino)."""
    if not a or not b:
        return None
    return min(_distancia(p, q) for p in a for q in b)


def _deslocamento(antes: list[dict], depois: list[dict]) -> float | None:
    """Maior distância de um pino ao pino mais próximo na outra versão (Hausdorff)."""
    if not antes and not depois:
        return 0.0
    if not antes or not depois:
        return None
    ida = max(min(_distancia(p, q) for q in antes) for p in depois)
    volta = max(min(_distancia(p, q) for q in depois) for p in antes)
    return max(ida, volta)


def _area(valor) -> float | None:
    return None if valor is None else round(float(valor), 2)


def _decimal(valor: float) -> str:
    return f"{valor:.3f}".replace(".", ",")


def diferencas_vazias(revisao_base: str | None = None) -> dict:
    return {"revisao_base": revisao_base, "novos": [], "removidos": [], "herdados": [],
            "nome_alterado": [], "area_alterada": [], "marcador_deslocado": []}


def referencia(base: dict, revisao: str) -> tuple[dict[str, dict], str | None, dict[str, dict]]:
    """Lista de referência para as diferenças.

    Devolve ``({id: resumo}, revisão da referência, {id: removido})``; o último são
    os ``ambientes_removidos`` conhecidos na referência (para nomear um reativado).

    Se a base é de outra revisão, a referência é a própria base. Se é da mesma
    revisão (o extrator já rodou nela), a referência é reconstruída desfazendo as
    ``diferencas`` gravadas na base; assim, rodar de novo com a mesma entrada dá o
    mesmo arquivo, e o relatório continua mostrando a mudança desde a revisão anterior.
    """
    ref = {a["id"]: _resumo(a) for a in base.get("ambientes", [])}
    revisoes = sorted({a.get("revisao") for a in base.get("ambientes", []) if a.get("revisao")})
    revisao_base = revisoes[0] if len(revisoes) == 1 else None
    removidos = {r["id"]: r for r in base.get("ambientes_removidos", [])}
    dif = base.get("diferencas")
    if revisao_base != revisao or not dif:
        return ref, revisao_base, removidos
    for n in dif.get("novos", []):
        ref.pop(n["id"], None)
    for h in dif.get("herdados", []):
        if h.get("reativado"):
            ref.pop(h["id"], None)
            removidos.setdefault(h["id"], {"id": h["id"], "pavimento": h["pavimento"],
                                           "nome_operacional": h["nome_antes"]})
        elif h["id"] in ref:
            ref[h["id"]]["nome_operacional"] = h["nome_antes"]
    for n in dif.get("nome_alterado", []):
        if n["id"] in ref:
            ref[n["id"]]["nome_operacional"] = n["antes"]
    for n in dif.get("area_alterada", []):
        if n["id"] in ref:
            ref[n["id"]]["area_m2"] = n["antes"]
    for n in dif.get("marcador_deslocado", []):
        if n["id"] in ref:
            ref[n["id"]]["marcadores"] = n["antes"]
    for r in dif.get("removidos", []):
        ref[r["id"]] = {
            "id": r["id"], "pavimento": r["pavimento"], "nome_operacional": r["nome_operacional"],
            "nome_planta": r.get("nome_planta"), "area_m2": r.get("area_m2"),
            "revisao": r.get("revisao_ultima"), "marcadores": r.get("marcadores", []),
        }
    return ref, dif.get("revisao_base", revisao_base), removidos


def sugerir_sucessor(removido: dict, novos: list[dict]) -> dict | None:
    """Ambiente novo do mesmo pavimento que provavelmente substitui o removido.

    Vale o pino mais próximo, se estiver a menos de ``LIMIAR_SUCESSOR``; senão, o
    novo com o mesmo nome na planta e/ou a mesma área. Só é relatado, nunca aplicado.
    """
    candidatos = []
    for n in novos:
        if n["pavimento"] != removido["pavimento"]:
            continue
        d = _distancia_minima(removido["marcadores"], n["marcadores"])
        motivos = []
        perto = d is not None and d < LIMIAR_SUCESSOR
        if perto:
            motivos.append(f"pino a {_decimal(d)} do anterior")
        if removido.get("nome_planta") and n.get("nome_planta") == removido["nome_planta"]:
            motivos.append("mesmo nome na planta")
        if removido.get("area_m2") is not None and _area(n.get("area_m2")) == _area(removido["area_m2"]):
            motivos.append("mesma área")
        if motivos:
            chave = (not perto, -len(motivos), d if d is not None else float("inf"), n["id"])
            candidatos.append((chave, n, motivos))
    if not candidatos:
        return None
    _, n, motivos = min(candidatos, key=lambda c: c[0])
    return {"id": n["id"], "nome_operacional": n["nome_operacional"], "motivo": "; ".join(motivos)}


def comparar_com_base(obra: dict, ambientes: list[dict], herdados: dict[str, str],
                      base: dict | None) -> tuple[list[dict], dict]:
    """Calcula ``(ambientes_removidos, diferencas)`` da lista nova em relação à base."""
    if base is None:
        return [], diferencas_vazias()
    ref, revisao_base, removidos_ref = referencia(base, obra["revisao"])
    novos_por_id = {a["id"]: _resumo(a) for a in ambientes}
    removidos_base = {r["id"]: r for r in base.get("ambientes_removidos", [])}
    dif = diferencas_vazias(revisao_base)

    novos = [novos_por_id[a["id"]] for a in ambientes if a["id"] not in ref and a["id"] not in herdados]
    dif["novos"] = [{"id": n["id"], "pavimento": n["pavimento"], "nome_operacional": n["nome_operacional"],
                     "area_m2": n["area_m2"]} for n in novos]

    for a in ambientes:
        atual = novos_por_id[a["id"]]
        antes = ref.get(a["id"])
        if a["id"] in herdados:
            if antes is None or antes["nome_operacional"] != atual["nome_operacional"]:
                reativado = antes is None
                nome_antes = (removidos_ref.get(a["id"], {}).get("nome_operacional") if reativado
                              else antes["nome_operacional"])
                dif["herdados"].append({"id": a["id"], "id_calculado": herdados[a["id"]],
                                        "pavimento": atual["pavimento"], "nome_antes": nome_antes,
                                        "nome_operacional": atual["nome_operacional"], "reativado": reativado})
        elif antes is not None and antes["nome_operacional"] != atual["nome_operacional"]:
            dif["nome_alterado"].append({"id": a["id"], "antes": antes["nome_operacional"],
                                         "depois": atual["nome_operacional"]})
        if antes is None:
            continue
        if _area(antes["area_m2"]) != _area(atual["area_m2"]):
            dif["area_alterada"].append({"id": a["id"], "nome_operacional": atual["nome_operacional"],
                                         "antes": antes["area_m2"], "depois": atual["area_m2"]})
        d = _deslocamento(antes["marcadores"], atual["marcadores"])
        if d is None or d > LIMIAR_DESLOCAMENTO:
            dif["marcador_deslocado"].append({
                "id": a["id"], "nome_operacional": atual["nome_operacional"],
                "distancia": None if d is None else round(d, 4),
                "antes": antes["marcadores"], "depois": atual["marcadores"],
            })

    ordem_pav = [p["codigo"] for p in pavimentos_ordenados(obra)]

    def chave_removido(r: dict):
        pav = ordem_pav.index(r["pavimento"]) if r["pavimento"] in ordem_pav else len(ordem_pav)
        return (pav, r["id"])

    removidos = sorted((r for i, r in ref.items() if i not in novos_por_id), key=chave_removido)
    for r in removidos:
        dif["removidos"].append({
            "id": r["id"], "pavimento": r["pavimento"], "nome_operacional": r["nome_operacional"],
            "nome_planta": r["nome_planta"], "area_m2": r["area_m2"], "revisao_ultima": r["revisao"],
            "marcadores": r["marcadores"], "sucessor_sugerido": sugerir_sucessor(r, novos),
        })

    # Acumulativa: os removidos de antes continuam, a menos que o id volte a existir.
    acumulados = {i: r for i, r in removidos_base.items() if i not in novos_por_id}
    for r in removidos:
        acumulados.setdefault(r["id"], {"id": r["id"], "pavimento": r["pavimento"],
                                        "nome_operacional": r["nome_operacional"],
                                        "revisao_ultima": r["revisao"]})
    ambientes_removidos = sorted(acumulados.values(), key=chave_removido)
    return ambientes_removidos, dif


def tem_diferencas(dif: dict) -> bool:
    return any(dif.get(k) for k in ("novos", "removidos", "herdados", "nome_alterado",
                                    "area_alterada", "marcador_deslocado"))


def relatorio_diferencas(dif: dict, slug: str) -> list[str]:
    """Linhas do relatório de diferenças impresso pelo ``main``."""
    if not tem_diferencas(dif):
        return ["Diferenças em relação à lista anterior: nenhuma."]
    rev = dif.get("revisao_base")
    linhas = [f"Diferenças em relação à lista anterior{f' ({rev})' if rev else ''}:"]
    if dif["novos"]:
        linhas.append(f"  Novos ({len(dif['novos'])}):")
        linhas += [f"    + {n['id']} ({n['nome_operacional']})" for n in dif["novos"]]
    if dif["removidos"]:
        linhas.append(f"  Removidos ({len(dif['removidos'])}), ficam inativos no banco:")
        for r in dif["removidos"]:
            s = r["sucessor_sugerido"]
            sugestao = f" -> provável sucessor {s['id']} ({s['motivo']})" if s else " -> sem sucessor provável"
            linhas.append(f"    - {r['id']} ({r['nome_operacional']}){sugestao}")
    if dif["herdados"]:
        linhas.append(f"  Códigos mantidos por 'manter_codigo' ({len(dif['herdados'])}):")
        for h in dif["herdados"]:
            extra = ", reativado" if h["reativado"] else ""
            linhas.append(f"    = {h['id']} ({h['nome_antes']} -> {h['nome_operacional']}; "
                          f"id calculado {h['id_calculado']}{extra})")
    if dif["nome_alterado"]:
        linhas.append(f"  Nome alterado, mesmo código ({len(dif['nome_alterado'])}):")
        linhas += [f"    ~ {n['id']}: {n['antes']} -> {n['depois']}" for n in dif["nome_alterado"]]
    if dif["area_alterada"]:
        linhas.append(f"  Área alterada ({len(dif['area_alterada'])}):")
        linhas += [f"    ~ {n['id']}: {n['antes']} -> {n['depois']} m²" for n in dif["area_alterada"]]
    if dif["marcador_deslocado"]:
        linhas.append(f"  Pino deslocado mais de {_decimal(LIMIAR_DESLOCAMENTO)} ({len(dif['marcador_deslocado'])}):")
        for n in dif["marcador_deslocado"]:
            d = "pinos diferentes" if n["distancia"] is None else _decimal(n["distancia"])
            linhas.append(f"    ~ {n['id']}: {d}")
    if dif["removidos"]:
        exemplo = next((r for r in dif["removidos"] if r["sucessor_sugerido"]), None)
        novo = exemplo["sucessor_sugerido"]["id"] if exemplo else "<id novo calculado>"
        antigo = exemplo["id"] if exemplo else "<id antigo>"
        linhas += [
            "",
            "Se um ambiente removido foi apenas renomeado, confirme para manter o código antigo",
            f"(e os registros dele) acrescentando em data/{slug}/obra.json:",
            f'  "manter_codigo": {{"{novo}": "{antigo}"}}',
            f"e rode de novo: python3 scripts/extrair_ambientes.py --obra {slug}",
        ]
    return linhas


def extrair(obra: dict, paginas: dict[str, dict], base: dict | None = None) -> dict:
    """Monta o conteúdo de ``ambientes.json`` a partir da configuração e dos spans.

    ``paginas`` mapeia o código do pavimento para ``{largura, altura, spans}``
    (ver ``ler_paginas``). ``base`` é o ``ambientes.json`` anterior (``None`` na
    primeira extração): mantém os códigos, aplica ``manter_codigo`` e calcula
    ``ambientes_removidos`` e ``diferencas``. Função pura: não lê nem grava arquivos.
    """
    nomes_fixos = obra.get("nomes_fixos", {})
    categorias = obra.get("categorias", {})
    renomear = {}
    for r in obra.get("renomear", []):
        chave = _chave_renomear(r["pavimento"], r["nome_planta"], r["area_m2"])
        if chave in renomear:
            raise SystemExit(f"renomear repetido: {chave}")
        renomear[chave] = r["nome_operacional"]
    renomear_usados: set[tuple] = set()

    pavimentos = pavimentos_ordenados(obra)
    ambientes: list[dict] = []
    revisar: list[dict] = []
    for pav_cfg in pavimentos:
        pav = pav_cfg["codigo"]
        pdf = f"{obra['pasta_pdf']}/{pav_cfg['pdf']}"
        pagina = paginas[pav]
        w, h = pagina["largura"], pagina["altura"]
        pares, orfas = parear_rotulos(pagina["spans"])
        for texto in orfas:
            revisar.append({"pavimento": pav, "motivo": "área sem nome acima", "rotulo": texto})

        por_chave: dict[tuple[str, float | None], dict] = {}
        for par in pares:
            nome = par["nome"]["text"]
            area = parse_area(par["area"]["text"])
            nb, ab = par["nome"]["bbox"], par["area"]["bbox"]
            rotulo = [min(nb[0], ab[0]), nb[1], max(nb[2], ab[2]), ab[3]]
            marcador = {
                # Pino acima do nome: x no centro do rótulo, y no topo do nome.
                "x": round(centro_x(nb) / w, 6),
                "y": round(nb[1] / h, 6),
                "rotulo_bbox": [round(rotulo[0] / w, 6), round(rotulo[1] / h, 6),
                                round(rotulo[2] / w, 6), round(rotulo[3] / h, 6)],
            }
            chave = (nome, area)
            if chave in por_chave:
                # Mesmo nome e mesma área: um ambiente rotulado duas vezes.
                por_chave[chave]["marcadores"].append(marcador)
                continue
            item = {
                "pavimento": pav,
                "nome_planta": nome,
                "nome_operacional": nome_operacional(nome, nomes_fixos),
                "categoria": categoria(nome, categorias),
                "area_m2": area,
                "pdf": pdf,
                "pagina": pav_cfg.get("pagina", 1),
                "revisao": obra["revisao"],
                "marcadores": [marcador],
            }
            chave_ren = _chave_renomear(pav, nome, area)
            if chave_ren in renomear:
                # Nome definido na configuração (par nome na planta + área).
                item["nome_operacional"] = renomear[chave_ren]
                item["_renomeado"] = True
                renomear_usados.add(chave_ren)
            por_chave[chave] = item

        itens = list(por_chave.values())
        # Mesmo nome com áreas diferentes: ambientes distintos que precisam de nome próprio.
        por_nome: dict[str, list[dict]] = {}
        for item in itens:
            por_nome.setdefault(item["nome_planta"], []).append(item)
        for nome, grupo in por_nome.items():
            if len(grupo) > 1:
                grupo.sort(key=lambda g: (g["area_m2"] is None, g["area_m2"] or 0))
                sem_nome = [g for g in grupo if not g.get("_renomeado")]
                if len(sem_nome) > 1:
                    for k, item in enumerate(sem_nome, start=1):
                        item["nome_operacional"] = f"{item['nome_operacional']} {k}"
                motivo = ("mesmo nome em ambientes diferentes; numerados provisoriamente" if sem_nome
                          else "mesmo nome em ambientes diferentes; nomes definidos na configuração")
                revisar.append({
                    "pavimento": pav,
                    "motivo": motivo,
                    "nomes": [g["nome_operacional"] for g in grupo],
                })
        for item in itens:
            if len(item["marcadores"]) > 1:
                revisar.append({
                    "pavimento": pav,
                    "motivo": "ambiente rotulado mais de uma vez; mantidos todos os pinos",
                    "nome": item["nome_operacional"],
                })
            if item["area_m2"] is None:
                revisar.append({
                    "pavimento": pav,
                    "motivo": "área marcada como 'Não incluso' na planta",
                    "nome": item["nome_operacional"],
                })
        for manual in obra.get("ambientes_manuais", []):
            if manual["pavimento"] != pav:
                continue
            itens.append(ambiente_manual(obra, pav_cfg, manual))
            revisar.append({
                "pavimento": pav,
                "motivo": "ambiente sem rótulo na planta; pino colocado à mão",
                "nome": manual["nome_operacional"],
            })
        for item in itens:
            item["id"] = f"{pav}-{slug(item['nome_operacional'])}"
        ambientes.extend(itens)

    herdados = aplicar_manter_codigo(ambientes, obra.get("manter_codigo", {}), base)

    nao_usados = sorted(set(renomear) - renomear_usados, key=str)
    if nao_usados:
        raise SystemExit(f"'renomear' sem ambiente correspondente na planta: {nao_usados}")

    ids = [a["id"] for a in ambientes]
    duplicados = sorted({i for i in ids if ids.count(i) > 1})
    if duplicados:
        dica = " (confira 'manter_codigo')" if herdados else ""
        raise SystemExit(f"ids duplicados: {duplicados}{dica}")

    codigos = [p["codigo"] for p in pavimentos]

    def ordem(a: dict):
        # Lista sem grupos: ordem alfabética natural (Apto. 2 antes de Apto. 10), ignorando acentos.
        nome = a["nome_operacional"]
        sem_acento = unicodedata.normalize("NFKD", nome).encode("ascii", "ignore").decode().lower()
        partes = [int(p) if p.isdigit() else p for p in re.split(r"(\d+)", sem_acento)]
        return (codigos.index(a["pavimento"]), partes)

    ambientes.sort(key=ordem)
    campos = ["id", "pavimento", "nome_operacional", "nome_planta", "categoria", "area_m2",
              "pdf", "pagina", "revisao", "marcadores"]
    ambientes_removidos, diferencas = comparar_com_base(obra, ambientes, herdados, base)
    return {
        "obra": obra["slug"],
        "fonte": f"{obra['pasta_pdf']}/ (configuração em data/{obra['slug']}/obra.json)",
        "status": obra["status"],
        "revisao_humana": obra.get("revisao_humana"),
        "coordenadas": "marcadores normalizados na página do PDF (0–1, origem no canto superior esquerdo); "
                       "x = centro do rótulo, y = topo do nome; o pino é desenhado acima desse ponto",
        "pavimentos": [{"id": p["codigo"], "nome": p["nome"]} for p in pavimentos],
        "ambientes": [{c: a[c] for c in campos} for a in ambientes],
        "revisar": revisar,
        "ambientes_removidos": ambientes_removidos,
        "diferencas": diferencas,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Extrai os ambientes de uma obra a partir dos PDFs de arquitetura.")
    ap.add_argument("--obra", required=True, help="slug da obra (pasta data/<slug>/ com obra.json)")
    args = ap.parse_args(argv)

    obra = carregar_obra(args.obra)
    saida = ROOT / "data" / obra["slug"] / "ambientes.json"
    # A lista anterior (no Git) é a base: lida antes de ser sobrescrita.
    base = json.loads(saida.read_text(encoding="utf-8")) if saida.is_file() else None
    resultado = extrair(obra, ler_paginas(obra), base)
    saida.write_text(json.dumps(resultado, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for pav in resultado["pavimentos"]:
        n = sum(1 for a in resultado["ambientes"] if a["pavimento"] == pav["id"])
        print(f"{pav['nome']}: {n} ambientes")
    print(f"Status: {resultado['status']}")
    print(f"Casos para conferir na revisão: {len(resultado['revisar'])}")
    if resultado["ambientes_removidos"]:
        print(f"Ambientes removidos (acumulado, ficam inativos): {len(resultado['ambientes_removidos'])}")
    for linha in relatorio_diferencas(resultado["diferencas"], obra["slug"]):
        print(linha)
    print(f"Gerado: {saida.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
