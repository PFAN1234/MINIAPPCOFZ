"""scripts/importar_config_obras.py: configuração das obras para o site de administração."""
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

spec = importlib.util.spec_from_file_location("importar_config_obras", ROOT / "scripts" / "importar_config_obras.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def test_config_sem_slug_e_nome_e_pavimentos_reduzidos():
    obra = json.loads((ROOT / "data" / "hto" / "obra.json").read_text(encoding="utf-8"))
    config = mod.config_da_obra(obra)
    assert "slug" not in config and "nome" not in config
    assert config["pavimentos"] == [
        {"codigo": "terreo", "pdf": "CE01-14PE01-ARQ-DE017-R05.pdf", "pagina": 1},
        {"codigo": "1pav", "pdf": "CE01-14PE01-ARQ-DE018-R05.pdf", "pagina": 1},
    ]
    for campo in ("status", "revisao", "prancha", "nomes_fixos", "categorias", "revisao_humana"):
        assert config[campo] == obra[campo]
    assert obra["slug"] == "hto"  # não altera o original


def test_sql_escapa_aspas_e_e_idempotente():
    sql = mod.gerar_sql(["hto", "cofz"])
    assert sql.count("on conflict (obra_id) do update") == 2
    assert sql.startswith("-- Gerado por scripts/importar_config_obras.py")
    assert "begin;" in sql and sql.rstrip().endswith("commit;")
    assert mod.literal_texto("d'água") == "'d''água'"


def test_seed_gravado_esta_atualizado():
    assert (ROOT / "supabase" / "seed" / "admin_config.sql").read_text(encoding="utf-8") == mod.gerar_sql(
        mod.slugs_disponiveis())
    assert mod.main(["--verificar"]) == 0
