import importlib.util
import json
from pathlib import Path

import pytest

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
    assert sum("p.codigo = 'terreo'" in linha for linha in LINHAS if linha.startswith("insert into public.ambiente ")) == 44
    assert sum("p.codigo = '1pav'" in linha for linha in LINHAS if linha.startswith("insert into public.ambiente ")) == 43


def test_arquivo_commitado_esta_atualizado():
    commitado = (ROOT / "supabase/seed/hto.sql").read_text(encoding="utf-8")
    assert commitado == SQL, "supabase/seed/hto.sql desatualizado: rode python3 scripts/gerar_seed.py --obra hto"


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


def test_contagem_de_plantas_e_detalhes():
    assert _contar("insert into public.planta ") == 2
    assert _contar("insert into public.planta_detalhe ") == 87


def test_caminhos_das_plantas_no_formato_acordado():
    assert "o.id::text || '/R05/terreo/planta.webp'" in SQL
    assert "o.id::text || '/R05/1pav/planta-hd.webp'" in SQL
    assert "o.id::text || '/R05/terreo/ambientes/terreo-apto-101.webp'" in SQL
    assert "array[83.437, 30.307, 2026.332, 1602.901]::numeric[]" in SQL


def test_seed_falha_se_faltar_detalhe():
    plantas = json.loads((ROOT / "data/hto/plantas.json").read_text(encoding="utf-8"))
    del plantas["pavimentos"][0]["detalhes"]["terreo-apto-101"]
    with pytest.raises(ValueError, match="terreo-apto-101"):
        seed_mod.gerar(DADOS, plantas)


def test_mapeamento_de_caminhos_da_publicacao(tmp_path):
    publicar = _carregar("publicar_plantas", "scripts/publicar_plantas.py")
    for rel in ("R05/terreo/planta.webp", "R05/terreo/planta-hd.webp", "R05/terreo/prova.png",
                "R05/terreo/ambientes/terreo-apto-101.webp"):
        arq = tmp_path / rel
        arq.parent.mkdir(parents=True, exist_ok=True)
        arq.write_bytes(b"x")
    pares = publicar.mapear_caminhos(tmp_path, "OBRA")
    assert sorted(c for _, c in pares) == [
        "OBRA/R05/terreo/ambientes/terreo-apto-101.webp",
        "OBRA/R05/terreo/planta-hd.webp",
        "OBRA/R05/terreo/planta.webp",
    ]
    reais = publicar.mapear_caminhos(ROOT / "data/hto/plantas", "OBRA")
    assert len(reais) == 2 * 2 + 87


def test_geracao_deterministica():
    assert seed_mod.gerar(DADOS) == SQL


@pytest.mark.parametrize("script", ["extrair_ambientes", "gerar_plantas", "gerar_seed", "publicar_plantas"])
def test_scripts_exigem_obra(script, capsys):
    mod = _carregar(script, f"scripts/{script}.py")
    with pytest.raises(SystemExit) as erro:
        mod.main([])
    assert erro.value.code == 2
    assert "--obra" in capsys.readouterr().err


def test_seed_usa_nome_da_configuracao():
    obra = {"slug": "hto", "nome": "Hotel de Trânsito d'Oficiais"}
    sql = seed_mod.gerar(DADOS, obra=obra)
    assert "values ('hto', 'Hotel de Trânsito d''Oficiais')" in sql
    with pytest.raises(ValueError, match="cofz"):
        seed_mod.gerar(DADOS, obra={"slug": "cofz", "nome": "COFZ"})
