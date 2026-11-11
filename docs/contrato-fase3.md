# Fase 3 — contrato da navegação e da planta

Especificação dos blocos da fase 3. Telas de referência: `docs/mockups/mini-app-v2.png` (telas 1–3). Decisões de 2026-11-09: o login real pelo Telegram fica para a fase 6, e a fase 3 se desenvolve e é testada com **dados de teste** (fixture). As plantas ficam em um **bucket privado** com URL assinada.

## A. Banco e Storage das plantas

### Tabelas novas (`public`)

| Tabela | Colunas | Restrições |
| --- | --- | --- |
| `planta` | `id uuid pk default gen_random_uuid()`, `obra_id → obra`, `pavimento_id`, `revisao text`, `pdf_sha256 text`, `pagina_largura_pt numeric`, `pagina_altura_pt numeric`, `recorte_pt numeric[]`, `imagem_path text`, `imagem_largura int`, `imagem_altura int`, `imagem_hd_path text`, `imagem_hd_largura int`, `imagem_hd_altura int`, `ativa boolean default true`, `criado_em timestamptz default now()` | FK (`pavimento_id`, `obra_id`) → `pavimento(id, obra_id)`; único (`pavimento_id`, `revisao`); índice único parcial (`pavimento_id`) where `ativa`; `recorte_pt` com 4 itens; inteiros positivos; único (`id`, `obra_id`) |
| `planta_detalhe` | `planta_id`, `obra_id`, `ambiente_id`, `imagem_path text`, `recorte_pt numeric[]`, `largura int`, `altura int` | pk (`planta_id`, `ambiente_id`); FK (`planta_id`, `obra_id`) → `planta(id, obra_id)` on delete cascade; FK (`ambiente_id`, `obra_id`) → `ambiente(id, obra_id)`; `recorte_pt` com 4 itens |

- `recorte_pt` = `[x0, y0, x1, y1]` em pontos do PDF, origem no canto superior esquerdo, igual ao `data/hto/plantas.json`.
- RLS ligada; `select` para `authenticated` com `privado.eh_participante(obra_id)`; nenhuma gravação pelo cliente. Seguir o padrão de grants de `20261109123810_privado_rls_grants.sql`.

### Conversão de coordenadas (usada no app e nos testes)

Os marcadores de `ambiente.marcadores` estão normalizados na página (`x`, `y` de 0 a 1). Para uma imagem com `recorte_pt` e tamanho `largura × altura`:

```
px = (x * pagina_largura_pt - x0) * largura / (x1 - x0)
py = (y * pagina_altura_pt - y0) * altura  / (y1 - y0)
```

O ponto é o centro do rótulo no topo do nome. O pino é desenhado **acima** dele, com a ponta no ponto.

### Bucket `plantas`

- Privado, limite de 5 MB, só `image/webp`.
- Caminhos:
  - `<obra_id>/<revisao>/<pavimento_codigo>/planta.webp`;
  - `.../planta-hd.webp`;
  - `.../ambientes/<ambiente_codigo>.webp`.
- Política `plantas_select` para `authenticated`: `bucket_id = 'plantas' and privado.eh_participante(privado.uuid_ou_nulo((storage.foldername(name))[1]))`. Sem `delete`. Desde a migration `20261112090000_admin_planta.sql`, admins do Mini App (`privado.eh_admin()`) também leem e gravam (`insert`/`update`) nas pastas de obras existentes, para o site de administração publicar a planta (`docs/admin.md`, "Planta (fase 2)").

### Seed e publicação

- `scripts/gerar_seed.py` passa a ler também `data/hto/plantas.json` e escreve em `supabase/seed/hto.sql`, idempotente com `on conflict ... do update`:
  - uma `planta` por pavimento;
  - um `planta_detalhe` por ambiente.

  Os caminhos são montados em SQL a partir do `obra.id`.
- `scripts/publicar_plantas.py` envia as imagens ao bucket pela API de Storage:
  - variáveis `SUPABASE_URL` e `SUPABASE_SECRET_KEY`;
  - `x-upsert: true` e `content-type: image/webp`;
  - só biblioteca padrão.

  Ele lê o `obra.id` pela API REST com a mesma chave. Quem roda o script é a pessoa usuária, porque a chave não fica nesta sessão.

## B. Base do app

- **Dependências:** `react-router` (v7, `BrowserRouter`), `@tanstack/react-query`, `@supabase/supabase-js` e `react-zoom-pan-pinch`.
  - Nada de `HashRouter`: o Telegram usa o hash da URL (`#tgWebAppData=...`) na abertura.
- **Rotas:**

| Rota | Tela |
| --- | --- |
| `/` | Obras (Início) |
| `/registros` | Últimos registros das obras do usuário |
| `/pendencias` | Pendências abertas das obras do usuário |
| `/obras/:slug?pav=<codigo>&aba=lista\|planta&q=<busca>&foco=<ambiente_codigo>` | Obra |
| `/obras/:slug/ambientes/:codigo?aba=historico\|pendencias` | Ambiente |

O estado de aba, pavimento, busca e foco fica na URL, para o BackButton e o recarregamento funcionarem.

- **Camada de dados** em `app/src/dados/`:
  - `tipos.ts`: tipos do domínio;
  - `repositorio.ts`: interface `Repositorio`;
  - `supabase.ts`: implementação real;
  - `fixture.ts`: implementação de teste.

  ```ts
  interface Repositorio {
    listarObras(): Promise<ObraResumo[]>                  // id, slug, nome
    obterObra(slug: string): Promise<ObraDetalhe>         // pavimentos (com planta ativa), ambientes, pendências abertas por ambiente
    obterAmbiente(slug: string, codigo: string): Promise<AmbienteDetalhe> // ambiente, pavimento, planta, detalhe
    listarRegistros(filtro: { obraId?: string; ambienteId?: string; tipo?: 'servico' | 'pendencia'; situacao?: 'aberta' | 'resolvida'; limite?: number }): Promise<RegistroResumo[]>
    urlsImagens(paths: string[]): Promise<Record<string, string>> // URL assinada (1 h) ou local na fixture
  }
  ```
  - `RegistroResumo` traz `id`, `tipo`, `situacao`, `legenda`, `autor` (nome), `capturado_em`, `recebido_em`, `ambiente` (codigo e nome) e `obra` (slug e nome). As fotos entram na fase 4.
  - A escolha é feita por `VITE_DADOS=fixture`. A fixture é carregada por `import()` dinâmico atrás de uma condição constante, e o build de produção **não pode** conter os dados de teste (conferir no `dist/`).
  - A fixture lê `data/hto/ambientes.json` e `data/hto/plantas.json` e serve as imagens de `data/hto/plantas/` por um middleware do Vite em `/__plantas/` (dev e preview). Inclui a obra HTO e uma segunda obra vazia, para a lista de obras ter mais de um item. Inclui também cerca de 6 registros de exemplo, entre eles 3 pendências abertas, para popular as contagens.
- **Sessão:** em modo Supabase, sem sessão (o login chega na fase 6), o app mostra "Abra o Diário da obra pelo Telegram". O cliente usa só `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`.
- **Telegram:**
  - `ready()` e `expand()` na abertura;
  - BackButton visível fora de `/`, voltando no histórico;
  - cores pelas variáveis CSS `--tg-theme-*`, que o `telegram-web-app.js` já define, com fallback claro/escuro por `prefers-color-scheme`.
- **Barra inferior:** Início, Registros e Pendências. Ela fica oculta na planta em tela cheia.
- **Feature flags** em `app/src/recursos.ts`:
  - `modeloFederado: false` (cartão oculto até a fase 9);
  - `novoRegistro: false` (botão oculto até a fase 4).
- **Ordenação e busca:**
  - lista em ordem alfabética natural (`Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' })`), sem grupos;
  - busca sem acento e sem diferenciar maiúsculas, em `nome_operacional` e `nome_planta`. Exemplo: "circ" e "circulacao" encontram "Circulação sul".

## C. Telas

- **Obras:**
  - lista das obras com o nome e a contagem de pendências abertas;
  - busca, quando houver mais de 5 obras;
  - "Últimos registros" com os 5 mais recentes;
  - nenhuma obra pré-selecionada.
- **Obra:**
  - título com o nome da obra;
  - abas de pavimento Térreo / 1º pavimento e abas de modo Lista / Planta;
  - busca;
  - lista única em que cada item mostra o nome operacional, a área e o selo de pendências abertas, e abre o Ambiente;
  - estado vazio para busca sem resultado.
- **Ambiente:**
  - título e pavimento;
  - cartão "Onde fica": recorte de detalhe com o(s) pino(s), que ao tocar abre a Obra em `aba=planta&pav=..&foco=<codigo>`;
  - abas Histórico (todos os registros do ambiente, do mais recente) e Pendências (abertas, depois resolvidas), com estados vazios.
- **Registros / Pendências:** listas simples com obra e ambiente; tocar abre o Ambiente.
- Estados de carregamento e erro em todas as telas, com "Tentar de novo".

## D. Planta

- `app/src/components/PlantaViewer.tsx`:
  - a imagem fica dentro de `react-zoom-pan-pinch`, com SVG por cima no mesmo sistema de coordenadas da imagem;
  - os pinos têm **tamanho constante na tela** (escala inversa ao zoom), **todos com a mesma cor e o mesmo tamanho**, com a ponta no ponto do marcador;
  - o selo com a contagem de pendências abertas fica ao lado do pino;
  - a área de toque tem no mínimo 44 px.
- Props: `imagem` (`{ url, largura, altura, recorte_pt, pagina_pt }`), `marcadores` (`{ codigo, nome, x, y, pendencias }[]`), `focoCodigo?` e `onSelecionar(codigo)`.
- **Foco:** centraliza o marcador (o primeiro, se houver mais de um) com zoom de cerca de 3×, e o título mostra o ambiente em foco. Sem destaque de cor no pino.
- **HD:** troca para a imagem `planta-hd` quando o zoom passa de 2,5×.
- Na aba Planta, a busca seleciona o ambiente e centraliza.
- Aviso fixo: "Planta de arquitetura <revisão> · posição indicativa".
- O cartão "Onde fica" usa o mesmo cálculo de coordenadas sobre o recorte de detalhe, sem zoom.
- **Cache:** service worker simples (`app/public/sw.js`, registrado só em produção) com cache-first para imagens do bucket `plantas`. A chave é a URL **sem** o parâmetro `token`, para a URL assinada nova reaproveitar o cache.

## E. Verificação

- **Vitest:**
  - conversão de coordenadas: o pino do Apto. 101 cai dentro do recorte de detalhe dele, e o de cada ambiente cai dentro da imagem do pavimento;
  - ordenação natural e busca sem acento;
  - telas com a fixture: Obras → HTO → Apto. 101, aba Planta, e o cartão "Onde fica" leva ao foco;
  - flags ocultam o modelo federado e o Novo registro.
- **pytest:** a migration nova no banco de teste (RLS de `planta` e `planta_detalhe`, política do bucket `plantas`); o seed com 2 plantas e 87 detalhes, idempotente.
- **Playwright** (viewport móvel, `VITE_DADOS=fixture`, Telegram simulado):
  - Obras → HTO → Apto. 101 pela lista;
  - o mesmo pelo marcador na aba Planta;
  - "Onde fica" abre a planta centrada;
  - o BackButton volta.
- O build de produção não contém a fixture.

## F. Revisões da planta (2026-11-11)

Migration `supabase/migrations/20261111130000_ambiente_ativo.sql`.

### Coluna nova

| Tabela | Coluna | Uso |
| --- | --- | --- |
| `ambiente` | `ativo boolean not null default true` | `false` quando o ambiente não existe na planta vigente. Sem índice novo: as consultas filtram por `obra_id`, já coberto por `ambiente_codigo_unico (obra_id, codigo)`. O `grant select` da tabela cobre a coluna. |

### Regras

- O código do ambiente não muda depois do primeiro registro, e nenhum ambiente é apagado (`registro` e `planta_detalhe` o referenciam).
- Nova revisão da planta entra como nova linha em `planta`, mantendo os códigos. O seed, antes de gravar a planta de cada pavimento, desativa a planta ativa de outra revisão (`update public.planta set ativa = false where pavimento_id = ... and revisao <> <nova> and ativa`), por causa do índice único `planta_ativa_unica`. A planta antiga e os seus `planta_detalhe` ficam como histórico; as imagens antigas ficam no bucket, na pasta da revisão.
- O seed grava `ativo = true` em todos os ambientes da lista e `ativo = false` nos de `ambientes_removidos` do `data/<slug>/ambientes.json` (`update` por `obra` e `codigo`, sem erro se a linha não existir).
- `concluir_registro` **não** verifica `ativo`: um registro feito em campo antes da troca, ainda na fila offline, tem de ser aceito.

### App

- `Ambiente.ativo: boolean`. `obterObra` traz todos os ambientes (a contagem de pendências da obra inclui os inativos); a lista, a busca e os pinos da planta mostram só os ativos.
- `obterAmbiente(slug, codigo)` continua carregando o ambiente inativo (histórico e links antigos). A tela mostra "Este ambiente não existe na planta atual; registros mantidos como histórico." e o cartão "Onde fica" só aparece se houver `planta_detalhe` do ambiente na planta ativa.
- A fixture (`VITE_DADOS=fixture`) acrescenta como inativos os `ambientes_removidos` do `ambientes.json`.

### Fluxo de uma revisão

Pelo site de administração (caminho principal): `docs/admin.md`, "Planta (fase 2)" — a RPC `admin_publicar_revisao` aplica as mesmas regras desta seção. Pelos scripts (reserva): roteiro completo em `scripts/README.md` ("Alterar a planta de uma obra"): PDF novo em `DOCS <SIGLA>/PDF/`, revisão no `obra.json`, os três scripts, leitura do relatório `diferencas`, confirmação das renomeações em `manter_codigo`, conferência do `prova.png`, migration (uma vez) e seed, publicação das imagens.
