# Contrato: painel e exportação de pendências na aba Relatórios do Mini App

Decisões do usuário (13/11/2026):

- **Layout:** o painel abre no alto da aba; abaixo, a exportação e os boletins (Hoje / Emitidos) como já são.
- **Gráficos:** os três números (Serviços, Pendências, Resolvidas), uma linha **acumulada no tempo** e **barras por obra**.
- **Exportação:** **PDF com fotos**, gerado no servidor com o visual do boletim, da etapa inteira ou de uma obra, sempre acumulado até o momento.
- **Filtros:** etapa e obra (sem período: o painel mostra o histórico inteiro da etapa).
- **Quem vê e exporta:** a mesma regra da aba hoje, `privado.eh_admin() or privado.participa_da_etapa(etapa)`.

## Parte 1 · Banco

Migration nova `supabase/migrations/20261119100000_relatorios_painel.sql`.

### `public.painel_relatorios(p_etapa uuid) returns jsonb`

`security definer`, `set search_path = ''`, `stable`. Erros:

- sem `auth.uid()` → `28000`;
- etapa inexistente → `P0002`;
- sem acesso → `42501` ("Acesso negado").

Grant só para `authenticated`. Retorno:

```json
{
  "etapa": {"id": "…", "slug": "2a-etapa", "nome": "2ª ETAPA", "hoje": "2026-11-13"},
  "obras": [{"id": "…", "slug": "hto", "nome": "HTO"}],
  "dias": [
    {"obra_id": "…", "dia": "2026-11-10", "servicos": 1, "pendencias": 2, "resolvidas": 1}
  ]
}
```

- **`obras`:** obras da etapa com `arquivada_em is null`, ordenadas como no Início (ordem/nome).
- **`dias`:** uma linha por obra e dia com algum movimento, no fuso da etapa (`e.fuso`).
  - `servicos`: registros `tipo='servico'` capturados (`capturado_em`) no dia.
  - `pendencias`: registros `tipo='pendencia'` capturados no dia, qualquer que seja a situação atual.
  - `resolvidas`: `encerramento.encerrado_em` no dia, cujo registro está com `situacao='resolvida'`.
  - Ordem: `dia`, depois obra.
- **`hoje`:** `(now() at time zone e.fuso)::date`.
- **Invariante:** a soma de `pendencias` menos a soma de `resolvidas` dá as abertas atuais (as mesmas de `resumo_obras`).

### `public.relatorio_pendencias(p_etapa uuid, p_obra uuid default null) returns jsonb`

Mesma segurança e os mesmos erros. Com `p_obra` de outra etapa: `22023` ("Obra não pertence à etapa"). Retorno:

```json
{
  "gerado_em": "2026-11-13T15:04:00Z",
  "fuso": "America/Fortaleza",
  "organizacao": {"nome": "…", "logo_path": "…|null"},
  "etapa": {"id": "…", "slug": "…", "nome": "…", "sigla": "…"},
  "obra": {"id": "…", "slug": "…", "nome": "…"},
  "pendencias": [
    {
      "id": "…", "obra": "HTO", "pavimento": "Térreo", "ambiente": "Sala 01",
      "situacao": "aberta|resolvida", "aberta_em": "<ISO>", "autor": "…", "legenda": "…|null",
      "dias": 3, "fotos": [{"path": "…", "largura": 1, "altura": 1}],
      "encerramento": null
    }
  ]
}
```

- `obra` é `null` quando `p_obra` é nulo.
- `encerramento`, quando há, é `{"em": "<ISO>", "autor": "…", "observacao": "…|null", "fotos": […]}`.
- **Escopo:** pendências de obras não arquivadas da etapa (ou só de `p_obra`).
- **Ordem:** abertas antes das resolvidas; dentro de cada grupo, por obra, pavimento (`ordem`, nome), ambiente (`ordem`, `nome_operacional`) e `capturado_em`.
- **`dias`:**
  - aberta: dias de calendário no fuso entre a captura e hoje;
  - resolvida: dias entre a captura e o encerramento.
- **Reaproveitar** `privado.boletim_fotos` e `privado.nome_pessoa`.

### Bucket e testes

- Bucket privado `relatorios`, criado na migration: `insert into storage.buckets … on conflict do nothing`. Sem policies: só a chave secreta grava e assina.
- Testes em `tests/db/test_relatorios_painel.py`, no padrão de `tests/db/test_relatorios.py`, cobrindo:
  - acesso (admin, participante, estranho);
  - contagem por dia no fuso, perto da meia-noite;
  - a invariante das abertas;
  - a ordem e o `dias`;
  - o filtro de obra e o erro 22023.

## Parte 2 · Dados do Mini App (`app/src/dados/`)

- **Tipos** em `tipos.ts`: `PainelRelatorios`, `ObraPainel`, `DiaPainel`.
- **`Repositorio`:**
  - `painelRelatorios(etapaId: string): Promise<PainelRelatorios>`;
  - `exportarPendencias(etapaId: string, obraId: string | null): Promise<string>`, que devolve a URL assinada do PDF.
- **Supabase** (`supabase.ts`):
  - `painelRelatorios` chama a RPC.
  - `exportarPendencias` faz `POST /api/relatorio-pendencias` com `Authorization: Bearer <access_token da sessão>` e corpo `{etapa_id, obra_id}`, e lê `{url}`. Erro HTTP → `Error` com a mensagem `erro` do corpo, ou "Não foi possível gerar o relatório. Tente de novo.".
- **Fixture** (`fixture.ts`):
  - painel com cerca de 5 semanas de movimento em 2 ou 3 obras da etapa da fixture, com números plausíveis e algumas pendências resolvidas;
  - `exportarPendencias` resolve com uma URL de exemplo após ~800 ms.
- **Hooks** (`hooks.ts`):
  - `usePainelRelatorios(etapaId)`, com `queryKey ['painel-relatorios', etapaId]` e `enabled` com etapa;
  - `useExportarPendencias()`, uma mutation.
- **Funções puras** em `app/src/util/painel.ts`, com testes:
  - `serieAcumulada(painel, obraId|null)`: um ponto por dia, do primeiro dia com movimento até `hoje`, inclusive. Cada ponto é `{dia, servicos, pendencias, resolvidas}` acumulados, preenchendo os dias sem movimento.
  - `totaisPorObra(painel)`: `[{obra, servicos, abertas, resolvidas}]`.

## Parte 3 · Servidor do PDF (`app/servidor/relatorio/` e `app/api/relatorio-pendencias.ts`)

- **Rota:** `POST`, com JWT obrigatório (401 "Sua sessão expirou. Entre de novo."). Valida os UUIDs (400).
- **Dados:** chama `relatorio_pendencias` **com o JWT do usuário**, no padrão de `criarAcessoAdmin`. Os erros de RPC são mapeados como em `respostaDeRpc`.
- **Montagem:** baixa as fotos e o logo com a chave secreta (`FonteBoletim.baixar`), reduz as fotos com `reduzirFoto` (lado de 800 px) e gera o PDF com `abrirNavegador` e `gerarPdf`.
- **Gravação:** envia o PDF para `relatorios/pendencias/<sub do JWT>/<etapa_slug>-<obra_slug|etapa>.pdf` com upsert. O `sub` é lido do payload do JWT, que já foi validado pela RPC. Responde `{url}`, uma URL assinada por 600 s.
- **`vercel.json`:** entrada igual à de `api/previa-boletim.ts` (2048 MB, `maxDuration` 120, mesmos `includeFiles`).
- **Template HTML** (`template.ts`), no visual do boletim, reaproveitando `cssFontes`, `escapar`, `comQuebras`, `dataBr` e o estilo do cabeçalho:
  1. **Cabeçalho:** logo da organização e nome; título "RELATÓRIO DE PENDÊNCIAS"; a etapa e a obra (ou "Todas as obras"); "Posição em dd/mm/aaaa às hh:mm" no fuso.
  2. **Resumo:**
     - KPIs: registradas, abertas, resolvidas, % resolvidas e tempo médio de resolução em dias;
     - sem filtro de obra, uma tabela por obra com abertas, resolvidas, total e a aberta mais antiga (em dias).
  3. **Pendências abertas:** cartões numerados (P-001…) com obra, pavimento e ambiente; "aberta em dd/mm/aaaa · há N dias"; autor; descrição; fotos em grade de 2 colunas.
  4. **Pendências resolvidas:** a mesma estrutura, mais o bloco "Resolvida em dd/mm/aaaa por X (N dias)", a observação e as fotos da resolução.
  5. **Lista vazia:** "Nenhuma pendência registrada."
  6. **Rodapé:** "Relatório de pendências · <etapa> · página X de Y".
- **Testes** (vitest): o template, cobrindo as seções, a ausência de obra, o escape e a numeração; e o handler com fonte e acesso falsos, cobrindo 401, 400, 403, o caminho gravado e a URL devolvida.

## Parte 4 · Tela (`app/src/telas/Relatorios.tsx` e CSS)

- **Etapa:**
  - `AbasEtapa` na base do topo (`TopoTela base`), como no Início, no lugar do `<select>`.
  - Parâmetro de URL `etapa` (slug). Sem ele, a primeira etapa.
  - Sem a opção "Todas as etapas": os boletins listados passam a ser só os da etapa escolhida.
- **Obra:**
  - Linha de botões "Todas" + uma por obra (componente `Abas`, rótulo "Obra").
  - Parâmetro de URL `obra` (slug). Só aparece com 2 ou mais obras.
- **Seção "Painel":**
  1. Três cartões de número, com as cores de identidade atuais em uma barra lateral, e o texto em `--texto`:
     - Serviços (total acumulado);
     - Pendências abertas, com a linha "de N registradas";
     - Resolvidas, com "X% das pendências".
  2. **Gráfico "Acumulado"** (SVG próprio, sem biblioteca), em linhas:
     - cores: serviços `--servico`, pendências registradas `--pendencia`, resolvidas `--ok`;
     - largura da linha 2 px, grade horizontal discreta (`--borda-fraca`) e eixo y começando em 0, com 3 ou 4 marcas inteiras;
     - eixo x com 3 ou 4 datas `dd/mm`;
     - legenda acima e o valor final escrito no fim de cada linha;
     - ao tocar ou arrastar, uma linha vertical com a caixa do dia ("dd/mm: Serviços N · Pendências N · Resolvidas N");
     - `role="img"` com `aria-label` resumindo os totais.
  3. **Gráfico "Por obra"** (só com "Todas" e 2 ou mais obras): uma barra horizontal empilhada por obra, resolvidas (`--ok`) e abertas (`--pendencia`).
     - 2 px de espaço entre os segmentos e cantos de 4 px nas pontas;
     - o nome da obra à esquerda e os números escritos à direita ("3 abertas · 5 resolvidas").
  4. **Tabela:** `<details>` "Ver em tabela", com a tabela dia a dia do acumulado (só os dias com movimento).
  - **Sem movimento:** a dica "Ainda não há registros nesta etapa." no lugar dos gráficos.
- **Seção "Exportar":**
  - Botão `.botao` "Relatório de pendências (PDF)".
  - Abaixo, a descrição "Todas as obras da 2ª ETAPA" ou "Obra HTO", com "abertas e resolvidas, com fotos".
  - Durante a geração, o botão fica desativado com "Gerando PDF…". Ao fim, `abrirLink(url)`. Em erro, `role="alert"` com a mensagem.
- **Depois:** as seções "Hoje" e "Emitidos", sem mudança de comportamento.
- **Testes:** atualizar `Relatorios.test.tsx`, cobrindo as abas de etapa, o filtro de obra, os números dos cartões, a exportação (sucesso e erro) e o estado vazio. Mais testes de `util/painel.ts`.
