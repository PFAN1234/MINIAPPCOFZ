# Plano: novo visual do Mini App e do site de administração (direção B · Canteiro)

Decisões de 2026-11-12 com o usuário. Checklist em `tasks/todo.md` (seção "Novo visual").

## Referência

Prancha de design (privada, do usuário): https://claude.ai/artifact/8NATqtRqFsQLFnjx55jVW9

| Linha da prancha | Telas que valem para a implementação |
|---|---|
| B · Canteiro (escolhida) | B1 Início, B2 Obra, B3 Ambiente, B4 Novo registro, B5 Admin: obra, B6 Admin: editor (etapa 3) |
| B · demais telas do Mini App | B7 Planta, B8 Pendências, B9 Pendência e encerramento, B10 Registros, B11 Gestão, B12 Modelo federado, B13 Sem sinal e vazio |
| B · demais telas do admin | B14 Entrar, B15 Obras, B16 Administradores, B17 a B20 (etapas 1, 2, 4 e 5 do editor) |

As linhas A, C e as cinco paletas ficam só como histórico da escolha.

## Decisões

| Tema | Decisão |
|---|---|
| Direção | B · Canteiro: alto contraste, letra e botões grandes, ações rápidas para o uso em campo. |
| Paleta | Azul-escuro `#0B1625` (tirado da referência do usuário) no topo e no texto forte, amarelo `#F5B700` nas ações principais, laranja nas pendências, azul nos serviços. Sem preto. |
| Tema do Telegram | Sempre claro, com topo azul-escuro, para todos (o app deixa de seguir `themeParams` e o modo escuro). O app pinta o cabeçalho e o fundo do Telegram com as cores próprias. |
| Admin | Mesma paleta. Barra lateral azul-escura, páginas claras e editor com área de trabalho escura. O modo escuro do sistema também sai do admin. |
| Fontes | Barlow (texto) e Barlow Semi Condensed (títulos), servidas pelo próprio app (sem Google Fonts), para funcionarem sem sinal. |
| Pino da planta | Tocar no pino abre o ambiente direto, como hoje. O cartão com "Abrir" e "Registrar" da prancha (B7) não entra. |
| Início | Sem o botão "Registrar na <obra>" do cartão da obra (B1): o cartão só abre a obra; o registro começa sempre pela tela do ambiente. |
| Gestão | Pedidos de acesso, participantes e publicações com problema continuam numa página só, como hoje; muda só o visual (a prancha B11 separa participantes, isso não entra). |
| Ordem | Mini App primeiro (V0 a V3), depois o admin (V4). |

Onde a prancha e este plano diferem, vale o plano.

## Cores (variáveis de CSS)

Um arquivo só, `app/src/estilo/tokens.css`, importado pelo Mini App (`index.css`) e pelo admin (`admin.css`).

| Variável | Valor | Uso |
|---|---|---|
| `--azul` | `#0B1625` | topo, títulos, texto forte, botões escuros |
| `--azul-painel` | `#17283E` | painéis sobre o azul (admin, editor, abas no topo) |
| `--azul-borda` | `#263A55` | bordas sobre o azul |
| `--azul-area` | `#122136` | área da planta no editor e no visualizador 3D |
| `--fundo` | `#ECEFF3` | fundo das telas |
| `--superficie` | `#FFFFFF` | cartões, listas, campos |
| `--texto` | `#0B1625` | texto principal |
| `--texto-suave` | `#4A5868` | texto secundário em fundo claro |
| `--texto-no-azul` / `--texto-suave-no-azul` | `#FFFFFF` / `#C3D1E2` | texto sobre o azul |
| `--borda` / `--borda-fraca` | `#CBD3DD` / `#DCE2E9` | bordas e divisórias |
| `--destaque` / `--destaque-texto` | `#F5B700` / `#0B1625` | ação principal, aviso de sem sinal, indicador da aba ativa |
| `--pendencia` | `#C2410C` | pendência aberta (texto branco por cima) |
| `--servico` | `#2459B8` | serviço (texto branco por cima) |
| `--ok` | `#157F3B` | publicado, resolvido, revisado |
| `--incerto` | `#8A5300` | publicação incerta |
| `--erro` | `#B42318` | falha, erro |

Contraste conferido: texto azul-escuro sobre amarelo ~10:1; branco sobre laranja ~5,2:1; branco sobre azul de serviço ~6,3:1; `--texto-suave` sobre branco ~6,9:1.

Os nomes antigos (`--bg`, `--bg-secundario`, `--texto`, `--texto-suave`, `--borda` e os `--adm-*`) viram apelidos das variáveis novas durante a migração e são apagados no fim. Selos e pinos deixam de ter hex fixo espalhado no CSS.

## Fases

Cada fase é um PR, com typecheck, lint, Vitest e e2e verdes. Ao fim de cada fase, capturas em 390×844 (Mini App) e 1440×900 (admin) das telas tocadas, para comparar com a prancha.

### V0. Fundação (pequena)
1. `app/src/estilo/tokens.css` com a tabela acima; `index.css` e `admin.css` passam a usar as variáveis (com os apelidos). Sai o `@media (prefers-color-scheme: dark)` dos dois e `color-scheme` vira `light`.
2. Fontes: pacotes `@fontsource/barlow` e `@fontsource/barlow-semi-condensed` (versões exatas, só o subconjunto latino e os pesos usados: 400, 500, 600 e 700; títulos 600 e 700). Conferir que os `.woff2` entram no `precache-manifest.json` do Mini App e que o admin não puxa nada a mais.
3. `telegram.ts`: `setHeaderColor('#0B1625')`, `setBackgroundColor('#ECEFF3')` e `setBottomBarColor('#FFFFFF')`, cada um protegido por `isVersionAtLeast` (6.1 para os dois primeiros, 7.10 para o último). Chamados uma vez ao abrir o app.
4. Ícones: completar `components/Icones.tsx` com os que as telas usam (casa, lista, alerta, câmera, galeria, mais, lupa, planta, cubo, celular, sem sinal, check, fechar, voltar, pessoas), todos com traço e `aria-hidden`.

Pronto quando o app abre com as cores e as fontes novas sem mudar a estrutura das telas, e as fontes aparecem sem sinal (e2e `offline.spec.ts`).

### V1. Estrutura do Mini App
1. `Layout.tsx`: sai a barra "Diário da obra" repetida (o Telegram já mostra o nome). Entra o componente `TopoTela` (título grande, subtítulo e ações opcionais, fundo `--azul`) usado no topo de cada tela. Fora do Telegram, o "Voltar" fica dentro do `TopoTela`.
2. `BarraInferior.tsx`: ícone e rótulo, 72 px, indicador amarelo no item ativo e contagem de pendências no rótulo.
3. `BarraSincronizacao.tsx`: faixa amarela com o celular, o texto e o botão "Enviar". `Aviso.tsx` com as cores novas.
4. `Estado.tsx`: vazio, erro e carregando no estilo de B13. A página 404 ganha o mesmo componente e um botão de voltar ao início.

### V2. Telas principais (B1 a B4)
1. Obras (B1): cartão por obra com números de pendências abertas e de registros e o último registro; tocar no cartão abre a obra (sem o botão "Registrar na <obra>"). Outras obras com "Pedir acesso".
2. Obra (B2): pavimento no topo azul, atalhos Planta / Modelo 3D / Pendências / Gestão (Gestão só para gestor), busca grande, filtro "Com pendência" e lista com o número de pendências por ambiente.
3. Ambiente (B3): botões "+ Serviço" e "+ Pendência" no topo, que abrem o Novo registro já com o tipo (`?tipo=servico|pendencia`); "Onde fica" compacto; abas Histórico/Pendências; cartão do registro com a faixa do tipo.
4. Novo registro (B4): título conforme o tipo ("Nova pendência"), botão grande de câmera, galeria, tipo, legenda "O que foi visto" e botão amarelo de largura total. A faixa de sem sinal aparece aqui também.

### V3. Demais telas do Mini App (B7 a B13)
Planta (busca e pavimento na faixa azul, pinos amarelos com borda azul, número de pendências em laranja; tocar no pino abre o ambiente, como hoje), Pendências, Pendência e encerramento, Registros, Gestão (mesma organização de hoje numa página só: pedidos, participantes e publicações com problema), Modelo federado e os estados sem sinal e vazio (a planta não baixada mostra um aviso no lugar da imagem quebrada).

### V4. Site de administração (B5, B6, B14 a B20)
1. Moldura: barra lateral azul com as obras, "Nova obra", "Administradores" e o usuário; Entrar (B14), Obras (B15) e Administradores (B16).
2. Página da obra (B5) em abas: Visão geral, Pavimentos e planta, Nomes e categorias, Publicações e Modelos IFC. Resolve a página única de mais de 3000 px.
3. Editor da planta (B6, B17 a B20): etapas numa coluna à esquerda, área de trabalho escura com a planta numa folha branca e painel do ambiente à direita. A lista de ambientes fica ao lado da planta, sem rolar para longe dela.

### V5. Conferência final
- Capturas de todas as telas lado a lado com a prancha; ajustes de espaçamento.
- Contraste e alvos de toque (mínimo de 44 px) conferidos com o Playwright.
- Teste no Telegram real, Android e iPhone: cor do cabeçalho do Telegram, leitura no sol, câmera e fluxo sem sinal.
- Apagar os apelidos de variáveis antigas e o CSS que ficou sem uso.

## Testes

- Os testes procuram elementos pelo papel e pelo nome acessível. Onde o texto muda (ex.: "Novo registro" vira "+ Serviço" e "+ Pendência"), o nome acessível passa a ser explícito ("Registrar serviço", "Registrar pendência") e os testes são atualizados no mesmo PR.
- Novos testes: Novo registro abre com o tipo vindo de `?tipo=`; `TopoTela` mostra "Voltar" só fora do Telegram; as cores do Telegram são pedidas só quando a versão permite; fontes no precache.
- e2e continuam em 390×844 com a fixture; o admin em 1440×900.

## Riscos

| Risco | Mitigação |
|---|---|
| Telegram antigo sem `setHeaderColor`/`setBottomBarColor`. | Chamadas protegidas por versão; sem elas o app continua legível (cabeçalho padrão do Telegram). |
| iPhone sem service worker: fontes não ficam no precache. | Fontes ficam no cache HTTP do WebView; a pilha de fontes de reserva (`system-ui`) mantém a leitura. |
| Peso das fontes no primeiro acesso. | Só o subconjunto latino e quatro pesos (cerca de 100 KB). |
| Muitos testes quebram pela troca de textos. | Uma fase por PR e nomes acessíveis estáveis. |
| Telas longas do admin (ObraAdmin 557 linhas, EditorPlanta 584) difíceis de reorganizar. | V4 separa cada aba e cada etapa em componentes próprios antes de trocar o visual. |
