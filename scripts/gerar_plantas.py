"""Gera as imagens de planta usadas para localizar os ambientes no Mini App.

Entradas: os PDFs originais em ``DOCS HTO/PDF/`` e ``data/hto/ambientes.json``
(gerado por ``scripts/extrair_ambientes.py``). Os PDFs são apenas lidos.

Saídas em ``data/hto/plantas/<revisao>/<pavimento>/``:

- ``planta.webp``: visão geral do pavimento recortada no edifício (~2400 px).
- ``planta-hd.webp``: a mesma área com mais resolução, para zoom (~4096 px).
- ``ambientes/<id>.webp``: recorte de detalhe centrado em cada ambiente.
- ``prova.png``: visão geral com todos os pinos, para a revisão humana.

As imagens do app não levam o pino gravado: o frontend desenha os pinos por cima
a partir de ``data/hto/plantas.json``, que registra recorte e escala de cada
imagem. Conversão de um ponto normalizado da página (x, y) para pixels::

    px = (x * largura_pt - recorte_pt[0]) * escala_px_por_pt
    py = (y * altura_pt  - recorte_pt[1]) * escala_px_por_pt

Uso (na raiz do repositório)::

    pip install -r scripts/requirements.txt
    python3 scripts/gerar_plantas.py
"""
from __future__ import annotations

import hashlib
import io
import json
import sys
from pathlib import Path

import pymupdf
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
AMBIENTES = ROOT / "data/hto/ambientes.json"
SAIDA = ROOT / "data/hto/plantas"
MANIFESTO = ROOT / "data/hto/plantas.json"

# Folha padrão das pranchas DE017/DE018 (coordenadas normalizadas da página).
# O edifício avança sobre a coluna de legendas na faixa da ala leste, então o
# recorte vai até x=0,85 e as legendas, quadros e carimbo são cobertos de branco.
RECORTE_EDIFICIO = (0.035, 0.018, 0.85, 0.952)
MASCARAS = [
    (0.776, 0.0, 1.0, 0.395),    # legendas de coberta e de piso
    (0.776, 0.556, 1.0, 1.0),    # especificação de piso, notas e carimbo
    (0.634, 0.828, 0.776, 1.0),  # tabela de soleiras
]

LADO_VISAO_GERAL = 2400
LADO_HD = 4096
ESCALA_DETALHE = 4.0                   # px por ponto PDF
JANELA_DETALHE = (220.0, 125.0)        # largura, altura em pontos PDF
QUALIDADE_WEBP = 80

COR_PINO = (220, 38, 38)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def renderizar(page: pymupdf.Page, clip: pymupdf.Rect, escala: float) -> Image.Image:
    pm = page.get_pixmap(matrix=pymupdf.Matrix(escala, escala), clip=clip, alpha=False)
    return Image.frombytes("RGB", (pm.width, pm.height), pm.samples)


def mascarar(img: Image.Image, page: pymupdf.Page, clip: pymupdf.Rect, escala: float) -> None:
    w, h = page.rect.width, page.rect.height
    dr = ImageDraw.Draw(img)
    for x0, y0, x1, y1 in MASCARAS:
        dr.rectangle([(x0 * w - clip.x0) * escala, (y0 * h - clip.y0) * escala,
                      (x1 * w - clip.x0) * escala, (y1 * h - clip.y0) * escala], fill="white")


def salvar_webp(img: Image.Image, destino: Path) -> int:
    destino.parent.mkdir(parents=True, exist_ok=True)
    buf = io.BytesIO()
    img.save(buf, "WEBP", quality=QUALIDADE_WEBP, method=6)
    destino.write_bytes(buf.getvalue())
    return len(buf.getvalue())


def desenhar_pino(dr: ImageDraw.ImageDraw, cx: float, topo_nome: float, raio: float) -> None:
    """Pino em gota com a ponta logo acima do nome do ambiente (mesmo desenho para todos)."""
    ponta = topo_nome - raio * 0.35
    cy = ponta - raio * 2.0
    dr.polygon([(cx - raio * 0.75, cy + raio * 0.6), (cx + raio * 0.75, cy + raio * 0.6), (cx, ponta)], fill=COR_PINO)
    dr.ellipse([cx - raio, cy - raio, cx + raio, cy + raio], fill=COR_PINO, outline="white", width=max(2, int(raio / 4)))
    dr.ellipse([cx - raio * 0.38, cy - raio * 0.38, cx + raio * 0.38, cy + raio * 0.38], fill="white")


def rel(path: Path) -> str:
    return str(path.relative_to(ROOT))


def gerar() -> dict:
    dados = json.loads(AMBIENTES.read_text())
    por_pav: dict[str, list[dict]] = {}
    for a in dados["ambientes"]:
        por_pav.setdefault(a["pavimento"], []).append(a)

    manifesto = {"obra": dados["obra"], "pavimentos": []}
    for pav in dados["pavimentos"]:
        ambientes = por_pav[pav["id"]]
        pdf_rel, revisao, pagina = ambientes[0]["pdf"], ambientes[0]["revisao"], ambientes[0]["pagina"]
        pdf = ROOT / pdf_rel
        page = pymupdf.open(pdf)[pagina - 1]
        w, h = page.rect.width, page.rect.height
        base = SAIDA / revisao / pav["id"]
        clip = pymupdf.Rect(RECORTE_EDIFICIO[0] * w, RECORTE_EDIFICIO[1] * h,
                            RECORTE_EDIFICIO[2] * w, RECORTE_EDIFICIO[3] * h)

        imagens = {}
        for nome, lado in (("planta", LADO_VISAO_GERAL), ("planta-hd", LADO_HD)):
            escala = lado / max(clip.width, clip.height)
            img = renderizar(page, clip, escala)
            mascarar(img, page, clip, escala)
            destino = base / f"{nome}.webp"
            tamanho = salvar_webp(img, destino)
            imagens[nome] = {"arquivo": rel(destino), "largura": img.width, "altura": img.height,
                             "escala_px_por_pt": round(escala, 6), "bytes": tamanho}
            if nome == "planta":
                prova, escala_prova = img.copy(), escala

        # Imagem de prova: todos os pinos iguais sobre a visão geral.
        dr = ImageDraw.Draw(prova)
        raio = 4.0 * escala_prova
        for a in ambientes:
            for m in a["marcadores"]:
                desenhar_pino(dr, (m["x"] * w - clip.x0) * escala_prova, (m["y"] * h - clip.y0) * escala_prova, raio)
        destino_prova = base / "prova.png"
        prova.save(destino_prova, optimize=True)

        detalhes = {}
        jw, jh = JANELA_DETALHE
        for a in ambientes:
            m = a["marcadores"][0]
            rb = m["rotulo_bbox"]
            cx, cy = (rb[0] + rb[2]) / 2 * w, (rb[1] + rb[3]) / 2 * h
            # Janela centrada no rótulo, um pouco abaixo para mostrar o pino acima do nome.
            janela = pymupdf.Rect(cx - jw / 2, cy - jh * 0.45, cx + jw / 2, cy + jh * 0.55) & page.rect
            img = renderizar(page, janela, ESCALA_DETALHE)
            mascarar(img, page, janela, ESCALA_DETALHE)
            destino = base / "ambientes" / f"{a['id']}.webp"
            tamanho = salvar_webp(img, destino)
            detalhes[a["id"]] = {"arquivo": rel(destino), "recorte_pt": [round(v, 3) for v in janela],
                                 "largura": img.width, "altura": img.height,
                                 "escala_px_por_pt": ESCALA_DETALHE, "bytes": tamanho}

        manifesto["pavimentos"].append({
            "id": pav["id"], "nome": pav["nome"], "revisao": revisao,
            "pdf": pdf_rel, "pagina": pagina, "sha256": sha256(pdf),
            "pagina_pt": [w, h],
            "recorte_pt": [round(v, 3) for v in clip],
            "mascaras_normalizadas": MASCARAS,
            "imagens": imagens, "prova": rel(destino_prova),
            "detalhes": detalhes,
            "aviso": f"Planta de arquitetura {revisao} · posição indicativa",
        })
    return manifesto


def main() -> int:
    manifesto = gerar()
    MANIFESTO.write_text(json.dumps(manifesto, ensure_ascii=False, indent=2) + "\n")
    for p in manifesto["pavimentos"]:
        tamanhos = [d["bytes"] for d in p["detalhes"].values()]
        print(f"{p['nome']}: visão geral {p['imagens']['planta']['bytes'] / 1e6:.2f} MB, "
              f"HD {p['imagens']['planta-hd']['bytes'] / 1e6:.2f} MB, "
              f"{len(tamanhos)} recortes (máx. {max(tamanhos) / 1e3:.0f} KB)")
    print(f"Gerado: {MANIFESTO.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
