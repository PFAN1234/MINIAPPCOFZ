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


def extrair(obra: dict, paginas: dict[str, dict]) -> dict:
    """Monta o conteúdo de ``ambientes.json`` a partir da configuração e dos spans.

    ``paginas`` mapeia o código do pavimento para ``{largura, altura, spans}``
    (ver ``ler_paginas``). Função pura: não lê nem grava arquivos.
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

    nao_usados = sorted(set(renomear) - renomear_usados, key=str)
    if nao_usados:
        raise SystemExit(f"'renomear' sem ambiente correspondente na planta: {nao_usados}")

    ids = [a["id"] for a in ambientes]
    duplicados = sorted({i for i in ids if ids.count(i) > 1})
    if duplicados:
        raise SystemExit(f"ids duplicados: {duplicados}")

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
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Extrai os ambientes de uma obra a partir dos PDFs de arquitetura.")
    ap.add_argument("--obra", required=True, help="slug da obra (pasta data/<slug>/ com obra.json)")
    args = ap.parse_args(argv)

    obra = carregar_obra(args.obra)
    resultado = extrair(obra, ler_paginas(obra))
    saida = ROOT / "data" / obra["slug"] / "ambientes.json"
    saida.write_text(json.dumps(resultado, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for pav in resultado["pavimentos"]:
        n = sum(1 for a in resultado["ambientes"] if a["pavimento"] == pav["id"])
        print(f"{pav['nome']}: {n} ambientes")
    print(f"Status: {resultado['status']}")
    print(f"Casos para conferir na revisão: {len(resultado['revisar'])}")
    print(f"Gerado: {saida.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
