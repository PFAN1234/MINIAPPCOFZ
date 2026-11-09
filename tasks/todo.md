# Execução — Diário da obra (piloto HTO)

Detalhes de cada fase em `tasks/plano-app.md`. Decisão de 2026-11-09: o visualizador do modelo federado e a integração IFC/planta clicável ficam para a última fase. Stack: Supabase (Postgres, RLS, Storage, Edge Functions) e frontend React/Vite/TypeScript na Vercel. Publicação no tópico de cada obra do supergrupo CO-FZ.

## Prioridade atual — fundação e dados da HTO (2026-11-09)

- [ ] Criar o projeto Supabase de desenvolvimento e o projeto Vercel ligado a `app/`.
- [x] Extrair os ambientes dos dois PDFs para `data/hto/ambientes.json`.
- [ ] Revisar a lista de ambientes e os pinos nas imagens de prova.

## Mockups (concluído em 2026-11-06)

- [x] Inspecionar as duas capturas do Telegram adicionadas na raiz do projeto.
- [x] Gerar mockup visual: frentes da obra, ambientes HTO, histórico, novo registro, pendências e encerramento pelo gestor.
- [x] Salvar a proposta e o prompt utilizado no projeto em `docs/mockups/`.
- [x] Atualizar a tela HTO com a opção “Visualizar modelo federado”, antes da escolha de ambiente (`docs/mockups/mini-app-v2.png`).
- [x] Gerar a tela do modelo federado a partir da terceira captura, com controles de visualização e seleção de modelos (`docs/mockups/modelo-federado-v1.png`).
- [x] Demonstrar a entrada pelo Telegram: mensagem fixada no tópico Geral → botão Abrir Diário da obra → lista de obras → escolha da obra (`docs/mockups/entrada-telegram-v2.png`).
- [x] Gerar a transição HTO → modelo federado com as nove siglas: ARQ, ELT, HID, ESG, DRE, PCI, VES, TLD e ANT (`docs/mockups/hto-modelo-federado-v1.png`).
- [x] Montar GIF com abertura pelo Geral e navegação por obras, HTO, modelo federado, histórico e novo registro (`docs/mockups/demo-mini-app.gif`).
- [x] Acrescentar Pendências e Encerrar pendência à demonstração (`docs/mockups/demo-mini-app-v2.gif`).

## 0. Fundação

- [ ] Criar projetos Supabase (dev) e Vercel; segredos apenas em variáveis de ambiente e `.env.example` versionado.
- [ ] Scaffold `app/` com Vite, React, TypeScript, ESLint, Vitest e o script `telegram-web-app.js`.
- [ ] Adicionar `requirements-dev.txt` com `pytest` e fazer `tests/` passar.
- [ ] CI no GitHub Actions: typecheck, lint, Vitest, pytest e `supabase db lint`.
- [ ] Confirmar o modo de chaves JWT do projeto Supabase para a sessão emitida a partir do Telegram.

Verificação: CI verde em um commit vazio de funcionalidade; `vite dev` abre a tela inicial. Dependência: nenhuma.

## 1. Ambientes da HTO a partir dos PDFs

- [x] `scripts/extrair_ambientes.py`: parear cada nome com o `A=xx m²` logo abaixo dele em `artifacts/validation/pdf/inventory.json`, gerando `data/hto/ambientes.json` (44 ambientes no térreo, 43 no 1º pavimento).
- [x] Sinalizar duplicatas (CIRC. SUL, Circulação: um ambiente com dois pinos), Jardim repetido e área “Não incluso”; banheiros separados dos apartamentos.
- [x] `scripts/gerar_plantas.py`: visão geral (WebP 2400 px e HD 4096 px) de cada pavimento, recorte de detalhe por ambiente e manifesto `data/hto/plantas.json`; legendas e carimbo cobertos.
- [x] Imagem de prova com todos os pinos iguais, acima do nome (`data/hto/plantas/R05/<pavimento>/prova.png`).
- [ ] Revisão humana da lista (nomes operacionais, Jardim 1/2, pinos dos banheiros empilhados) e marcar `status` como revisado.
- [ ] Gerar `supabase/seed/hto.sql` a partir da lista revisada (junto com o schema da fase 2).

Verificação: pytest confere APTO. 101 = 23,88 m², SALÃO DE EVENTOS = 158,59 m² (Térreo) e APTO. 211 = 20,58 m² (1º pavimento). Dependência: 0.

## 2. Banco, permissões e autenticação Telegram

- [ ] Migrations: obra, usuário, participação, solicitação de acesso, pavimento, ambiente, registro, foto, encerramento e publicação Telegram.
- [ ] RLS por participação na obra; encerramento só por gestor; bucket privado `fotos` com política pelo caminho da obra.
- [ ] RPCs `concluir_registro` (idempotente pelo id do cliente) e `encerrar_pendencia` (gestor, pendência aberta, `for update`), ambas enfileirando a publicação na mesma transação.
- [ ] Edge Function `auth-telegram`: validar `initData` (assinatura e `auth_date`), criar/atualizar usuário e emitir sessão.

Verificação: testes de banco — outra obra não lê nem grava; equipe não encerra; repetir `concluir_registro` não duplica; initData adulterado ou expirado é rejeitado. Dependência: 1.

## 3. Navegação por lista

- [ ] Tela Obras: obras permitidas, busca e últimos registros, sem obra pré-selecionada.
- [ ] Tela da obra: abas Térreo / 1º pavimento, busca e lista de ambientes; cartão do modelo federado oculto por feature flag.
- [ ] Tela do ambiente: abas Histórico / Pendências, botão Novo registro e cartão “Onde fica” com o recorte da planta.
- [ ] Aba Planta na obra: marcadores tocáveis, zoom/arraste, busca centralizando o ambiente, contagem de pendências e aviso “posição indicativa”.
- [ ] Barra inferior, BackButton e tema do Telegram.

Verificação: Playwright em viewport móvel com Telegram simulado navega Obras → HTO → Apto. 101, pela lista e pelo marcador na planta. Dependência: 2.

## 4. Novo registro e histórico

- [ ] Câmera e galeria, várias fotos, compressão no cliente e remoção de localização EXIF.
- [ ] Tipo Serviço/Pendência e legenda obrigatória; upload ao Storage e `concluir_registro`.
- [ ] Histórico com foto, legenda, tipo, autor, horário e estado de publicação.

Verificação: salvar e reabrir um registro de cada tipo; nenhuma foto vinculada à obra errada. Dependência: 3.

## 5. Registros com sinal instável

- [ ] Rascunhos e fotos em IndexedDB, confirmados antes de exibir “aguardando envio”.
- [ ] Sincronizar ao abrir, no evento `online` e por tentativa manual, sem duplicar.
- [ ] Estados salvo no aparelho / salvo no servidor / publicado; detecção de falta de espaço; rascunhos isolados por usuário.

Verificação: Playwright offline → reabrir → sincronizar sem duplicar; quota excedida exibida. Dependência: 4.

## 6. Bot e publicação no tópico da obra

- [ ] Bot de teste, Mini App com Direct Link e mensagem fixada no tópico Geral.
- [ ] `bot-webhook`: `/vincular_obra <slug>` grava chat e tópico da obra; `/start` em privado.
- [ ] `publish-outbox` com pg_cron: foto(s), obra, pavimento, ambiente, tipo, legenda, autor e link `startapp` de retorno; backoff e estado `incerto` para respostas ambíguas.
- [ ] Abrir o app pelo link `startapp` leva ao registro.

Verificação: registro publicado no tópico certo do grupo de teste; falha simulada do Telegram mantém o registro no histórico. Dependência: 5.

## 7. Pendências e gestão

- [ ] Lista de pendências da obra com abas Abertas/Resolvidas e filtro por ambiente.
- [ ] Encerrar pendência (gestor) com foto de comprovação e observação, publicada como resposta à mensagem original.
- [ ] Gestão: aprovar solicitações de acesso, definir papel, reconciliar publicações com falha ou incertas.
- [ ] Aba global Registros com filtros.

Verificação: pendência aberta e resolvida aparece no histórico e no grupo de teste; equipe não consegue encerrar; encerramento concorrente tem um só vencedor. Dependência: 6.

## 8. Piloto assistido HTO

- [ ] Grupo real, equipe e gestores cadastrados.
- [ ] Testes em Android e iOS reais: câmera, permissões, WebView, rascunho após fechar, desempenho.
- [ ] Backup e restauração do Postgres e do Storage.
- [ ] Registrar aceite do fluxo com a equipe da obra.

Dependência: 7. Tokens do bot, grupo real, hospedagem e aparelho de teste ainda não foram fornecidos/configurados.

## 9. Modelo federado e planta clicável (última fase)

Diagnóstico existente preservado em `docs/validacao-hto.md` e `artifacts/validation/`.

- [x] Inventariar as duas plantas PDF e os três IFCs.
- [x] Extrair textos/coordenadas e gerar previews das plantas.
- [x] Extrair hierarquia, unidades, matrizes e geometria dos espaços IFC.
- [ ] Concluir correspondência geométrica do ambiente piloto e validar a transformação entre disciplinas (pontos de controle TLD, conferência de Z).
- [ ] Gerar recortes GLB por ambiente com geometria real das disciplinas e metadados.
- [ ] Planta 2D clicável usando as bbox guardadas na fase 1; seleção sem pegar ambientes vizinhos.
- [ ] Visualizador Three.js e ativação do cartão “Visualizar modelo federado”.

Verificação: sobreposição visual e controle independente de coordenadas; recorte não contém ambientes vizinhos inteiros; carregamento sob demanda sem enviar o IFC completo ao celular. Dependência: 8.
