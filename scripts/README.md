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

`data/hto/ambientes.json` tem `status: aguardando_revisao_humana`. A lista `revisar` aponta os casos duvidosos (nomes repetidos, ambientes rotulados mais de uma vez, área "Não incluso"). Os nomes operacionais e as categorias são provisórios até a revisão.

Para conferir visualmente a posição dos pinos, abra `data/hto/plantas/R05/<pavimento>/prova.png`: é a visão geral com todos os pinos desenhados. As imagens usadas pelo app não trazem o pino gravado; o frontend o desenha a partir do manifesto.
