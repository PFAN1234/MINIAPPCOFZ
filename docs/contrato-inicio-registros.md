# Contrato — início, tela da obra e Registros (novembro de 2026)

Decisões do usuário:

- Barrinhas do início: totais da obra (serviços de sempre, pendências abertas agora, pendências
  resolvidas de sempre). As 3 aparecem sempre, mesmo com 0.
- Prévia do modelo: 3D de verdade, só ARQ, em cache no aparelho.
- Filtro de data em Registros: período de–até; preencher só um lado também vale.

## Banco (pronto: `supabase/migrations/20261117090000_resumo_obras_autores.sql`)

- `resumo_obras()` → linhas `{obra_id uuid, papel text|null ('gestor'|'equipe'), servicos, abertas, resolvidas}`
  (contagens `bigint`, chegam como número ou texto: converter com `Number`). Uma linha por obra
  visível.
- `autores_registros()` → linhas `{id uuid, nome text, nome_exibicao text|null}`, ordenadas pelo nome.
  Exibir com a mesma regra de nome dos autores dos registros (ver `dados/nome.ts`).

## Parte 1 — Início e tela da obra

### Dados

- `tipos.ts`: `ResumoObra { obra_id: string; papel: PapelObra | null; servicos: number; abertas: number; resolvidas: number }`.
- `Repositorio.resumoObras(): Promise<ResumoObra[]>`. No Supabase: `rpc('resumo_obras')`. Na fixture:
  contar a partir dos registros e das participações da fixture.
- Hook `useResumoObras()` (chave `['resumo-obras']`). Invalidar onde hoje se invalidam os registros
  (registro novo, encerramento, sincronização da fila).

### Início (`telas/Obras.tsx`)

- O título "OBRAS" e as abas de etapa ficam **na mesma linha**: título à esquerda e abas à direita.
  Criar em `TopoTela` uma prop `aoLado?: ReactNode`, posta numa linha flex com o `h1`. Se as abas
  não couberem, elas rolam na horizontal; o título não quebra.
- Linha de cada obra:
  - Nome à esquerda. À direita, **3 barrinhas** de cantos arredondados (pílulas), só com o número:
    - azul-claro: serviços;
    - laranja: pendências abertas;
    - verde-claro: pendências resolvidas.
  - Cada barrinha tem `aria-label` e `title` por extenso ("3 serviços", "1 pendência aberta",
    "2 pendências resolvidas"; singular e plural corretos). Cores como tokens em `estilo/tokens.css`,
    com contraste AA para o número.
  - Sem dados do resumo (offline e sem cache), as barrinhas não aparecem.
  - Some o selo "N pendências abertas". `useRegistros(FILTRO_PENDENCIAS_ABERTAS)` sai do início se
    nada mais o usar ali.
- Botão **Gestão** na linha das obras em que o usuário é gestor (`papel === 'gestor'` no resumo):
  - É um link próprio para `/obras/<slug>/gestao`, ao lado do nome. Não pode ficar aninhado no link
    da obra, porque elemento interativo dentro de outro é inválido; o `li` tem os dois lado a lado.
  - Selo de alerta com pedidos de acesso + publicações com problema quando > 0. Usar
    `useSolicitacoes` e `usePublicacoesProblema`, como a tela da obra fazia, num componente da linha.
  - Na largura de celular (360 px), a linha cabe sem rolagem lateral: nome que não couber quebra.

### Tela da obra (`telas/Obra.tsx`)

- O botão **Pendências** (com o número de abertas) vai para o **topo, à direita do nome da obra**,
  usando `aoLado` do `TopoTela`. Leva a `/obras/<slug>/pendencias`, como hoje.
- O atalho **Gestão** sai da tela da obra; a rota `/obras/<slug>/gestao` continua.
- Prévia do modelo no lugar do cartão "Visualizar modelo federado" (componente `components/PreviaModelo.tsx`):
  - Quadro de altura fixa (cerca de 200 px, cantos arredondados) que carrega o modelo **só com ARQ**.
    Usa `listarModelos` filtrado para `sigla === 'ARQ'`, para não baixar as outras disciplinas, e o
    mesmo `modeloComCache` da tela `Modelo`.
  - `VisualizadorModelo` é lazy, como na tela `Modelo`, e ganha a prop `previa?: boolean`. Com ela, o
    visualizador:
    - não mostra o botão "Enquadrar";
    - não responde a toque ou arrasto (controles da câmera desligados ou `pointer-events: none`);
    - enquadra o modelo ao carregar.
  - O quadro inteiro é um `Link` para `/obras/<slug>/modelo`, com `aria-label="Abrir modelo federado"`
    e um rótulo visível pequeno ("Modelo federado ›") sobreposto num canto.
  - Sem modelo ARQ, com erro ou ainda listando: mostrar o cartão antigo (ícone e "Visualizar modelo
    federado"), que também leva ao visualizador.
  - Testes: mockar `../modelo/VisualizadorModelo.tsx`, como em `telas/ObraModelo.test.tsx`.
- Ordem da tela: topo (nome e Pendências) → prévia do modelo → Ambientes (pavimento, Planta/Lista,
  planta ou lista) → **Observações do dia por último**.

## Parte 2 — Registros e barra inferior

- Barra inferior: a aba **Pendências** sai e ficam só Início e Registros.
  - A rota `/pendencias` redireciona (`<Navigate replace>`) para `/registros?tipo=abertas`.
  - `obras/:slug/pendencias` continua.
  - Remover o que ficar sem uso (`useTotalPendenciasAbertas` etc.).
- Filtros de Registros. Todos ficam na URL, e mudar qualquer um volta o "Carregar mais" para 50:
  - `etapa`: id. Select "Todas as etapas", com as etapas das obras do usuário.
  - `obra`: slug. Select "Todas as obras", só com as obras da etapa escolhida. Trocar a etapa limpa
    a obra se ela não for da nova etapa.
  - `tipo`: segmentado com Todos | Serviços | Abertas | Resolvidas. Valores na URL: vazio, `servico`,
    `abertas`, `resolvidas`.
    - Abertas: `tipo = pendencia` e `situacao = aberta`.
    - Resolvidas: `tipo = pendencia` e `situacao = resolvida`.
  - `pessoa`: id do usuário. Select "Todas as pessoas", a partir de `autoresRegistros()`.
  - `de` e `ate` (`AAAA-MM-DD`, `input type="date"`, rótulos "De" e "Até"):
    - Compara `capturado_em` no fuso de Fortaleza (−03:00).
    - `de` vale desde 00:00 do dia; `ate`, até antes de 00:00 do dia seguinte.
  - "Limpar filtros" aparece quando algum filtro está ativo.
- `FiltroRegistros` ganha `etapaId?`, `autorId?`, `de?` e `ate?`:
  - Supabase:
    - etapa: `obra!inner(..., etapa_id)` com `.eq('obra.etapa_id', id)`;
    - pessoa: `.eq('autor_id', id)`;
    - período: `.gte` e `.lt` em `capturado_em`, com o deslocamento `-03:00`.
  - Fixture: o equivalente.
- `Repositorio.autoresRegistros(): Promise<{ id: string; nome: string }[]>` e o hook
  `useAutoresRegistros()`.
- Registros locais (fila offline): filtrar no cliente pelos mesmos critérios.
  - Etapa: pelas obras dela.
  - Pessoa: só aparecem com o filtro vazio ou igual ao próprio usuário.
  - Tipo e período: os mesmos critérios dos registros do servidor.
- Avisos: o que hoje navega para `/pendencias` com aviso (`useAvisoDaRota`) passa a navegar para
  `/registros?tipo=abertas`, e `Registros` mostra o aviso.
