import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _carregar(nome, rel):
    spec = importlib.util.spec_from_file_location(nome, ROOT / rel)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


seed_mod = _carregar("gerar_seed", "scripts/gerar_seed.py")

DADOS = json.loads((ROOT / "data/hto/ambientes.json").read_text(encoding="utf-8"))
SQL = seed_mod.gerar(DADOS)
LINHAS = SQL.splitlines()


def _contar(prefixo):
    return sum(1 for linha in LINHAS if linha.startswith(prefixo))


def test_contagem_de_inserts():
    assert _contar("insert into public.obra ") == 1
    assert _contar("insert into public.pavimento ") == 2
    assert _contar("insert into public.ambiente ") == 87


def test_contagem_por_pavimento():
    assert sum("p.codigo = 'terreo'" in linha for linha in LINHAS) == 44
    assert sum("p.codigo = '1pav'" in linha for linha in LINHAS) == 43


def test_arquivo_commitado_esta_atualizado():
    commitado = (ROOT / "supabase/seed/hto.sql").read_text(encoding="utf-8")
    assert commitado == SQL, "supabase/seed/hto.sql desatualizado: rode python3 scripts/gerar_seed.py"


def test_saida_envolvida_em_transacao_e_com_newline():
    assert SQL.startswith("-- Gerado por scripts/gerar_seed.py a partir de data/hto/ambientes.json")
    assert "\nbegin;\n" in SQL
    assert SQL.rstrip("\n").endswith("commit;")
    assert SQL.endswith("\n")


def test_escape_de_aspas_simples():
    assert seed_mod.literal("Apto. d'água") == "'Apto. d''água'"


def test_literal_de_none_e_numeros():
    assert seed_mod.literal(None) == "null"
    assert seed_mod.literal(23.88) == "23.88"
    assert seed_mod.literal(3) == "3"


def test_literal_de_json_com_cast_jsonb():
    assert seed_mod.literal([{"x": 0.5}]) == "'[{\"x\":0.5}]'::jsonb"
    assert seed_mod.literal({"a": "b'c"}) == "'{\"a\":\"b''c\"}'::jsonb"


def test_area_nula_aparece_como_null():
    amb = next(a for a in DADOS["ambientes"] if a["id"] == "terreo-jardim-2")
    assert amb["area_m2"] is None
    linha = next(linha for linha in LINHAS if "'terreo-jardim-2'" in linha)
    assert ", null, 'R05'," in linha


def test_seed_contem_ambiente_conhecido():
    assert "'terreo-apto-101'" in SQL
    assert "23.88" in SQL


def test_geracao_deterministica():
    assert seed_mod.gerar(DADOS) == SQL
