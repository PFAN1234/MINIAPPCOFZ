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


class _Resp:
    def __init__(self, corpo=b""):
        self._corpo = corpo

    def read(self):
        return self._corpo

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _falso_urlopen(chamadas, falhar_em=None):
    import io
    import urllib.error

    def urlopen(req, timeout=None):
        corpo = json.loads(req.data) if req.full_url.endswith("/functions/v1/armazenamento") else None
        chamadas.append((req.full_url, req.get_method(), dict(req.header_items()), corpo, req.data))
        acao = corpo["acao"] if corpo else "put"
        if acao == falhar_em:
            raise urllib.error.HTTPError(req.full_url, 409, "x", {}, io.BytesIO(b'{"erro":"divergente"}'))
        if acao == "enviar":
            return _Resp(json.dumps({
                "situacao": "enviar", "url": "https://r2.exemplo/assinada?sig=SEGREDO-ASSINADO", "metodo": "PUT",
                "cabecalhos": {"content-type": "image/webp"}, "expira_em": "x",
            }).encode())
        if acao == "confirmar":
            return _Resp(b'{"situacao":"confirmado"}')
        return _Resp()

    return urlopen


def test_enviar_planta_pelo_armazenamento(tmp_path, monkeypatch):
    import urllib.request
    publicar = _carregar("publicar_plantas", "scripts/publicar_plantas.py")
    arq = tmp_path / "planta.webp"
    arq.write_bytes(b"12345")
    chamadas = []
    monkeypatch.setattr(urllib.request, "urlopen", _falso_urlopen(chamadas))
    publicar.enviar("https://p.supabase.co", "CHAVE", "SEG", arq, "O/R05/terreo/planta.webp")
    assert [(c[1], c[3] and c[3]["acao"]) for c in chamadas] == [
        ("POST", "enviar"), ("PUT", None), ("POST", "confirmar")]
    assert chamadas[0][3] == {"acao": "enviar", "pasta": "plantas", "caminho": "O/R05/terreo/planta.webp",
                              "tamanho": 5, "tipo": "image/webp"}
    assert chamadas[0][2]["X-segredo-interno"] == "SEG"
    assert chamadas[0][0] == "https://p.supabase.co/functions/v1/armazenamento"
    put = chamadas[1]
    assert put[0].startswith("https://r2.exemplo/assinada")
    assert put[4] == b"12345"
    assert put[2]["Content-type"] == "image/webp"
    assert "Authorization" not in put[2] and "Apikey" not in put[2]
    assert chamadas[2][3] == {"acao": "confirmar", "pasta": "plantas", "caminho": "O/R05/terreo/planta.webp"}


def test_enviar_planta_para_em_erro_sem_vazar(tmp_path, monkeypatch):
    import urllib.request
    publicar = _carregar("publicar_plantas", "scripts/publicar_plantas.py")
    arq = tmp_path / "planta.webp"
    arq.write_bytes(b"1")
    chamadas = []
    monkeypatch.setattr(urllib.request, "urlopen", _falso_urlopen(chamadas, falhar_em="confirmar"))
    with pytest.raises(publicar.ErroArmazenamento) as e:
        publicar.enviar("https://p.supabase.co", "CHAVE", "SEG", arq, "O/a.webp")
    msg = str(e.value)
    assert "409" in msg and "divergente" in msg
    assert "CHAVE" not in msg and "SEG" not in msg and "SEGREDO-ASSINADO" not in msg


def test_enviar_planta_nao_confirma_se_put_falha(tmp_path, monkeypatch):
    import urllib.request
    publicar = _carregar("publicar_plantas", "scripts/publicar_plantas.py")
    arq = tmp_path / "planta.webp"
    arq.write_bytes(b"1")
    chamadas = []
    monkeypatch.setattr(urllib.request, "urlopen", _falso_urlopen(chamadas, falhar_em="put"))
    with pytest.raises(publicar.ErroArmazenamento) as e:
        publicar.enviar("https://p.supabase.co", "CHAVE", "SEG", arq, "O/a.webp")
    assert "SEGREDO-ASSINADO" not in str(e.value)
    assert [c[1] for c in chamadas] == ["POST", "PUT"]


def test_segredo_interno_do_ambiente_ou_da_rpc(monkeypatch):
    import urllib.request
    publicar = _carregar("publicar_plantas", "scripts/publicar_plantas.py")
    monkeypatch.setenv("SEGREDO_INTERNO", "DO_AMBIENTE")
    assert publicar.obter_segredo("https://p.supabase.co", "CHAVE") == "DO_AMBIENTE"
    monkeypatch.delenv("SEGREDO_INTERNO")
    visto = []

    def urlopen(req, timeout=None):
        visto.append(req.full_url)
        return _Resp(b'"DA_RPC"')

    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    assert publicar.obter_segredo("https://p.supabase.co", "CHAVE") == "DA_RPC"
    assert visto == ["https://p.supabase.co/rest/v1/rpc/segredo_interno"]


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
    assert "values ('hto', 'Hotel de Trânsito d''Oficiais', (select e.id from public.etapa e where e.slug = '2a-etapa'))" in sql
    with pytest.raises(ValueError, match="cofz"):
        seed_mod.gerar(DADOS, obra={"slug": "cofz", "nome": "COFZ"})
