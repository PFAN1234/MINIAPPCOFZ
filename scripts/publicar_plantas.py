"""Publica as imagens das plantas de uma obra no bucket privado ``plantas`` do Supabase.

Envia ``data/<slug>/plantas/<revisao>/...`` (exceto ``prova.png``) para
``<obra_id>/<revisao>/<pavimento>/...`` pela API de Storage, com ``x-upsert: true``.
O ``obra.id`` é lido pela API REST (``obra?slug=eq.<slug>``).

Variáveis de ambiente: ``SUPABASE_URL`` e ``SUPABASE_SECRET_KEY`` (a chave nunca é impressa).

Uso (na raiz do repositório)::

    python3 scripts/publicar_plantas.py --obra hto --dry-run   # só lista local -> remoto
    python3 scripts/publicar_plantas.py --obra hto
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SLUG_RE = re.compile(r"^[a-z0-9-]+$")
BUCKET = "plantas"
ID_FICTICIO = "<obra_id>"


def mapear_caminhos(base: Path, obra_id: str) -> list[tuple[Path, str]]:
    """Pares (arquivo local, caminho no bucket) para todos os ``.webp`` sob ``base``.

    ``base/<revisao>/<pavimento>/...`` vira ``<obra_id>/<revisao>/<pavimento>/...``.
    Arquivos que não são ``.webp`` (como ``prova.png``) são ignorados.
    """
    pares = []
    for arquivo in sorted(base.rglob("*.webp")):
        rel = arquivo.relative_to(base).as_posix()
        pares.append((arquivo, f"{obra_id}/{rel}"))
    return pares


def _requisicao(url: str, chave: str, **kw) -> urllib.request.Request:
    cabecalhos = {"apikey": chave, "Authorization": f"Bearer {chave}", **kw.pop("headers", {})}
    return urllib.request.Request(url, headers=cabecalhos, **kw)


def base_da_obra(slug: str) -> Path:
    """Pasta local das imagens da obra: ``data/<slug>/plantas``."""
    if not SLUG_RE.match(slug):
        raise SystemExit(f"slug inválido: {slug!r}")
    if not (ROOT / "data" / slug / "obra.json").is_file():
        raise SystemExit(f"configuração não encontrada: data/{slug}/obra.json")
    base = ROOT / "data" / slug / "plantas"
    if not base.is_dir():
        raise SystemExit(f"sem imagens em data/{slug}/plantas: rode scripts/gerar_plantas.py --obra {slug}")
    return base


def obter_obra_id(url: str, chave: str, slug: str) -> str:
    req = _requisicao(f"{url}/rest/v1/obra?slug=eq.{urllib.parse.quote(slug)}&select=id", chave)
    with urllib.request.urlopen(req, timeout=30) as resp:
        linhas = json.loads(resp.read().decode("utf-8"))
    if not linhas:
        raise SystemExit(f"Obra '{slug}' não encontrada. Rode o seed (supabase/seed/{slug}.sql) antes.")
    return linhas[0]["id"]


def enviar(url: str, chave: str, arquivo: Path, caminho: str) -> None:
    destino = f"{url}/storage/v1/object/{BUCKET}/{urllib.parse.quote(caminho)}"
    req = _requisicao(
        destino, chave, data=arquivo.read_bytes(), method="POST",
        headers={"x-upsert": "true", "content-type": "image/webp"},
    )
    with urllib.request.urlopen(req, timeout=120):
        pass


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--obra", required=True, help="slug da obra (pasta data/<slug>/ com obra.json)")
    ap.add_argument("--dry-run", action="store_true", help="só lista caminho local -> caminho remoto")
    args = ap.parse_args(argv)
    base = base_da_obra(args.obra)

    if args.dry_run:
        pares = mapear_caminhos(base, ID_FICTICIO)
        for arquivo, caminho in pares:
            print(f"{arquivo.relative_to(ROOT)} -> {BUCKET}/{caminho}")
        print(f"{len(pares)} arquivos (simulação, nada enviado)")
        return 0

    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    chave = os.environ.get("SUPABASE_SECRET_KEY", "")
    if not url or not chave:
        print("Defina SUPABASE_URL e SUPABASE_SECRET_KEY.", file=sys.stderr)
        return 2
    try:
        obra_id = obter_obra_id(url, chave, args.obra)
        pares = mapear_caminhos(base, obra_id)
        for i, (arquivo, caminho) in enumerate(pares, start=1):
            enviar(url, chave, arquivo, caminho)
            print(f"[{i}/{len(pares)}] {caminho}")
    except urllib.error.HTTPError as e:
        print(f"Erro HTTP {e.code} em {e.url}: {e.read().decode('utf-8', 'replace')[:300]}", file=sys.stderr)
        return 1
    except urllib.error.URLError as e:
        print(f"Falha de rede: {e.reason}", file=sys.stderr)
        return 1
    print(f"Publicados {len(pares)} arquivos no bucket '{BUCKET}'.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
