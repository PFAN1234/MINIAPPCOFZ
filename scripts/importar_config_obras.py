"""Gera ``supabase/seed/admin_config.sql``: a configuração de cada obra (``data/<slug>/obra.json``)
na tabela ``obra_config`` do site de administração.

A configuração gravada é o ``obra.json`` sem ``slug`` e ``nome`` (que ficam na tabela ``obra``)
e com os pavimentos reduzidos a ``codigo``, ``pdf`` e ``pagina`` (nome e ordem ficam na tabela
``pavimento``, editada pelo site). O SQL é idempotente (``on conflict (obra_id) do update``) e
só grava obras que já existem no banco: aplique antes os seeds ``<slug>.sql``. Não editar o
SQL à mão: rode este script de novo depois de mudar um ``obra.json``.

Uso (na raiz do repositório)::

    python3 scripts/importar_config_obras.py              # todas as obras de data/
    python3 scripts/importar_config_obras.py --obra hto --obra cofz
    python3 scripts/importar_config_obras.py --verificar  # falha se o SQL estiver desatualizado
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SAIDA = ROOT / "supabase" / "seed" / "admin_config.sql"
SLUG_RE = re.compile(r"^[a-z0-9-]+$")
CAMPOS_PAVIMENTO = ("codigo", "pdf", "pagina")


def slugs_disponiveis() -> list[str]:
    return sorted(p.parent.name for p in (ROOT / "data").glob("*/obra.json"))


def carregar_obra(slug: str) -> dict:
    if not SLUG_RE.match(slug):
        raise ValueError(f"slug inválido: {slug!r}")
    arquivo = ROOT / "data" / slug / "obra.json"
    obra = json.loads(arquivo.read_text(encoding="utf-8"))
    if obra.get("slug") != slug:
        raise ValueError(f"{arquivo.relative_to(ROOT)} com slug '{obra.get('slug')}', esperado '{slug}'")
    return obra


def config_da_obra(obra: dict) -> dict:
    """``obra.json`` → config de ``obra_config`` (sem slug/nome; pavimentos só com codigo/pdf/pagina)."""
    config = {k: v for k, v in obra.items() if k not in ("slug", "nome")}
    if "pavimentos" in config:
        config["pavimentos"] = [
            {k: p[k] for k in CAMPOS_PAVIMENTO if k in p} for p in config["pavimentos"]
        ]
    return config


def literal_texto(valor: str) -> str:
    return "'" + valor.replace("'", "''") + "'"


def gerar_sql(slugs: list[str]) -> str:
    linhas = [
        "-- Gerado por scripts/importar_config_obras.py a partir de data/<slug>/obra.json — não editar à mão",
        "-- Configuração das obras no site de administração (tabela obra_config). Aplicar depois da",
        "-- migration 20261111170000_admin.sql e dos seeds das obras (hto.sql, cofz.sql).",
        "",
        "begin;",
        "",
    ]
    for slug in slugs:
        config = config_da_obra(carregar_obra(slug))
        texto = json.dumps(config, ensure_ascii=False, separators=(",", ":"))
        linhas.append(
            "insert into public.obra_config (obra_id, config, atualizado_em, atualizado_por) "
            f"select o.id, {literal_texto(texto)}::jsonb, now(), null from public.obra o "
            f"where o.slug = {literal_texto(slug)} "
            "on conflict (obra_id) do update set config = excluded.config, "
            "atualizado_em = excluded.atualizado_em, atualizado_por = excluded.atualizado_por;"
        )
    linhas += ["", "commit;", ""]
    return "\n".join(linhas)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--obra", action="append", help="slug da obra (repetível); padrão: todas de data/")
    ap.add_argument("--verificar", action="store_true", help="só confere se o SQL gravado está atualizado")
    args = ap.parse_args(argv)
    slugs = sorted(set(args.obra)) if args.obra else slugs_disponiveis()
    sql = gerar_sql(slugs)
    if args.verificar:
        atual = SAIDA.read_text(encoding="utf-8") if SAIDA.exists() else ""
        if atual != sql:
            print(f"{SAIDA.relative_to(ROOT)} desatualizado: rode scripts/importar_config_obras.py", file=sys.stderr)
            return 1
        print(f"{SAIDA.relative_to(ROOT)} atualizado ({', '.join(slugs)})")
        return 0
    SAIDA.write_text(sql, encoding="utf-8")
    print(f"{SAIDA.relative_to(ROOT)}: {len(slugs)} obra(s) ({', '.join(slugs)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
