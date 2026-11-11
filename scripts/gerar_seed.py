"""Gera o seed SQL de uma obra a partir de ``data/<slug>/ambientes.json`` e ``data/<slug>/plantas.json``.

O nome da obra vem de ``data/<slug>/obra.json``. Saída: ``supabase/seed/<slug>.sql``. O arquivo é idempotente (``on conflict ... do
update``) e envolvido em ``begin; ... commit;``. Não editar o SQL à mão: rode
este script de novo depois de mudar a lista de ambientes.

Revisões da planta: os ambientes da lista ficam com ``ativo = true`` e os de
``ambientes_removidos`` passam a ``ativo = false`` (nada é apagado, porque
``registro`` referencia ``ambiente``). Antes de gravar a planta de um pavimento, a
planta ativa de outra revisão é desativada; ela e os seus detalhes ficam como histórico.

Uso (na raiz do repositório)::

    python3 scripts/gerar_seed.py --obra hto
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SLUG_RE = re.compile(r"^[a-z0-9-]+$")


def cabecalho(slug: str) -> str:
    return (f"-- Gerado por scripts/gerar_seed.py a partir de data/{slug}/ambientes.json "
            f"e data/{slug}/plantas.json — não editar à mão")


def carregar_obra(slug: str) -> dict:
    """Lê ``data/<slug>/obra.json`` (só ``slug`` e ``nome`` são usados aqui)."""
    if not SLUG_RE.match(slug):
        raise ValueError(f"slug inválido: {slug!r}")
    arquivo = ROOT / "data" / slug / "obra.json"
    obra = json.loads(arquivo.read_text(encoding="utf-8"))
    if obra.get("slug") != slug:
        raise ValueError(f"{arquivo.relative_to(ROOT)} com slug '{obra.get('slug')}', esperado '{slug}'")
    return obra


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


def _insert_obra(slug: str, nome: str) -> str:
    return (
        f"insert into public.obra (slug, nome) values ({literal(slug)}, {literal(nome)}) "
        "on conflict (slug) do update set nome = excluded.nome;"
    )


def _insert_pavimento(slug: str, codigo: str, nome: str, ordem: int) -> str:
    return (
        "insert into public.pavimento (obra_id, codigo, nome, ordem) "
        f"select o.id, {literal(codigo)}, {literal(nome)}, {literal(ordem)} "
        f"from public.obra o where o.slug = {literal(slug)} "
        "on conflict (obra_id, codigo) do update set nome = excluded.nome, ordem = excluded.ordem;"
    )


def _insert_ambiente(slug: str, amb: dict, ordem: int) -> str:
    colunas = ("obra_id, pavimento_id, codigo, nome_operacional, nome_planta, categoria, "
               "area_m2, revisao_planta, marcadores, ordem, ativo")
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
        "true",
    ])
    atualizar = ", ".join(
        f"{c} = excluded.{c}"
        for c in ("pavimento_id", "nome_operacional", "nome_planta", "categoria",
                  "area_m2", "revisao_planta", "marcadores", "ordem", "ativo")
    )
    return (
        f"insert into public.ambiente ({colunas}) "
        f"select {valores} "
        "from public.obra o join public.pavimento p on p.obra_id = o.id "
        f"and p.codigo = {literal(amb['pavimento'])} "
        f"where o.slug = {literal(slug)} "
        f"on conflict (obra_id, codigo) do update set {atualizar};"
    )


def _inativar_ambiente(slug: str, codigo: str) -> str:
    """Marca como inativo um ambiente que saiu da planta (sem erro se ele não existir no banco)."""
    return (
        "update public.ambiente a set ativo = false from public.obra o "
        f"where a.obra_id = o.id and o.slug = {literal(slug)} and a.codigo = {literal(codigo)} "
        "and a.ativo;"
    )


def _inativar_fora_da_lista(slug: str, codigos: list[str]) -> str:
    """Inativa qualquer ambiente da obra que não esteja na lista atual.

    Cobre ids que chegaram ao banco e depois sumiram da lista sem passar por
    ``ambientes_removidos`` (ex.: seed aplicado antes de confirmar um ``manter_codigo``).
    """
    lista = ", ".join(literal(c) for c in codigos)
    return (
        "update public.ambiente a set ativo = false from public.obra o "
        f"where a.obra_id = o.id and o.slug = {literal(slug)} and a.ativo "
        f"and a.codigo <> all (array[{lista}]::text[]);"
    )


def _desativar_plantas_anteriores(slug: str, pav: dict) -> str:
    """Desativa a planta ativa de outra revisão do pavimento (índice único ``planta_ativa_unica``)."""
    return (
        "update public.planta pl set ativa = false "
        "from public.obra o join public.pavimento p on p.obra_id = o.id "
        f"and p.codigo = {literal(pav['id'])} "
        f"where o.slug = {literal(slug)} and pl.pavimento_id = p.id "
        f"and pl.revisao <> {literal(pav['revisao'])} and pl.ativa;"
    )


def _array_numeric(valores: list) -> str:
    return "array[" + ", ".join(literal(float(v)) for v in valores) + "]::numeric[]"


def _caminho(obra_id: str, *partes: str) -> str:
    """Expressão SQL do caminho no bucket: ``<obra_id>/<partes...>``."""
    return f"{obra_id}::text || {literal('/' + '/'.join(partes))}"


def _insert_planta(slug: str, pav: dict) -> str:
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
        f"where o.slug = {literal(slug)} "
        f"on conflict (pavimento_id, revisao) do update set {atualizar};"
    )


def _insert_detalhe(slug: str, pav: dict, codigo: str, det: dict) -> str:
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
        f"where o.slug = {literal(slug)} "
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


def validar_removidos(dados: dict) -> None:
    """Um id não pode estar ao mesmo tempo na lista e em ``ambientes_removidos``."""
    ativos = {a["id"] for a in dados["ambientes"]}
    conflito = sorted(r["id"] for r in dados.get("ambientes_removidos", []) if r["id"] in ativos)
    if conflito:
        raise ValueError("ids em 'ambientes' e em 'ambientes_removidos' ao mesmo tempo: " + ", ".join(conflito))


def gerar(dados: dict, plantas: dict | None = None, obra: dict | None = None) -> str:
    """Monta o conteúdo do seed a partir dos JSONs já lidos.

    A obra é a de ``dados["obra"]``. ``plantas`` é o conteúdo de
    ``data/<slug>/plantas.json`` e ``obra`` o de ``data/<slug>/obra.json``; se
    omitidos, são lidos do disco. Não grava nada.
    """
    slug = dados["obra"]
    if obra is None:
        obra = carregar_obra(slug)
    if obra["slug"] != slug:
        raise ValueError(f"obra.json é da obra '{obra['slug']}', mas ambientes.json é de '{slug}'")
    if plantas is None:
        plantas = json.loads((ROOT / "data" / slug / "plantas.json").read_text(encoding="utf-8"))
    if plantas.get("obra", slug) != slug:
        raise ValueError(f"plantas.json é da obra '{plantas['obra']}', esperado '{slug}'")
    validar_plantas(dados, plantas)
    validar_removidos(dados)
    linhas = [cabecalho(slug), "", "begin;", "", _insert_obra(slug, obra["nome"]), ""]
    for ordem, pav in enumerate(dados["pavimentos"], start=1):
        linhas.append(_insert_pavimento(slug, pav["id"], pav["nome"], ordem))
    linhas.append("")
    for ordem, amb in enumerate(dados["ambientes"], start=1):
        linhas.append(_insert_ambiente(slug, amb, ordem))
    linhas.append("")
    for r in dados.get("ambientes_removidos", []):
        linhas.append(_inativar_ambiente(slug, r["id"]))
    linhas.append(_inativar_fora_da_lista(slug, [a["id"] for a in dados["ambientes"]]))
    linhas.append("")
    por_id = {p["id"]: p for p in plantas["pavimentos"]}
    pavs = [por_id[p["id"]] for p in dados["pavimentos"]]
    for pav in pavs:
        linhas.append(_desativar_plantas_anteriores(slug, pav))
        linhas.append(_insert_planta(slug, pav))
    linhas.append("")
    ambientes_por_pav: dict[str, list[str]] = {}
    for amb in dados["ambientes"]:
        ambientes_por_pav.setdefault(amb["pavimento"], []).append(amb["id"])
    for pav in pavs:
        for codigo in ambientes_por_pav.get(pav["id"], []):
            linhas.append(_insert_detalhe(slug, pav, codigo, pav["detalhes"][codigo]))
    linhas += ["", "commit;", ""]
    return "\n".join(linhas)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Gera o seed SQL de uma obra.")
    ap.add_argument("--obra", required=True, help="slug da obra (pasta data/<slug>/ com obra.json)")
    args = ap.parse_args(argv)

    try:
        obra = carregar_obra(args.obra)
    except (ValueError, FileNotFoundError) as e:
        raise SystemExit(str(e))
    base = ROOT / "data" / obra["slug"]
    dados = json.loads((base / "ambientes.json").read_text(encoding="utf-8"))
    plantas = json.loads((base / "plantas.json").read_text(encoding="utf-8"))
    saida = ROOT / "supabase" / "seed" / f"{obra['slug']}.sql"
    saida.parent.mkdir(parents=True, exist_ok=True)
    saida.write_text(gerar(dados, plantas, obra), encoding="utf-8")
    if dados.get("status") != "revisado":
        print(f"Atenção: ambientes.json com status '{dados.get('status')}' (lista ainda sem revisão humana).")
    print(f"Pavimentos: {len(dados['pavimentos'])}")
    print(f"Ambientes: {len(dados['ambientes'])}")
    if dados.get("ambientes_removidos"):
        print(f"Ambientes removidos (ficam inativos): {len(dados['ambientes_removidos'])}")
    print(f"Plantas: {len(plantas['pavimentos'])}")
    print(f"Gerado: {saida.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
