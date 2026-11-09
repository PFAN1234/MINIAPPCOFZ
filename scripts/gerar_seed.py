"""Gera o seed SQL da HTO a partir de ``data/hto/ambientes.json``.

Saída: ``supabase/seed/hto.sql``. O arquivo é idempotente (``on conflict ... do
update``) e envolvido em ``begin; ... commit;``. Não editar o SQL à mão: rode
este script de novo depois de mudar a lista de ambientes.

Uso (na raiz do repositório)::

    python3 scripts/gerar_seed.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENTRADA = ROOT / "data/hto/ambientes.json"
SAIDA = ROOT / "supabase/seed/hto.sql"

CABECALHO = "-- Gerado por scripts/gerar_seed.py a partir de data/hto/ambientes.json — não editar à mão"


def literal(valor) -> str:
    """Converte um valor Python em literal SQL seguro para o seed.

    Strings têm aspas simples duplicadas. Listas e dicionários viram JSON compacto
    em texto com cast ``::jsonb``. ``None`` vira ``null``.
    """
    if valor is None:
        return "null"
    if isinstance(valor, bool):
        return "true" if valor else "false"
    if isinstance(valor, (int, float)):
        return repr(valor) if isinstance(valor, float) else str(valor)
    if isinstance(valor, str):
        return "'" + valor.replace("'", "''") + "'"
    if isinstance(valor, (dict, list)):
        texto = json.dumps(valor, ensure_ascii=False, separators=(",", ":"))
        return literal(texto) + "::jsonb"
    raise TypeError(f"tipo sem literal SQL: {type(valor).__name__}")


def _insert_obra() -> str:
    return (
        "insert into public.obra (slug, nome) values ('hto', 'HTO') "
        "on conflict (slug) do update set nome = excluded.nome;"
    )


def _insert_pavimento(codigo: str, nome: str, ordem: int) -> str:
    return (
        "insert into public.pavimento (obra_id, codigo, nome, ordem) "
        f"select o.id, {literal(codigo)}, {literal(nome)}, {literal(ordem)} "
        "from public.obra o where o.slug = 'hto' "
        "on conflict (obra_id, codigo) do update set nome = excluded.nome, ordem = excluded.ordem;"
    )


def _insert_ambiente(amb: dict, ordem: int) -> str:
    colunas = ("obra_id, pavimento_id, codigo, nome_operacional, nome_planta, categoria, "
               "area_m2, revisao_planta, marcadores, ordem")
    valores = ", ".join([
        "o.id",
        "p.id",
        literal(amb["id"]),
        literal(amb["nome_operacional"]),
        literal(amb["nome_planta"]),
        literal(amb["categoria"]),
        literal(amb["area_m2"]),
        literal(amb["revisao"]),
        literal(amb["marcadores"]),
        literal(ordem),
    ])
    atualizar = ", ".join(
        f"{c} = excluded.{c}"
        for c in ("pavimento_id", "nome_operacional", "nome_planta", "categoria",
                  "area_m2", "revisao_planta", "marcadores", "ordem")
    )
    return (
        f"insert into public.ambiente ({colunas}) "
        f"select {valores} "
        "from public.obra o join public.pavimento p on p.obra_id = o.id "
        f"and p.codigo = {literal(amb['pavimento'])} "
        "where o.slug = 'hto' "
        f"on conflict (obra_id, codigo) do update set {atualizar};"
    )


def gerar(dados: dict) -> str:
    """Monta o conteúdo do seed a partir do JSON já lido. Não toca em disco."""
    linhas = [CABECALHO, "", "begin;", "", _insert_obra(), ""]
    for ordem, pav in enumerate(dados["pavimentos"], start=1):
        linhas.append(_insert_pavimento(pav["id"], pav["nome"], ordem))
    linhas.append("")
    for ordem, amb in enumerate(dados["ambientes"], start=1):
        linhas.append(_insert_ambiente(amb, ordem))
    linhas += ["", "commit;", ""]
    return "\n".join(linhas)


def main() -> int:
    dados = json.loads(ENTRADA.read_text(encoding="utf-8"))
    SAIDA.parent.mkdir(parents=True, exist_ok=True)
    SAIDA.write_text(gerar(dados), encoding="utf-8")
    print(f"Pavimentos: {len(dados['pavimentos'])}")
    print(f"Ambientes: {len(dados['ambientes'])}")
    print(f"Gerado: {SAIDA.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
