"""Gera as imagens de planta usadas para localizar os ambientes no Mini App.

Entradas: a configuração ``data/<slug>/obra.json`` (recorte do edifício e
máscaras da prancha), os PDFs originais em ``DOCS <SIGLA>/PDF/`` e
``data/<slug>/ambientes.json`` (gerado por ``scripts/extrair_ambientes.py``).
Os PDFs são apenas lidos.

Saídas em ``data/<slug>/plantas/<revisao>/<pavimento>/``:

- ``planta.webp``: visão geral do pavimento recortada no edifício (~2400 px).
- ``planta-hd.webp``: a mesma área com mais resolução, para zoom (~4096 px).
- ``ambientes/<id>.webp``: recorte de detalhe centrado em cada ambiente.
- ``prova.png``: visão geral com todos os pinos, para a revisão humana.

As imagens do app não levam o pino gravado: o frontend desenha os pinos por cima
a partir de ``data/<slug>/plantas.json``, que registra recorte e escala de cada
imagem. Conversão de um ponto normalizado da página (x, y) para pixels::

    px = (x * largura_pt - recorte_pt[0]) * escala_px_por_pt
    py = (y * altura_pt  - recorte_pt[1]) * escala_px_por_pt

Uso (na raiz do repositório)::

    pip install -r scripts/requirements.txt
    python3 scripts/gerar_plantas.py --obra hto
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import sys
from pathlib import Path

import pymupdf
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SLUG_RE = re.compile(r"^[a-z0-9-]+$")

# O recorte do edifício e as máscaras (legendas, tabelas, carimbo cobertos de
# branco) dependem da prancha e ficam em ``prancha`` de ``data/<slug>/obra.json``,
# em coordenadas normalizadas da página (0–1, origem no canto superior esquerdo).

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


def carregar_obra(slug: str) -> dict:
    if not SLUG_RE.match(slug):
        raise SystemExit(f"slug inválido: {slug!r}")
    arquivo = ROOT / "data" / slug / "obra.json"
    if not arquivo.is_file():
        raise SystemExit(f"configuração não encontrada: {arquivo.relative_to(ROOT)}")
    obra = json.loads(arquivo.read_text(encoding="utf-8"))
    if obra.get("slug") != slug:
        raise SystemExit(f"obra.json com slug '{obra.get('slug')}', esperado '{slug}'")
    return obra


def prancha(obra: dict) -> tuple[list[float], list[list[float]]]:
    """(recorte do edifício, máscaras) normalizados, lidos da configuração da obra."""
    cfg = obra["prancha"]
    recorte = list(cfg["recorte_edificio"])
    mascaras = [list(m["retangulo"]) for m in cfg.get("mascaras", [])]
    for r in [recorte, *mascaras]:
        if len(r) != 4 or not (0 <= r[0] < r[2] <= 1 and 0 <= r[1] < r[3] <= 1):
            raise SystemExit(f"retângulo normalizado inválido em obra.json: {r}")
    return recorte, mascaras


def mascarar(img: Image.Image, page: pymupdf.Page, clip: pymupdf.Rect, escala: float,
             mascaras: list[list[float]]) -> None:
    w, h = page.rect.width, page.rect.height
    dr = ImageDraw.Draw(img)
    for x0, y0, x1, y1 in mascaras:
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


def gerar(obra: dict) -> dict:
    slug = obra["slug"]
    dados = json.loads((ROOT / "data" / slug / "ambientes.json").read_text(encoding="utf-8"))
    if dados["obra"] != slug:
        raise SystemExit(f"ambientes.json é da obra '{dados['obra']}', esperado '{slug}'")
    recorte_edificio, mascaras = prancha(obra)
    saida = ROOT / "data" / slug / "plantas"
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
        base = saida / revisao / pav["id"]
        clip = pymupdf.Rect(recorte_edificio[0] * w, recorte_edificio[1] * h,
                            recorte_edificio[2] * w, recorte_edificio[3] * h)

        imagens = {}
        for nome, lado in (("planta", LADO_VISAO_GERAL), ("planta-hd", LADO_HD)):
            escala = lado / max(clip.width, clip.height)
            img = renderizar(page, clip, escala)
            mascarar(img, page, clip, escala, mascaras)
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
            mascarar(img, page, janela, ESCALA_DETALHE, mascaras)
            destino = base / "ambientes" / f"{a['id']}.webp"
            tamanho = salvar_webp(img, destino)
            detalhes[a["id"]] = {"arquivo": rel(destino), "recorte_pt": [round(v, 3) for v in janela],
                                 "largura": img.width, "altura": img.height,
                                 "escala_px_por_pt": ESCALA_DETALHE, "bytes": tamanho}

        # Recortes de ambientes que saíram da lista (id renomeado, por exemplo) não
        # podem ficar na pasta: o publicar_plantas.py envia todo .webp que encontrar.
        for antigo in (base / "ambientes").glob("*.webp"):
            if antigo.stem not in detalhes:
                antigo.unlink()
                print(f"Removido recorte sem ambiente: {rel(antigo)}")

        manifesto["pavimentos"].append({
            "id": pav["id"], "nome": pav["nome"], "revisao": revisao,
            "pdf": pdf_rel, "pagina": pagina, "sha256": sha256(pdf),
            "pagina_pt": [w, h],
            "recorte_pt": [round(v, 3) for v in clip],
            "mascaras_normalizadas": mascaras,
            "imagens": imagens, "prova": rel(destino_prova),
            "detalhes": detalhes,
            "aviso": f"Planta de arquitetura {revisao} · posição indicativa",
        })
    return manifesto


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Gera as imagens de planta e o manifesto de uma obra.")
    ap.add_argument("--obra", required=True, help="slug da obra (pasta data/<slug>/ com obra.json)")
    args = ap.parse_args(argv)

    obra = carregar_obra(args.obra)
    manifesto = gerar(obra)
    destino = ROOT / "data" / obra["slug"] / "plantas.json"
    destino.write_text(json.dumps(manifesto, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for p in manifesto["pavimentos"]:
        tamanhos = [d["bytes"] for d in p["detalhes"].values()]
        print(f"{p['nome']}: visão geral {p['imagens']['planta']['bytes'] / 1e6:.2f} MB, "
              f"HD {p['imagens']['planta-hd']['bytes'] / 1e6:.2f} MB, "
              f"{len(tamanhos)} recortes (máx. {max(tamanhos) / 1e3:.0f} KB)")
    print(f"Gerado: {destino.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
