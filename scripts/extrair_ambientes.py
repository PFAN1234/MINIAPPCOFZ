"""Extrai os ambientes da HTO a partir dos rótulos das plantas de arquitetura.

Fonte: ``artifacts/validation/pdf/inventory.json`` (spans de texto com bbox em
pontos PDF, origem no canto superior esquerdo). Cada ambiente da planta tem o
nome com a área logo abaixo ("APTO. 101" / "A=23.88 m²"). A área é usada como
âncora e o nome é o span imediatamente acima dela.

Saída: ``data/hto/ambientes.json``. A lista exige revisão humana antes de virar
cadastro; os casos duvidosos aparecem em ``revisar``.

Uso (na raiz do repositório)::

    python3 scripts/extrair_ambientes.py
"""
from __future__ import annotations

import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INVENTARIO = ROOT / "artifacts/validation/pdf/inventory.json"
SAIDA = ROOT / "data/hto/ambientes.json"

AREA_RE = re.compile(r"^A=\s*(?P<valor>[\d.,]+|Não incluso)\s*m²$")
REVISAO_RE = re.compile(r"-(R\d+)\.pdf$", re.I)

# Distâncias em pontos PDF (1/72"). Na planta, o nome fica colado acima da área:
# o bbox do nome sobrepõe a área em ~1 pt; o centro horizontal coincide.
GAP_MIN, GAP_MAX = -4.0, 8.0
DESVIO_CENTRO_MAX = 25.0

PAVIMENTOS = {"Térreo": "terreo", "1º pavimento": "1pav"}

# Nomes operacionais para abreviações conhecidas da planta.
NOMES_FIXOS = {
    "ADMIN.": "Administração",
    "BHO ADM": "Banheiro Adm.",
    "COPA ADM.": "Copa Adm.",
    "CPD": "CPD",
    "DML": "DML",
    "DML / ROUPARIA": "DML / Rouparia",
    "LAVAND. HÓSPEDES": "Lavanderia hóspedes",
    "VEST. FEM.": "Vestiário feminino",
    "VEST. MASC.": "Vestiário masculino",
    "VEST. MASC. (CHUVEIROS)": "Vestiário masculino (chuveiros)",
    "VEST. MASC. (MICTÓRIOS)": "Vestiário masculino (mictórios)",
    "CIRC. SUL": "Circulação sul",
    "CIRC. NORTE": "Circulação norte",
}


def centro_x(b: list[float]) -> float:
    return (b[0] + b[2]) / 2


def parse_area(texto: str) -> float | None:
    m = AREA_RE.match(texto)
    if not m:
        raise ValueError(f"rótulo de área inválido: {texto!r}")
    valor = m.group("valor")
    return None if valor == "Não incluso" else float(valor.replace(",", "."))


def nome_operacional(nome: str) -> str:
    if nome in NOMES_FIXOS:
        return NOMES_FIXOS[nome]
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


def categoria(nome: str) -> str:
    n = nome.upper()
    if n.startswith("APTO"):
        return "apartamento"
    if n.startswith("BHO"):
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


def extrair(inventario: dict) -> dict:
    ambientes: list[dict] = []
    revisar: list[dict] = []
    for doc in inventario["documents"]:
        pdf = doc["path"]
        revisao = REVISAO_RE.search(pdf).group(1)
        for page in doc["pages"]:
            pav_nome = page["floor"]
            pav = PAVIMENTOS[pav_nome]
            w, h = page["width_points"], page["height_points"]
            pares, orfas = parear_rotulos(page["text_spans"])
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
                    "nome_operacional": nome_operacional(nome),
                    "categoria": categoria(nome),
                    "area_m2": area,
                    "pdf": pdf,
                    "pagina": page["page"],
                    "revisao": revisao,
                    "marcadores": [marcador],
                }
                por_chave[chave] = item

            itens = list(por_chave.values())
            # Mesmo nome com áreas diferentes: ambientes distintos que precisam de nome próprio.
            por_nome: dict[str, list[dict]] = {}
            for item in itens:
                por_nome.setdefault(item["nome_planta"], []).append(item)
            for nome, grupo in por_nome.items():
                if len(grupo) > 1:
                    grupo.sort(key=lambda g: (g["area_m2"] is None, g["area_m2"] or 0))
                    for k, item in enumerate(grupo, start=1):
                        item["nome_operacional"] = f"{item['nome_operacional']} {k}"
                    revisar.append({
                        "pavimento": pav,
                        "motivo": "mesmo nome em ambientes diferentes; numerados provisoriamente",
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
            for item in itens:
                item["id"] = f"{pav}-{slug(item['nome_operacional'])}"
            ambientes.extend(itens)

    ids = [a["id"] for a in ambientes]
    duplicados = sorted({i for i in ids if ids.count(i) > 1})
    if duplicados:
        raise SystemExit(f"ids duplicados: {duplicados}")

    ordem_cat = ["apartamento", "banheiro", "vestiario", "area_comum", "servico", "circulacao", "externa"]

    def ordem(a: dict):
        nome = a["nome_operacional"]
        numeros = [int(n) for n in re.findall(r"\d+", nome)]
        return (list(PAVIMENTOS.values()).index(a["pavimento"]), ordem_cat.index(a["categoria"]),
                re.sub(r"\d+", "", nome), numeros, nome)

    ambientes.sort(key=ordem)
    campos = ["id", "pavimento", "nome_operacional", "nome_planta", "categoria", "area_m2",
              "pdf", "pagina", "revisao", "marcadores"]
    return {
        "obra": "hto",
        "fonte": str(INVENTARIO.relative_to(ROOT)),
        "status": "aguardando_revisao_humana",
        "coordenadas": "marcadores normalizados na página do PDF (0–1, origem no canto superior esquerdo); "
                       "x = centro do rótulo, y = topo do nome; o pino é desenhado acima desse ponto",
        "pavimentos": [{"id": v, "nome": k} for k, v in PAVIMENTOS.items()],
        "ambientes": [{c: a[c] for c in campos} for a in ambientes],
        "revisar": revisar,
    }


def main() -> int:
    resultado = extrair(json.loads(INVENTARIO.read_text()))
    SAIDA.parent.mkdir(parents=True, exist_ok=True)
    SAIDA.write_text(json.dumps(resultado, ensure_ascii=False, indent=2) + "\n")
    for pav in resultado["pavimentos"]:
        n = sum(1 for a in resultado["ambientes"] if a["pavimento"] == pav["id"])
        print(f"{pav['nome']}: {n} ambientes")
    print(f"Itens para revisão: {len(resultado['revisar'])}")
    print(f"Gerado: {SAIDA.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
