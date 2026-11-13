#!/usr/bin/env python3
"""Banco de produção pela API de gerenciamento do Supabase, lendo os arquivos do disco.

No Claude Code na nuvem, o token é um segredo de rede que o proxy põe no cabeçalho das chamadas a
api.supabase.com. Na máquina local, lê SUPABASE_ACCESS_TOKEN do ambiente ou do `.env` (ignorado pelo Git).

Uso:
  python3 scripts/supabase_api.py pendentes              # migrations do repositório ainda não aplicadas
  python3 scripts/supabase_api.py aplicar <arquivo.sql>  # aplica numa transação e registra no histórico
  python3 scripts/supabase_api.py sql "<consulta>"       # roda SQL e imprime o resultado em JSON
"""
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

PROJETO = "nyfcualazkngqmrxcczh"  # miniappcofz-dev
URL = f"https://api.supabase.com/v1/projects/{PROJETO}/database/query"
RAIZ = Path(__file__).resolve().parent.parent
MIGRATIONS = RAIZ / "supabase" / "migrations"


def token() -> str:
    if os.environ.get("SUPABASE_ACCESS_TOKEN"):
        return os.environ["SUPABASE_ACCESS_TOKEN"]
    env = RAIZ / ".env"
    if env.exists():
        for linha in env.read_text(encoding="utf-8").splitlines():
            if linha.startswith("SUPABASE_ACCESS_TOKEN="):
                return linha.split("=", 1)[1].strip().strip("\"'")
    return "proxy-injected"


def sql(consulta: str):
    req = urllib.request.Request(
        URL,
        data=json.dumps({"query": consulta}).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token()}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        sys.exit(f"Erro {e.code}: {e.read().decode(errors='replace')[:2000]}")


def literal(texto: str) -> str:
    return "'" + texto.replace("'", "''") + "'"


def aplicadas() -> set[str]:
    return {l["name"] for l in sql("select name from supabase_migrations.schema_migrations")}


def nome(arquivo: Path) -> tuple[str, str]:
    versao, _, resto = arquivo.stem.partition("_")
    return versao, resto


def pendentes() -> list[Path]:
    feitas = aplicadas()
    return [m for m in sorted(MIGRATIONS.glob("*.sql")) if nome(m)[1] not in feitas]


def aplicar(caminho: str) -> None:
    arquivo = Path(caminho).resolve()
    versao, n = nome(arquivo)
    if n in aplicadas():
        sys.exit(f"{arquivo.name} já está no histórico; nada feito.")
    corpo = arquivo.read_text()
    historico = (
        "insert into supabase_migrations.schema_migrations (version, name, statements) "
        f"values ({literal(versao)}, {literal(n)}, array[{literal(corpo)}]);"
    )
    sql(f"begin;\n{corpo}\n;\n{historico}\ncommit;")
    print(f"Aplicada: {arquivo.name}")


if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in ("pendentes", "aplicar", "sql"):
        sys.exit(__doc__)
    if sys.argv[1] == "pendentes":
        for m in pendentes():
            print(m.name)
    elif sys.argv[1] == "aplicar":
        aplicar(sys.argv[2])
    else:
        print(json.dumps(sql(sys.argv[2]), ensure_ascii=False, indent=1))
