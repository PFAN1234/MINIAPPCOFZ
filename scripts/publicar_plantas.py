"""Publica as imagens das plantas de uma obra na pasta ``plantas`` do R2.

Envia ``data/<slug>/plantas/<revisao>/...`` (exceto ``prova.png``) para
``<obra_id>/<revisao>/<pavimento>/...`` pela Edge Function ``armazenamento`` (modo interno):
``enviar`` (URL assinada) -> ``PUT`` direto no R2 -> ``confirmar``. Repetir sobrescreve.
O ``obra.id`` é lido pela API REST (``obra?slug=eq.<slug>``).

Variáveis de ambiente: ``SUPABASE_URL`` e ``SUPABASE_SECRET_KEY``; ``SEGREDO_INTERNO`` é
opcional (se faltar, vem da RPC ``segredo_interno``). Chave e segredo nunca são impressos.

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
PASTA = "plantas"
TIPO = "image/webp"
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


class ErroArmazenamento(Exception):
    """Falha no envio; a mensagem nunca inclui chave, segredo nem URL assinada."""


def obter_segredo(url: str, chave: str) -> str:
    segredo = os.environ.get("SEGREDO_INTERNO", "")
    if segredo:
        return segredo
    req = _requisicao(f"{url}/rest/v1/rpc/segredo_interno", chave, data=b"{}", method="POST",
                      headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        valor = json.loads(resp.read().decode("utf-8"))
    if not isinstance(valor, str) or not valor:
        raise ErroArmazenamento("a RPC segredo_interno não devolveu o segredo")
    return valor


def _chamar_funcao(url: str, chave: str, segredo: str, corpo: dict) -> dict:
    req = _requisicao(
        f"{url}/functions/v1/armazenamento", chave, data=json.dumps(corpo).encode("utf-8"),
        method="POST", headers={"content-type": "application/json", "x-segredo-interno": segredo},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            motivo = str(json.loads(e.read().decode("utf-8")).get("erro", ""))[:200]
        except (ValueError, AttributeError):
            motivo = ""
        raise ErroArmazenamento(
            f"armazenamento/{corpo.get('acao')} recusou {corpo.get('caminho')}: HTTP {e.code} {motivo}".strip()
        ) from None


def enviar(url: str, chave: str, segredo: str, arquivo: Path, caminho: str) -> None:
    """enviar -> PUT na URL assinada -> confirmar, na pasta ``plantas``."""
    dados = arquivo.read_bytes()
    r = _chamar_funcao(url, chave, segredo, {
        "acao": "enviar", "pasta": PASTA, "caminho": caminho, "tamanho": len(dados), "tipo": TIPO,
    })
    if r.get("situacao") != "enviar" or not r.get("url"):
        raise ErroArmazenamento(f"resposta inesperada de armazenamento/enviar para {caminho}")
    put = urllib.request.Request(r["url"], data=dados, method=r.get("metodo", "PUT"),
                                 headers=dict(r.get("cabecalhos") or {}))
    try:
        with urllib.request.urlopen(put, timeout=120):
            pass
    except urllib.error.HTTPError as e:
        raise ErroArmazenamento(f"o R2 recusou o PUT de {caminho}: HTTP {e.code}") from None
    except urllib.error.URLError as e:
        raise ErroArmazenamento(f"falha de rede no PUT de {caminho}: {e.reason}") from None
    c = _chamar_funcao(url, chave, segredo, {"acao": "confirmar", "pasta": PASTA, "caminho": caminho})
    if c.get("situacao") != "confirmado":
        raise ErroArmazenamento(f"resposta inesperada de armazenamento/confirmar para {caminho}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--obra", required=True, help="slug da obra (pasta data/<slug>/ com obra.json)")
    ap.add_argument("--dry-run", action="store_true", help="só lista caminho local -> caminho remoto")
    args = ap.parse_args(argv)
    base = base_da_obra(args.obra)

    if args.dry_run:
        pares = mapear_caminhos(base, ID_FICTICIO)
        for arquivo, caminho in pares:
            print(f"{arquivo.relative_to(ROOT)} -> {PASTA}/{caminho}")
        print(f"{len(pares)} arquivos (simulação, nada enviado)")
        return 0

    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    chave = os.environ.get("SUPABASE_SECRET_KEY", "")
    if not url or not chave:
        print("Defina SUPABASE_URL e SUPABASE_SECRET_KEY.", file=sys.stderr)
        return 2
    try:
        obra_id = obter_obra_id(url, chave, args.obra)
        segredo = obter_segredo(url, chave)
        pares = mapear_caminhos(base, obra_id)
        for i, (arquivo, caminho) in enumerate(pares, start=1):
            enviar(url, chave, segredo, arquivo, caminho)
            print(f"[{i}/{len(pares)}] {caminho}")
    except ErroArmazenamento as e:
        print(f"Erro: {e}", file=sys.stderr)
        return 1
    except urllib.error.HTTPError as e:
        print(f"Erro HTTP {e.code} em {e.url.split('?')[0]}: {e.read().decode('utf-8', 'replace')[:300]}", file=sys.stderr)
        return 1
    except urllib.error.URLError as e:
        print(f"Falha de rede: {e.reason}", file=sys.stderr)
        return 1
    print(f"Publicados {len(pares)} arquivos na pasta '{PASTA}' do R2.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
