# Execução — Diário da obra (piloto HTO)

Detalhes de cada fase em `tasks/plano-app.md`. Decisão de 2026-11-09: o visualizador do modelo federado e a integração IFC/planta clicável ficam para a última fase. Stack: Supabase (Postgres, RLS, Storage, Edge Functions) e frontend React/Vite/TypeScript na Vercel. Publicação no tópico de cada obra do supergrupo CO-FZ.

## Prioridade atual — fundação e dados da HTO (2026-11-09)

- [x] Criar o projeto Supabase de desenvolvimento e o projeto Vercel ligado a `app/` (2026-11-09).
- [x] Extrair os ambientes dos dois PDFs para `data/hto/ambientes.json`.
- [x] Revisar a lista de ambientes e os pinos nas imagens de prova.

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

- [x] Criar projetos Supabase (dev) e Vercel: Supabase `miniappcofz-dev` (ref `nyfcualazkngqmrxcczh`, sa-east-1, organização PFAN1234) e Vercel `miniappcofz` (equipe PFAN1234, Root Directory `app`, framework Vite, ligado a `pfan1234/miniappcofz`). Segredos apenas em variáveis de ambiente.
- [x] `.env.example` versionado (raiz e `app/`).
- [ ] Liberar a URL de produção da Vercel para o Telegram: o projeto nasceu com Vercel Authentication em todas as URLs exceto domínios próprios, o que bloqueia a abertura pelo Telegram (resolver antes da fase 6).
- [x] Scaffold `app/` com Vite, React, TypeScript, ESLint, Vitest e o script `telegram-web-app.js`.
- [x] Adicionar `requirements-dev.txt` com `pytest` e fazer `tests/` passar.
- [x] CI no GitHub Actions: typecheck, lint, Vitest, build e pytest (`.github/workflows/ci.yml`).
- [x] CI com testes de banco (PostgreSQL 17 + stub do Supabase) e das Edge Functions (Deno), no lugar do `supabase db lint`, que exige a stack local em Docker.
- [x] Confirmar o modo de chaves JWT do projeto Supabase: chaves de assinatura assimétricas; `auth-telegram` gera sessão pelo Supabase Auth (link mágico + `verifyOtp`), sem JWT próprio (ver `tasks/plano-app.md`, fase 2).

Verificação: CI verde em um commit vazio de funcionalidade; `vite dev` abre a tela inicial. Dependência: nenhuma.

## 1. Ambientes da HTO a partir dos PDFs

- [x] `scripts/extrair_ambientes.py`: parear cada nome com o `A=xx m²` logo abaixo dele em `artifacts/validation/pdf/inventory.json`, gerando `data/hto/ambientes.json` (44 ambientes no térreo, 43 no 1º pavimento).
- [x] Sinalizar duplicatas (CIRC. SUL, Circulação: um ambiente com dois pinos), Jardim repetido e área “Não incluso”; banheiros separados dos apartamentos.
- [x] `scripts/gerar_plantas.py`: visão geral (WebP 2400 px e HD 4096 px) de cada pavimento, recorte de detalhe por ambiente e manifesto `data/hto/plantas.json`; legendas e carimbo cobertos.
- [x] Imagem de prova com todos os pinos iguais, acima do nome (`data/hto/plantas/R05/<pavimento>/prova.png`).
- [x] Revisão humana da lista em 2026-11-09: nomes aprovados, Jardim 1/2 mantidos, pinos como estão, banheiros separados, circulações com dois pinos, todos os ambientes, lista sem grupos em ordem alfabética.
- [x] Gerar `supabase/seed/hto.sql` a partir da lista revisada (`scripts/gerar_seed.py`); carregado no `miniappcofz-dev` (87 ambientes, soma conferida com o seed local).

Verificação: pytest confere APTO. 101 = 23,88 m², SALÃO DE EVENTOS = 158,59 m² (Térreo) e APTO. 211 = 20,58 m² (1º pavimento). Dependência: 0.

## 2. Banco, permissões e autenticação Telegram

- [x] Migrations: obra, usuário, participação, solicitação de acesso, pavimento, ambiente, registro, foto, encerramento e publicação Telegram (contrato em `docs/esquema-fase2.md`; aplicadas no `miniappcofz-dev` em 2026-11-09).
- [x] RLS por participação na obra; encerramento só por gestor; bucket privado `fotos` com política pelo caminho da obra; foto vinculada a registro não pode ser sobrescrita.
- [x] RPCs `concluir_registro` (idempotente pelo id do cliente) e `encerrar_pendencia` (gestor, pendência aberta, `for update`), ambas enfileirando a publicação na mesma transação.
- [x] Edge Function `auth-telegram`: validar `initData` (assinatura e `auth_date`), criar/atualizar usuário e emitir sessão (código e testes; 18 testes Deno).
- [ ] Deploy da `auth-telegram` com `TELEGRAM_BOT_TOKEN` e `ALLOWED_ORIGINS` (depende do bot de teste, fase 6) e teste com um `initData` real, conferindo o campo `signature`.
- [ ] Teste de ponta a ponta no projeto remoto: sessão real → upload no Storage → `concluir_registro` (confere `owner_id` e acesso do `postgres` a `storage.objects`).
- [ ] Descoberta de obras para quem ainda não participa (pedir acesso sem conhecer o `obra_id`) — fase 7.

Verificação: testes de banco — outra obra não lê nem grava; equipe não encerra; repetir `concluir_registro` não duplica; initData adulterado ou expirado é rejeitado. Dependência: 1.

## 3. Navegação por lista

Contrato: `docs/contrato-fase3.md`. Decisões de 2026-11-09: login real só na fase 6 (a fase 3 roda com dados de teste, `VITE_DADOS=fixture`); plantas em bucket privado com URL assinada; pinos sobrepostos na visão geral ficam como estão (zoom ou busca da planta para separar).

- [x] Tabelas `planta` e `planta_detalhe`, bucket privado `plantas` e seed (2 plantas, 87 recortes); aplicados no `miniappcofz-dev`.
- [x] Base do app: rotas, camada de dados (Supabase e fixture fora do build de produção), sessão, BackButton, tema e barra inferior.
- [x] Tela Obras: obras permitidas com pendências abertas, busca (mais de 5 obras) e últimos registros, sem obra pré-selecionada.
- [x] Tela da obra: abas Térreo / 1º pavimento, busca e lista única em ordem alfabética natural; cartão do modelo federado oculto por feature flag.
- [x] Tela do ambiente: abas Histórico / Pendências e cartão “Onde fica” com o recorte da planta; botão Novo registro oculto até a fase 4.
- [x] Aba Planta na obra: marcadores tocáveis, zoom/arraste, busca centralizando o ambiente, contagem de pendências e aviso “posição indicativa”; cache das imagens por service worker.
- [x] Testes Playwright em viewport móvel (lista, pino, “Onde fica”, Telegram simulado) e job `e2e` no CI.
- [ ] Enviar as imagens ao bucket `plantas` com `scripts/publicar_plantas.py` (exige a chave secreta; necessário antes do teste com login real na fase 6).

Verificação: Playwright em viewport móvel com Telegram simulado navega Obras → HTO → Apto. 101, pela lista e pelo marcador na planta. Dependência: 2.

## 4. Novo registro e histórico

Contrato: `docs/contrato-fase4.md`. Desenvolvido e testado com a fixture; o envio real ao Supabase é testado de ponta a ponta com o login da fase 6.

- [x] Câmera e galeria, até 10 fotos, compressão no cliente (JPEG até 1920 px) sem EXIF/localização.
- [x] Tipo Serviço/Pendência e legenda obrigatória; upload ao Storage e `concluir_registro` com os mesmos ids em toda tentativa (retomada sem duplicar).
- [x] Erro com "Tentar de novo"; formulário travado depois de envio parcial; confirmação ao sair com o formulário preenchido.
- [x] Histórico com miniatura, tipo, legenda, autor, horário, estado de publicação e visualizador de fotos.
- [ ] Teste no Supabase remoto (sessão real → upload → `concluir_registro` → leitura com URL assinada) — junto com a fase 6.

Verificação: Playwright (fixture) salva uma pendência com foto de 2400×1600 com GPS e confere o JPEG enviado (≤ 1920 px, 3:2, sem `Exif`/APP1); Vitest cobre orquestrador, erros e tela. Dependência: 3.

## 5. Registros com sinal instável

Contrato: `docs/contrato-fase5.md`. Decisões de 2026-11-09: ao salvar, o app volta na hora e envia em segundo plano; o uso sem sinal (app e dados já vistos no aparelho por até 7 dias) entra nesta fase.

- [x] Rascunhos e fotos em IndexedDB, confirmados antes de exibir “aguardando envio”.
- [x] Sincronizar ao abrir, no evento `online`, ao voltar ao app e por tentativa manual, sem duplicar; backoff de 15 s a 5 min; falha definitiva pede "Tentar de novo" ou "Descartar".
- [x] Estados salvo no aparelho / salvo no servidor / publicado; detecção de falta de espaço; rascunhos e cache isolados por usuário.
- [x] App abre sem sinal pelo service worker (precache por manifesto) e mostra os dados já vistos (cache de consultas no aparelho, refeito ao abrir com sinal).
- [ ] Conferir no Telegram real (fase 6): Android sem sinal; no iPhone o WebView não roda service worker, então lá só a fila funciona.

Verificação: Playwright offline → salvar → recarregar offline → voltar o sinal → enviado sem duplicar; cota simulada exibe o alerta. Vitest cobre armazenamento, fila, cache e telas. Dependência: 4.

## 6. Bot e publicação no tópico da obra

Contrato: `docs/contrato-fase6.md`. Decisão de 2026-11-10: acesso "grupo + aprovação" (admin do grupo vira gestor; membro pede acesso e um gestor aprova; quem sai do grupo perde o acesso no próximo login).

- [x] Bot de teste `@diarioobra_cofz_bot`, grupo TesteDev com tópico HTO e Mini App `t.me/diarioobra_cofz_bot/fiscalcofz`.
- [x] Migration: `membro_grupo`, pedidos de acesso por RPC, aprovação pelo gestor, fila de publicação e disparo por pg_cron/pg_net (testes de banco).
- [x] `auth-telegram` sincroniza o acesso pelo grupo (`getChatMember`).
- [x] `bot-webhook`: `/vincular_obra <slug>` grava chat e tópico da obra; `/fixar_botao`; `/start` em privado.
- [x] `publish-outbox`: foto(s), obra, pavimento, ambiente, tipo, legenda, autor e link `startapp` de retorno; backoff e estado `incerto` para respostas ambíguas; aviso de pedido de acesso no tópico.
- [x] App: login real, "Outras obras" com pedido de acesso, tela de pedidos para o gestor, abertura pelo link `startapp`.
- [ ] Cadastrar `TELEGRAM_BOT_TOKEN` nos segredos das Edge Functions (usuário) e dar ao bot as permissões de fixar mensagens e gerenciar tópicos.
- [ ] Aplicar a migration, criar os segredos do Vault, publicar as funções e configurar o webhook.
- [ ] `/vincular_obra hto` no tópico HTO e `/fixar_botao` no Geral.
- [ ] Teste real: login, registro publicado no tópico, link de volta, pedido de acesso de um segundo membro.

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
