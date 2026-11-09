"""Gera o seed SQL da HTO a partir de ``data/hto/ambientes.json`` e ``data/hto/plantas.json``.

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
ENTRADA_PLANTAS = ROOT / "data/hto/plantas.json"
SAIDA = ROOT / "supabase/seed/hto.sql"

CABECALHO = "-- Gerado por scripts/gerar_seed.py a partir de data/hto/ambientes.json e data/hto/plantas.json — não editar à mão"


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


def _array_numeric(valores: list) -> str:
    return "array[" + ", ".join(literal(float(v)) for v in valores) + "]::numeric[]"


def _caminho(obra_id: str, *partes: str) -> str:
    """Expressão SQL do caminho no bucket: ``<obra_id>/<partes...>``."""
    return f"{obra_id}::text || {literal('/' + '/'.join(partes))}"


def _insert_planta(pav: dict) -> str:
    base = (pav["revisao"], pav["id"])
    planta, hd = pav["imagens"]["planta"], pav["imagens"]["planta-hd"]
    largura_pt, altura_pt = pav["pagina_pt"]
    colunas = ("obra_id, pavimento_id, revisao, pdf_sha256, pagina_largura_pt, pagina_altura_pt, "
               "recorte_pt, imagem_path, imagem_largura, imagem_altura, imagem_hd_path, "
               "imagem_hd_largura, imagem_hd_altura, ativa")
    valores = ", ".join([
        "o.id", "p.id", literal(pav["revisao"]), literal(pav["sha256"]),
        literal(float(largura_pt)), literal(float(altura_pt)),
        _array_numeric(pav["recorte_pt"]),
        _caminho("o.id", *base, "planta.webp"),
        literal(planta["largura"]), literal(planta["altura"]),
        _caminho("o.id", *base, "planta-hd.webp"),
        literal(hd["largura"]), literal(hd["altura"]),
        "true",
    ])
    atualizar = ", ".join(
        f"{c} = excluded.{c}"
        for c in ("pdf_sha256", "pagina_largura_pt", "pagina_altura_pt", "recorte_pt", "imagem_path",
                  "imagem_largura", "imagem_altura", "imagem_hd_path", "imagem_hd_largura",
                  "imagem_hd_altura", "ativa")
    )
    return (
        f"insert into public.planta ({colunas}) "
        f"select {valores} "
        "from public.obra o join public.pavimento p on p.obra_id = o.id "
        f"and p.codigo = {literal(pav['id'])} "
        "where o.slug = 'hto' "
        f"on conflict (pavimento_id, revisao) do update set {atualizar};"
    )


def _insert_detalhe(pav: dict, codigo: str, det: dict) -> str:
    colunas = "planta_id, obra_id, ambiente_id, imagem_path, recorte_pt, largura, altura"
    valores = ", ".join([
        "pl.id", "o.id", "a.id",
        _caminho("o.id", pav["revisao"], pav["id"], "ambientes", f"{codigo}.webp"),
        _array_numeric(det["recorte_pt"]),
        literal(det["largura"]), literal(det["altura"]),
    ])
    atualizar = ", ".join(f"{c} = excluded.{c}" for c in ("obra_id", "imagem_path", "recorte_pt", "largura", "altura"))
    return (
        f"insert into public.planta_detalhe ({colunas}) "
        f"select {valores} "
        "from public.obra o "
        "join public.pavimento p on p.obra_id = o.id "
        f"and p.codigo = {literal(pav['id'])} "
        f"join public.planta pl on pl.pavimento_id = p.id and pl.revisao = {literal(pav['revisao'])} "
        f"join public.ambiente a on a.obra_id = o.id and a.codigo = {literal(codigo)} "
        "where o.slug = 'hto' "
        f"on conflict (planta_id, ambiente_id) do update set {atualizar};"
    )


def validar_plantas(dados: dict, plantas: dict) -> None:
    """Falha com mensagem clara se faltar planta de pavimento ou detalhe de ambiente."""
    por_id = {p["id"]: p for p in plantas["pavimentos"]}
    for pav in dados["pavimentos"]:
        if pav["id"] not in por_id:
            raise ValueError(f"plantas.json sem o pavimento '{pav['id']}'")
    faltando = [a["id"] for a in dados["ambientes"]
                if a["id"] not in por_id.get(a["pavimento"], {}).get("detalhes", {})]
    if faltando:
        raise ValueError("plantas.json sem detalhe para os ambientes: " + ", ".join(faltando))


def gerar(dados: dict, plantas: dict | None = None) -> str:
    """Monta o conteúdo do seed a partir dos JSONs já lidos. Não toca em disco.

    ``plantas`` é o conteúdo de ``data/hto/plantas.json``; se omitido, é lido do disco.
    """
    if plantas is None:
        plantas = json.loads(ENTRADA_PLANTAS.read_text(encoding="utf-8"))
    validar_plantas(dados, plantas)
    linhas = [CABECALHO, "", "begin;", "", _insert_obra(), ""]
    for ordem, pav in enumerate(dados["pavimentos"], start=1):
        linhas.append(_insert_pavimento(pav["id"], pav["nome"], ordem))
    linhas.append("")
    for ordem, amb in enumerate(dados["ambientes"], start=1):
        linhas.append(_insert_ambiente(amb, ordem))
    linhas.append("")
    por_id = {p["id"]: p for p in plantas["pavimentos"]}
    pavs = [por_id[p["id"]] for p in dados["pavimentos"]]
    for pav in pavs:
        linhas.append(_insert_planta(pav))
    linhas.append("")
    ambientes_por_pav: dict[str, list[str]] = {}
    for amb in dados["ambientes"]:
        ambientes_por_pav.setdefault(amb["pavimento"], []).append(amb["id"])
    for pav in pavs:
        for codigo in ambientes_por_pav.get(pav["id"], []):
            linhas.append(_insert_detalhe(pav, codigo, pav["detalhes"][codigo]))
    linhas += ["", "commit;", ""]
    return "\n".join(linhas)


def main() -> int:
    dados = json.loads(ENTRADA.read_text(encoding="utf-8"))
    plantas = json.loads(ENTRADA_PLANTAS.read_text(encoding="utf-8"))
    SAIDA.parent.mkdir(parents=True, exist_ok=True)
    SAIDA.write_text(gerar(dados, plantas), encoding="utf-8")
    print(f"Pavimentos: {len(dados['pavimentos'])}")
    print(f"Ambientes: {len(dados['ambientes'])}")
    print(f"Plantas: {len(plantas['pavimentos'])}")
    print(f"Gerado: {SAIDA.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
