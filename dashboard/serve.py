#!/usr/bin/env python3
"""Servidor local do Painel HTO.

Uso:
    python3 dashboard/serve.py [--port 8787] [--host 127.0.0.1]

Rotas:
    /                 painel
    /styles.css       estilos
    /app.js           cliente
    /api/data         snapshot JSON coletado na hora
    /files/<path>     arquivos do projeto (somente leitura, dentro da raiz)
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import sys
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

DASHBOARD = Path(__file__).resolve().parent
ROOT = DASHBOARD.parent
sys.path.insert(0, str(DASHBOARD))

from collect import collect  # noqa: E402

STATIC = {
    "/": DASHBOARD / "index.html",
    "/index.html": DASHBOARD / "index.html",
    "/styles.css": DASHBOARD / "styles.css",
    "/app.js": DASHBOARD / "app.js",
    "/estimates.json": DASHBOARD / "estimates.json",
}


class Handler(BaseHTTPRequestHandler):
    server_version = "HTOPainel/1.0"

    def log_message(self, fmt: str, *args) -> None:  # quieter logs
        if args and str(args[1] if len(args) > 1 else "") not in ("200", "204", "304"):
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _send(self, code: int, body: bytes, content_type: str, cache: str = "no-store") -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self._send(code, body, "application/json; charset=utf-8")

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = unquote(parsed.path)

        if path == "/favicon.ico":
            self._send(204, b"", "image/x-icon")
            return

        if path == "/api/data":
            try:
                self._json(200, collect())
            except Exception as exc:  # keep the panel usable and show the error
                traceback.print_exc()
                self._json(500, {"error": str(exc), "hint": "Verifique as fontes em dashboard/collect.py."})
            return

        if path in STATIC:
            file = STATIC[path]
            try:
                body = file.read_bytes()
            except OSError:
                self._send(404, b"Arquivo nao encontrado", "text/plain; charset=utf-8")
                return
            ctype = mimetypes.guess_type(str(file))[0] or "application/octet-stream"
            if file.suffix == ".html":
                ctype = "text/html; charset=utf-8"
            elif file.suffix == ".css":
                ctype = "text/css; charset=utf-8"
            elif file.suffix == ".js":
                ctype = "application/javascript; charset=utf-8"
            cache = "no-store"
            self._send(200, body, ctype, cache)
            return

        if path.startswith("/files/"):
            rel = path[len("/files/"):]
            target = (ROOT / rel).resolve()
            try:
                target.relative_to(ROOT.resolve())
            except ValueError:
                self._send(403, b"Acesso negado", "text/plain; charset=utf-8")
                return
            if not target.is_file():
                self._send(404, b"Arquivo nao encontrado", "text/plain; charset=utf-8")
                return
            try:
                body = target.read_bytes()
            except OSError as exc:
                self._send(500, str(exc).encode("utf-8"), "text/plain; charset=utf-8")
                return
            ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
            if target.suffix in (".md", ".txt"):
                ctype = "text/plain; charset=utf-8"
            self._send(200, body, ctype, "public, max-age=120")
            return

        self._send(404, b"Nao encontrado", "text/plain; charset=utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Servidor do Painel HTO")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    url = f"http://{args.host}:{args.port}/"
    print(f"Painel HTO disponível em {url}")
    print("Pressione Ctrl+C para encerrar.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nEncerrando.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
