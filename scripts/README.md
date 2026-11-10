# Scripts da planta da HTO

Geram os dados e as imagens que o Mini App usa para localizar ambientes nas plantas de arquitetura (R05).

## O que cada script faz

- `extrair_ambientes.py`: lê `artifacts/validation/pdf/inventory.json` (textos das plantas com posição) e gera `data/hto/ambientes.json`, com nome, categoria, área e marcadores (pinos) de cada ambiente do térreo e do 1º pavimento.
- `gerar_plantas.py`: usa o PyMuPDF para renderizar os PDFs de `DOCS HTO/PDF/` (somente leitura) e gera, em `data/hto/plantas/R05/<pavimento>/`, a visão geral (`planta.webp`), a versão HD (`planta-hd.webp`), um recorte por ambiente (`ambientes/<id>.webp`) e `prova.png`. Também escreve o manifesto `data/hto/plantas.json`.

## Ordem de execução

Na raiz do repositório:

```bash
python3 scripts/extrair_ambientes.py
python3 scripts/gerar_plantas.py
```

O segundo depende da saída do primeiro.

## Publicar no Supabase

- `gerar_seed.py`: gera `supabase/seed/hto.sql` (obra, pavimentos, ambientes, plantas e detalhes) a partir de `data/hto/ambientes.json` e `data/hto/plantas.json`. Rode de novo depois de mudar qualquer um dos dois.
- `publicar_plantas.py`: envia os `.webp` de `data/hto/plantas/` ao bucket privado `plantas` (não envia `prova.png`). Usa só a biblioteca padrão e lê o `obra.id` pela API REST, então o seed precisa ter sido aplicado antes.

```bash
python3 scripts/gerar_seed.py
python3 scripts/publicar_plantas.py --dry-run     # lista caminho local -> caminho remoto
export SUPABASE_URL=https://<ref>.supabase.co
export SUPABASE_SECRET_KEY=...                    # chave secreta; nunca vai para o Git nem para a saída
python3 scripts/publicar_plantas.py
```

O envio usa `x-upsert: true`, então pode ser repetido sem erro.

## Instalação

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
```

## Testes

```bash
.venv/bin/pytest -q tests/test_ambientes.py tests/test_plantas.py
```

A suíte completa (`.venv/bin/pytest -q tests`) inclui testes antigos que dependem dos IFCs, ignorados pelo git; sem eles, esses testes podem falhar.

## Revisão humana

`data/hto/ambientes.json` tem `status: revisado`, com as decisões da revisão humana em `revisao_humana` (definidas em `REVISAO_HUMANA` no script). A lista `revisar` registra os casos que foram conferidos: nomes repetidos, ambientes rotulados mais de uma vez e área "Não incluso". Uma nova revisão das plantas exige nova conferência antes de usar a lista.

Para conferir visualmente a posição dos pinos, abra `data/hto/plantas/R05/<pavimento>/prova.png`: é a visão geral com todos os pinos desenhados. As imagens usadas pelo app não trazem o pino gravado; o frontend o desenha a partir do manifesto.
