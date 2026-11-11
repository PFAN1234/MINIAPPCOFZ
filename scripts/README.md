# Scripts de dados das obras

Geram os dados e as imagens que o Mini App usa para localizar ambientes nas plantas de arquitetura. Servem para qualquer obra: tudo o que é próprio de uma obra fica em `data/<slug>/obra.json`, e todos os scripts recebem `--obra <slug>` (obrigatório).

> **Caminho principal desde a fase 2 do site de administração:** a planta é enviada e publicada pelo site `/admin/` (Obra → "Planta de <pavimento>"), que faz no navegador o mesmo que `extrair_ambientes.py` + `gerar_plantas.py` + `gerar_seed.py` + `publicar_plantas.py`, com a configuração no banco (`obra_config`). Ver `docs/admin.md`, "Planta (fase 2)". Estes scripts ficam como **reserva** (sem o site, com a chave secreta) e como **referência de paridade**: os testes `app/src/admin/planta/paridade.node.test.ts` conferem que o port em TypeScript dá o mesmo `ambientes.json` e as mesmas contas do `plantas.json` que eles. Depois que uma obra for publicada pelo site, o banco passa a ser a fonte: antes de usar os scripts de novo, exporte a configuração no site e atualize o `obra.json` (campos que só o site usa, como `marcadores_ajustados` e `prancha`/`revisao` por pavimento, são ignorados aqui).

Obras cadastradas: `hto` (R05, térreo e 1º pavimento, revisada) e `cofz` (R06, pavimento único, aguardando revisão humana).

## Configuração da obra: `data/<slug>/obra.json`

| Campo | O que é |
| --- | --- |
| `slug`, `nome` | Identificador (letras minúsculas, dígitos e hífen; vai para `obra.slug` no banco) e nome exibido. |
| `status` | `aguardando_revisao_humana` ou `revisado`. `revisado` exige `revisao_humana` feita na mesma revisão da planta. |
| `revisao` | Revisão vigente da planta (ex.: `R05`). Se o nome do PDF trouxer `-Rxx`, tem de bater. |
| `pasta_pdf` | Pasta dos PDFs originais, somente leitura (ex.: `DOCS HTO/PDF`). |
| `pavimentos` | Lista com `codigo` (vai para o id dos ambientes e para os caminhos), `nome`, `ordem`, `pdf` (nome do arquivo na pasta) e `pagina` (começa em 1). |
| `prancha` | `recorte_edificio` `[x0, y0, x1, y1]` e `mascaras` (`{"retangulo": [...], "descricao": ...}`), em coordenadas normalizadas da página (0–1, origem no canto superior esquerdo). O recorte contém o edifício inteiro; as máscaras cobrem de branco legendas, tabelas e carimbo que caírem dentro dele. `observacao` é livre. |
| `nomes_fixos` | Nome na planta → nome operacional, para abreviações (`"VEST. FEM."` → `"Vestiário feminino"`). Sem entrada, vale a regra genérica do extrator (primeira letra maiúscula, `APTO.`, `BHO`...). |
| `categorias` | Opcional. Nome na planta → categoria (`apartamento`, `banheiro`, `vestiario`, `circulacao`, `externa`, `servico`, `area_comum`). Sem entrada, vale a regra genérica. |
| `renomear` | Opcional. Lista de `{"pavimento", "nome_planta", "area_m2", "nome_operacional"}` para dar nome a um ambiente específico, por exemplo quando o mesmo nome aparece com áreas diferentes. Uma entrada que não casar com nenhum ambiente faz o extrator falhar. |
| `ambientes_manuais` | Opcional. Cômodos sem rótulo na planta, acrescentados à mão: `{"pavimento", "nome_operacional", "categoria", "marcador": {"x", "y"}, "observacao"}`, com o ponto da ponta do pino normalizado na página. Entram com `nome_planta` e `area_m2` nulos, id gerado do nome, a mesma ordenação dos demais e uma entrada em `revisar`. |
| `manter_codigo` | Opcional. `{"<id novo calculado>": "<id antigo>"}`: o ambiente cujo id calculado é a chave fica com o código antigo (renomeação confirmada por humano; ver "Alterar a planta de uma obra"). A chave tem de ser o id calculado de um ambiente extraído e o valor um id que já existiu (na lista anterior ou em `ambientes_removidos`), no mesmo pavimento, sem repetição e sem colidir com outro ambiente; senão o extrator falha. A entrada fica no arquivo para sempre. |
| `revisao_humana` | Decisões da revisão humana (`data`, `revisao_planta`, `decisoes`) ou `null` enquanto não houver. |

Ambientes com o mesmo nome e áreas diferentes, sem entrada em `renomear`, são numerados provisoriamente pela área (menor = 1) e aparecem em `revisar`. Atenção: o id do ambiente vem do nome operacional (`<pavimento>-<nome sem acento>`) e não pode mudar depois do primeiro registro no app; defina os nomes finais antes de publicar a obra. Depois de publicada, uma renomeação só mantém o código com `manter_codigo`.

## O que cada script faz

- `extrair_ambientes.py`: lê os PDFs da configuração com o PyMuPDF, pareia cada `A=xx m²` com o nome logo acima e gera `data/<slug>/ambientes.json`, com nome, categoria, área e marcadores (pinos) de cada ambiente. Se o arquivo já existir, ele é lido antes de ser sobrescrito e serve de base: os códigos iguais são mantidos, `manter_codigo` é aplicado, os ids que sumiram vão para `ambientes_removidos` e as diferenças vão para `diferencas` (e para o terminal). A função `extrair(obra, paginas, base)` é pura e testável com spans sintéticos.
- `gerar_plantas.py`: renderiza os PDFs e gera, em `data/<slug>/plantas/<revisao>/<pavimento>/`, a visão geral (`planta.webp`), a versão HD (`planta-hd.webp`), um recorte por ambiente (`ambientes/<id>.webp`) e `prova.png`. Também escreve o manifesto `data/<slug>/plantas.json`. Apaga de `ambientes/` os recortes de ids que saíram da lista, para o `publicar_plantas.py` não enviá-los.
- `gerar_seed.py`: gera `supabase/seed/<slug>.sql` (obra, pavimentos, ambientes, plantas e detalhes) a partir de `ambientes.json` e `plantas.json`. Rode de novo depois de mudar qualquer um dos dois. Grava `ativo = true` nos ambientes da lista e `ativo = false` nos de `ambientes_removidos` e em qualquer outro da obra que esteja fora da lista, e desativa a planta de outra revisão do pavimento antes de gravar a nova (exige a migration `20261111130000_ambiente_ativo.sql`).
- `importar_config_obras.py`: gera `supabase/seed/admin_config.sql`, que grava a configuração de cada `data/<slug>/obra.json` (sem `slug` e `nome`; pavimentos só com `codigo`, `pdf` e `pagina`) na tabela `obra_config` do site de administração (`docs/admin.md`). Idempotente; `--verificar` falha se o SQL estiver desatualizado. Rode de novo depois de mudar um `obra.json`.
- `publicar_plantas.py`: envia os `.webp` de `data/<slug>/plantas/` ao bucket privado `plantas` (não envia `prova.png`). Usa só a biblioteca padrão e lê o `obra.id` pela API REST, então o seed precisa ter sido aplicado antes.

## Ordem de execução

Na raiz do repositório (cada passo depende do anterior):

```bash
python3 scripts/extrair_ambientes.py --obra hto
python3 scripts/gerar_plantas.py --obra hto
python3 scripts/gerar_seed.py --obra hto
```

## Publicar no Supabase

```bash
python3 scripts/publicar_plantas.py --obra hto --dry-run   # lista caminho local -> caminho remoto
export SUPABASE_URL=https://<ref>.supabase.co
export SUPABASE_SECRET_KEY=...                              # chave secreta; nunca vai para o Git nem para a saída
python3 scripts/publicar_plantas.py --obra hto
```

O envio usa `x-upsert: true`, então pode ser repetido sem erro.

## Cadastrar uma obra nova

1. Copiar os PDFs de arquitetura (um por pavimento, revisão vigente) para `DOCS <SIGLA>/PDF/`. Conferir que o texto é selecionável e que cada ambiente tem `A=xx m²` logo abaixo do nome.
2. Criar `data/<slug>/obra.json` a partir do da HTO ou da COFZ, com `status: aguardando_revisao_humana` e `revisao_humana: null`.
3. Medir o recorte e as máscaras: renderizar a página com uma grade de coordenadas normalizadas e marcar onde ficam o edifício, as legendas, as tabelas, o título e o carimbo. O recorte não pode conter nenhum pedaço deles; onde o edifício avança sobre essas áreas, usar máscara.
4. Rodar `extrair_ambientes.py` e `gerar_plantas.py` com `--obra <slug>`. Conferir a contagem e as áreas, olhar `prova.png` (cada pino acima do nome certo, nada de legenda ou carimbo na imagem) e ajustar `nomes_fixos`, `categorias` e `renomear`.
5. Revisão humana (nomes, repetidos, rótulos duplos, pinos). Registrar as decisões em `revisao_humana`, passar `status` para `revisado` e rodar os dois scripts de novo.
6. Rodar `gerar_seed.py --obra <slug>`, aplicar o seed, publicar as imagens com `publicar_plantas.py --obra <slug>` e conferir no app.
7. Incluir a obra nos testes (`tests/test_plantas.py` e `tests/test_ambientes.py` têm a lista `OBRAS`; casos próprios num `tests/test_<slug>.py`).

## Alterar a planta de uma obra

O código (id) de um ambiente não muda depois de publicado: `registro` referencia `ambiente`, que nunca é apagado. O `data/<slug>/ambientes.json` no Git é a base de cada nova extração.

**a) Ajuste na mesma revisão** (nome, categoria, pino manual, máscara): editar o `obra.json` e rodar os três scripts. Se o ajuste mudar um nome operacional de ambiente já publicado, o id calculado muda: o relatório o mostra como novo + removido e a renomeação tem de ser confirmada com `manter_codigo` (passo 5 abaixo).

**b) Nova revisão do PDF:**

1. Colocar o PDF novo em `DOCS <SIGLA>/PDF/` (os originais são só lidos; o PDF antigo pode ficar).
2. No `obra.json`, atualizar `revisao` e o `pdf` de cada pavimento. Se a obra estava `revisado`, voltar o `status` para `aguardando_revisao_humana` (o extrator recusa `revisado` com `revisao_humana` de outra revisão).
3. Rodar, na ordem:
   ```bash
   python3 scripts/extrair_ambientes.py --obra <slug>
   python3 scripts/gerar_plantas.py --obra <slug>
   python3 scripts/gerar_seed.py --obra <slug>
   ```
4. Ler o relatório de diferenças (impresso pelo extrator e gravado em `ambientes.json`, em `diferencas`, em relação à lista da revisão anterior, `revisao_base`):
   - `novos`: ids que não existiam;
   - `removidos`: ids que sumiram, cada um com `sucessor_sugerido` (ambiente novo do mesmo pavimento com pino a menos de 0,03 da posição anterior, mesmo nome na planta ou mesma área) — a sugestão nunca é aplicada sozinha;
   - `herdados`: códigos mantidos por `manter_codigo`;
   - `nome_alterado`: nome mudou sem mudar o código (só maiúsculas, acentos ou pontuação);
   - `area_alterada` (antes/depois) e `marcador_deslocado` (pino a mais de 0,01 da posição anterior).
5. Para cada removido que na verdade foi renomeado, confirmar no `obra.json`, por exemplo `"manter_codigo": {"terreo-cozinha": "terreo-copa"}`, e rodar os três scripts de novo. O ambiente fica com o código antigo (e os registros dele) e o nome novo. Rodar de novo com a mesma entrada dá o mesmo arquivo, e o relatório continua mostrando a mudança desde a revisão anterior.
6. Os removidos de verdade ficam em `ambientes_removidos` (lista acumulativa; sai dela o id que voltar a existir). O seed os marca com `ativo = false`: somem da lista, da busca e da planta do app, mas a tela deles abre com o histórico.
7. Conferir `data/<slug>/plantas/<revisao>/<pavimento>/prova.png` e fazer a revisão humana (`revisao_humana` da nova revisão → `status: revisado`).
8. Aplicar a migration `20261111130000_ambiente_ativo.sql` (uma vez por banco) e depois o seed. O seed desativa a planta anterior de cada pavimento e grava a nova como ativa; a planta antiga e os detalhes dela ficam no banco como histórico.
9. Publicar as imagens com `publicar_plantas.py --obra <slug>`. As da revisão anterior ficam no bucket, na pasta dela.

Aplique o seed de preferência depois de confirmar as renomeações. Se ele for aplicado antes, o id novo provisório chega ao banco; quando o `manter_codigo` o troca pelo antigo, o seed seguinte o deixa inativo (todo ambiente da obra fora da lista atual fica com `ativo = false`), mas registros feitos nesse intervalo ficam presos ao id provisório.

## Instalação

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
```

## Testes

```bash
.venv/bin/pytest -q tests/test_ambientes.py tests/test_plantas.py tests/test_seed.py tests/test_cofz.py tests/test_revisoes.py
```

Os testes conferem que `ambientes.json` e os seeds no Git são exatamente o que os scripts geram hoje. A suíte completa (`.venv/bin/pytest -q tests`) inclui testes antigos que dependem dos IFCs, ignorados pelo git; sem eles, esses testes podem falhar.

## Revisão humana

`data/hto/ambientes.json` tem `status: revisado`, com as decisões da revisão humana copiadas de `revisao_humana` de `data/hto/obra.json`. A lista `revisar` registra os casos a conferir: nomes repetidos, ambientes rotulados mais de uma vez e área "Não incluso". Uma nova revisão das plantas exige nova conferência: o extrator recusa `status: revisado` se `revisao_humana.revisao_planta` for diferente da `revisao` da obra.

`data/cofz/ambientes.json` está `aguardando_revisao_humana`: as três "CIRCULAÇÃO" ficam numeradas pela área (Circulação 1/2/3), "DA" vira "Sala DA" e dois cômodos sem rótulo ("WC da chefia" e "Sala de apoio") entram por `ambientes_manuais`.

Para conferir visualmente a posição dos pinos, abra `data/<slug>/plantas/<revisao>/<pavimento>/prova.png`: é a visão geral com todos os pinos desenhados. As imagens usadas pelo app não trazem o pino gravado; o frontend o desenha a partir do manifesto.
