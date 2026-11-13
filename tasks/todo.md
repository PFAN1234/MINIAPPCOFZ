# Execução — Diário da obra (piloto HTO)

Detalhes de cada fase em `tasks/plano-app.md`. Decisão de 2026-11-09: o visualizador do modelo federado e a integração IFC/planta clicável ficam para a última fase. Stack: Supabase (Postgres, RLS, Storage, Edge Functions) e frontend React/Vite/TypeScript na Vercel. Publicação no tópico de cada obra do supergrupo CO-FZ.

## Prioridade atual — fundação e dados da HTO (2026-11-09)

- [x] Criar o projeto Supabase de desenvolvimento e o projeto Vercel ligado a `app/` (2026-11-09).
- [x] Decisão de 2026-11-12: um banco só. O `miniappcofz-dev` é o banco oficial do Mini App e do site `/admin/` (é o que a Vercel usa em produção); não há projeto de produção separado. Se um dia houver, aplicar todas as migrations, publicar as Edge Functions, cadastrar os segredos e trocar `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` na Vercel.
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

Contrato: `docs/contrato-fase7.md`. Pedido de 2026-11-10: completar todas as telas do mockup, com o botão do modelo federado já no lugar (o visualizador fica para a fase 9).

- [x] Imagens das plantas no bucket `plantas` (91 arquivos, via `assinar-envio-plantas`).
- [x] Lista de pendências da obra com abas Abertas/Resolvidas e filtro por ambiente (e por obra na aba global).
- [x] Encerrar pendência (gestor) com foto de comprovação e observação, pela fila offline, publicada como resposta à mensagem original.
- [x] Gestão: aprovar solicitações de acesso, definir papel, remover participante, reenviar ou marcar como publicada.
- [x] Aba global Registros com filtros por obra e tipo.
- [x] Cartão "Visualizar modelo federado" na tela da obra, com tela de espera.
- [ ] Teste real no grupo TesteDev: planta, encerramento publicado como resposta, gestão.

Verificação: pendência aberta e resolvida aparece no histórico e no grupo de teste; equipe não consegue encerrar; encerramento concorrente tem um só vencedor. Dependência: 6.

## 8. Piloto assistido HTO

- [ ] Grupo real, equipe e gestores cadastrados.
- [ ] Testes em Android e iOS reais: câmera, permissões, WebView, rascunho após fechar, desempenho.
- [ ] Backup e restauração do Postgres e do Storage.
- [ ] Registrar aceite do fluxo com a equipe da obra.

Dependência: 7. Tokens do bot, grupo real, hospedagem e aparelho de teste ainda não foram fornecidos/configurados.

## Novas obras

Procedimento em `tasks/plano-app.md` (seção "Novas obras"). Decisões de 2026-11-11: PDFs no padrão da HTO; planta e pinos quando o PDF permitir, senão só a lista; supergrupo CO-FZ com um tópico por obra, sem mudar a regra de acesso; adaptar os scripts já, supergrupo real só depois do teste real da HTO.

- [x] Configuração por obra (`data/<slug>/obra.json`), começando pela HTO com os valores hoje fixos nos scripts; inclui `renomear`, `categorias` e `ambientes_manuais` (cômodo sem rótulo, pino colocado à mão).
- [x] Scripts com `--obra <slug>` e extrator lendo os PDFs direto, sem o `inventory.json` de diagnóstico.
- [x] Pipeline da HTO reproduz os JSON, as imagens e `supabase/seed/hto.sql` sem diferença de conteúdo (só o campo `fonte` e a ordem das chaves de `plantas.json`, mantido como estava); pytest passa.
- [x] COFZ: PDF em `DOCS COFZ/PDF/` (DE009 R06, pavimento único), triagem, extração e imagens; 19 ambientes (17 rotulados + WC da chefia e Sala de apoio à mão), `supabase/seed/cofz.sql`. Decisões de 2026-11-11: nome "COFZ", circulações numeradas por área, "DA" → "Sala DA".
- [ ] COFZ: revisão humana da `data/cofz/plantas/R06/terreo/prova.png` e dos nomes → `status: revisado`.
- [x] COFZ: seed aplicado no `miniappcofz-dev` (19 ambientes, 19 recortes) e 21 imagens no bucket `plantas` via `assinar-envio-plantas` (2026-11-11).
- [ ] Tópico no grupo de teste, `/vincular_obra <slug>` e registro publicado no tópico certo.
- [ ] Depois do teste real da HTO: vincular a obra no supergrupo CO-FZ.

Verificação: obra nova aparece em Obras com seus pavimentos, lista e planta; outra obra não lê os dados dela; registro publicado no tópico dela. Dependência: o supergrupo real depende das fases 6 e 7.

## Revisões de planta

Decisões de 2026-11-11 em `tasks/plano-app.md` (seção "Novas obras") e roteiro em `scripts/README.md` ("Alterar a planta de uma obra").

- [x] Nova revisão, ambiente renomeado e ambiente removido: o extrator usa o `ambientes.json` anterior como base (códigos mantidos, `manter_codigo` para renomeação confirmada, `ambientes_removidos` acumulativa e relatório `diferencas`); o seed desativa a planta de outra revisão antes de gravar a nova e marca os removidos com `ativo = false`; migração `20261111130000_ambiente_ativo.sql`; o app tira os inativos da lista, da busca e da planta e mostra um aviso na tela do ambiente inativo. HTO e COFZ regeneradas sem mudança além dos campos novos.
- [x] Seed inativa também qualquer ambiente da obra fora da lista atual (cobre id provisório aplicado antes do `manter_codigo`).
- [x] Migração `ambiente_ativo` aplicada no `miniappcofz-dev` (2026-11-11). Os seeds regenerados não mudam nada no banco (mesma revisão; todos os 87 ambientes da HTO e 19 da COFZ estão na lista e ativos), então não precisaram ser reaplicados.
- [x] Banco único: a migração `ambiente_ativo` está no `miniappcofz-dev`, o banco oficial (decisão de 2026-11-12: sem banco de produção separado).

Verificação: pytest (`tests/test_revisoes.py` e `tests/db/test_revisoes_banco.py`: R01 → R02 com planta anterior inativa, removidos inativos e registros preservados) e Vitest (aviso e filtro dos inativos).

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

## 10. Realidade aumentada no registro de fotos

Plano: `tasks/plano-ra.md` (decisões de 2026-11-12: modelo ELT fornecido pelo usuário; só a "RA parada" dentro do Telegram; alinhamento por dois cantos e por QR; duas fotos por disparo, limpa e com o modelo).

- [x] Código das fases RA0 a RA4 (2026-11-12): tela de teste `/ra-teste`; geometria de 86 dos 87 ambientes no referencial do `ARQ.frag` (`scripts/gerar_geometria.py`, `data/hto/geometria.json`); migration `20261113090000_ra.sql`; tela de RA com dois cantos, QR, ajuste fino e par de fotos no registro; QR no `/admin/obras/<slug>/ra`. Uso e aplicação em `docs/ra.md`.
- [ ] Aplicar no `miniappcofz-dev`: migration `20261113090000_ra.sql` e `supabase/seed/hto_geometria.sql`.
- [ ] Conferir que o `ARQ.frag` publicado é o mesmo do repositório (hash `dffa24c612d76690`); se não for, refazer o ajuste do referencial.
- [ ] Modelo de elétrica: conferir no visualizador e na RA se cai no lugar; se vier deslocado, gravar `modelo.matriz`.
- [ ] RA0 no aparelho: `/ra-teste` em um Android e um iPhone, dentro do Telegram.
- [ ] Conferir a cota do piso acabado e o pé-direito fora do Apto. 101 (hoje 0,385 m e 2,60 m para todos os ambientes).
- [ ] Jardim 2 sem geometria (sem área na planta); Lobby e Circulação do 1º pavimento usam só o contorno externo (o IfcSpace tem furo).
- [ ] Cadastrar e fixar os QRs dos ambientes do piloto.
- [ ] RA5. Piloto em campo em quatro ambientes, medição do erro.

Verificação: Vitest recupera poses sintéticas (< 1 cm, < 0,5°); e2e com câmera falsa salva o par de fotos; no aparelho, o contorno do Apto. 101 encaixa nas arestas reais. Dependência: 9 (federação validada e vínculo com o IfcSpace); o RA0 pode ser feito já.

## Site de administração

Plano: `tasks/plano-admin.md` (decisões de 2026-11-11).

- [x] Fase 1 (código, 2026-11-11): perfil admin do Mini App (migration `20261111170000_admin.sql`), `admin-sessao` (link de uso único e Telegram Login Widget), botão no Mini App, site `/admin/` com obras, pavimentos, configuração, admins e exportação; `scripts/importar_config_obras.py` → `supabase/seed/admin_config.sql` (HTO e COFZ); `supabase/seed/admins.sql` (Patrício e Eduardo). Documentação em `docs/admin.md`.
- [ ] Fase 1 no `miniappcofz-dev` (aplicado em 2026-11-11, falta conferir; passo a passo em `docs/admin.md`, "Aplicar num projeto"):
  - [x] Aplicar a migration `20261111170000_admin.sql`.
  - [x] Deploy da Edge Function `admin-sessao` (`verify_jwt = false`) com `TELEGRAM_BOT_TOKEN`, `SUPABASE_SECRET_KEY`, `ALLOWED_ORIGINS` (com o domínio do site) e, se diferente do padrão, `ADMIN_URL`.
  - [x] Aplicar `supabase/seed/admin_config.sql` (configuração de HTO e COFZ).
  - [x] Aplicar `supabase/seed/admins.sql` depois de Patrício e Eduardo terem aberto o Mini App; conferir a consulta do fim do arquivo.
  - [x] Vercel: `VITE_TELEGRAM_BOT` = `diarioobra_cofz_bot` (o deploy novo vem com o merge na main).
  - [x] Conferir: botão "Administração" e link abrem o site logado (Patrício, 2026-11-11). Falta: link não vale de novo; Login Widget entra com admin e recusa outra conta.
  - [x] Banco único (decisão de 2026-11-12): migration, função `admin-sessao` e seeds já estão no `miniappcofz-dev`, que é o banco oficial; não há produção separada.
- [x] Fase 2 (código, 2026-11-12): planta no navegador. Migration `20261112090000_admin_planta.sql` (bucket `originais`, gravação do admin em `plantas`, `publicacao_planta`, RPCs `admin_publicar_revisao`, `admin_editor_planta`, `admin_listar_publicacoes`); port do extrator e das imagens em `app/src/admin/planta/` com paridade (HTO e COFZ); editor em `/admin/obras/<slug>/planta/<pavimento>`; histórico na página da obra. Documentação em `docs/admin.md` ("Planta (fase 2)").
- [ ] Fase 2 no `miniappcofz-dev` (migration aplicada em 2026-11-12; falta o teste de fumaça; passo a passo em `docs/admin.md`, "Planta (fase 2)" → "Aplicar num projeto"):
  - [x] Aplicar a migration `20261112090000_admin_planta.sql` (cria o bucket `originais` e as políticas de Storage).
  - [x] Conferir: bucket `originais` privado, 50 MB, só `application/pdf`; políticas `originais_admin_*` e `plantas_admin_*` em `storage.objects`.
  - [ ] Deploy do app na Vercel (o merge na main publica o editor em `/admin/`).
  - [ ] Teste de fumaça: como admin, enviar o PDF da COFZ no térreo, conferir que a etapa "Nova revisão" não mostra diferenças, publicar (mesma revisão R06: substitui as imagens) e conferir no Mini App a planta e um "Onde fica"; ver a linha nova em "Publicações da planta".
  - [x] Banco único (decisão de 2026-11-12): a migration já está no `miniappcofz-dev`, o banco oficial.
- [x] Pinos e ambientes manuais depois de publicar (código, 2026-11-12): "Adicionar pino" em qualquer ambiente (rotulado → `marcadores_ajustados`; sem rótulo → `marcadores` em `ambientes_manuais`, lido também pelo `extrair_ambientes.py`) e atalho "Ajustar ambientes e pinos" na lista de pavimentos, que reabre o PDF guardado direto na etapa 3. Sem migration.
- [ ] Teste de fumaça do ajuste: publicar um pavimento pelo site, voltar em "Ajustar ambientes e pinos", acrescentar um pino e um ambiente, publicar e conferir no Mini App.
- [x] Fase 3 (código, 2026-11-12): modelo 3D pelo site. Migration `20261112120000_admin_modelo.sql` (políticas de admin no bucket `modelos`, caminho `<obra_id>/<SIGLA>/<hash>.frag`, `publicacao_modelo`, RPCs `admin_registrar_modelo`, `admin_listar_modelos`, `admin_retirar_modelo`); IFC → .frag num Web Worker ou .frag pronto, limite de 50 MB; página `/admin/obras/<slug>/modelos` com histórico. Documentação em `docs/admin.md` ("Modelo 3D (fase 3)").
- [ ] Fase 3 no `miniappcofz-dev` (migration aplicada em 2026-11-12; falta o teste de fumaça; passo a passo em `docs/admin.md`, "Modelo 3D (fase 3)" → "Aplicar num projeto"):
  - [x] Aplicar a migration `20261112120000_admin_modelo.sql` (conferido: políticas `modelos_admin_*`, as 3 RPCs e a RLS de `publicacao_modelo`).
  - [ ] Teste de fumaça: em HTO → "Modelos 3D", enviar `app/public/modelos/hto/ARQ.frag` (ARQ, R06), publicar e abrir o modelo no Mini App; converter um IFC pequeno pelo site.
  - [x] Banco único (decisão de 2026-11-12): a migration já está no `miniappcofz-dev`, o banco oficial.
- [x] Arquivar e excluir obra (código, 2026-11-12): migration `20261112150000_admin_arquivar_excluir.sql` (obra arquivada some do Mini App, não recebe registros nem pedidos de acesso e não publica; `admin_arquivar_obra`, `admin_resumo_obra`, `admin_excluir_obra`, `admin_listar_exclusoes`), Edge Function `admin-excluir-obra` (apaga os arquivos dos 4 buckets) e a seção "Arquivar ou excluir" no site. Documentação em `docs/admin.md` ("Arquivar e excluir obra").
- [ ] Arquivar e excluir no `miniappcofz-dev`:
  - [x] Migration `20261112150000_admin_arquivar_excluir.sql` aplicada (2026-11-12).
  - [x] Edge Function `admin-excluir-obra` publicada (`verify_jwt = false`); conferido: 405 em GET, 401 sem token e com token falso, CORS do site. Usa `SUPABASE_ANON_KEY` (chave legada ativa) para falar com o banco como o admin.
  - [x] Republicadas `bot-webhook` e `publish-outbox` (versão 2, 2026-11-12). Conferido: 405 em GET e 401 sem segredo nas duas; a chamada do cron ao `publish-outbox` novo respondeu 200, sem erro no log.
  - [ ] Teste de fumaça no site com uma obra de teste: arquivar, conferir que some do Mini App, desarquivar, excluir digitando o nome e conferir "Obras excluídas".
- [x] Configurar `/setdomain` do bot no BotFather com o domínio do site (Login Widget): `miniappcofz.vercel.app` (Patrício, 2026-11-12). Falta conferir: o widget entra com um admin e recusa outra conta.

## Novo visual (direção B · Canteiro)

Plano: `tasks/plano-visual.md` (decisões de 2026-11-12). Prancha de design com as telas de referência (B1 a B20) linkada no plano.

- [x] Propostas de design (três direções), escolha da direção B, paleta azul-escuro `#0B1625` e amarelo, sempre clara, e telas de referência do Mini App e do admin (2026-11-12).
- [x] Corrigir a colisão da classe `.visualizador` (fotos x modelo 3D), com teste e2e de tela cheia (2026-11-12).
- [x] V0. Fundação: `app/src/estilo/tokens.css`, fontes Barlow servidas pelo app (no precache), cores do cabeçalho e do fundo do Telegram, ícones (2026-11-12). Entraram as variáveis de cor (Mini App e admin sempre claros, sem `--tg-theme-*` nem modo escuro, topo azul-escuro), Barlow e Barlow Semi Condensed latinas (`@fontsource` 5.3.0, seis `.woff2` no precache), `aplicarCoresTelegram()` com as versões mínimas 6.9, 6.1 e 7.10 e 14 ícones novos em `Icones.tsx`, sem mudar a estrutura das telas.
- [x] V1. Estrutura do Mini App: `TopoTela`, barra inferior com ícones, faixa de sincronização, estados vazio, erro e 404 (2026-11-12). Saiu a barra "Diário da obra"; cada tela tem o topo azul com o título em `h1` (o "Voltar" fica nele só fora do Telegram e as migalhas viraram links no topo), a faixa amarela de envio logo abaixo do azul com "Enviar", a barra inferior com ícones, indicador amarelo e "Pendências · N" (da consulta do Início, sem consulta nova), e os estados vazio, erro e carregando no estilo da B13, também na página 404 com "Voltar ao início".
- [ ] V2. Telas principais: Obras, Obra, Ambiente (atalhos "+ Serviço" e "+ Pendência"), Novo registro (`?tipo=`).
- [ ] V3. Demais telas: Planta, Pendências, Pendência e encerramento, Registros, Gestão, Modelo federado, sem sinal.
- [ ] V4. Admin: barra lateral, Entrar, Obras, Administradores, página da obra em abas, editor da planta em área escura.
- [ ] V5. Conferência com a prancha, contraste e toque, teste no Telegram real (Android e iPhone), limpeza do CSS antigo.

Verificação: em cada fase, typecheck, lint, Vitest e e2e verdes e capturas 390×844 (Mini App) e 1440×900 (admin) comparadas com a prancha.

## Etapas e organização

Contrato: `docs/contrato-etapas.md`. Decisões de 2026-11-12: o app passa a se chamar Fiscal Bot; cada etapa do campus tem suas obras e um grupo do Telegram (um tópico por obra), ligado com `/vincular_etapa <slug>`; seletor de etapa na tela inicial do Mini App; logo e nome da OM em todas as telas, configurados no site; obras existentes na "2ª ETAPA"; arquivar etapa vale para todas as obras dela; excluir etapa apaga as obras e pede o nome digitado.

- [x] Banco: migration `20261112180000_etapas.sql` (`etapa`, `obra.etapa_id`, `organizacao`, bucket `organizacao`, RPCs `admin_*_etapa`, `organizacao`, `vincular_etapa`) e testes de banco.
- [x] Edge Functions: `/vincular_etapa` no `bot-webhook`, ação `excluir_etapa` na `admin-excluir-obra`, textos "Fiscal Bot".
- [x] Site: etapas (criar, editar, arquivar, excluir, grupo do Telegram), obra dentro da etapa, página Organização (nome e logo), barra do topo com logo.
- [x] Mini App: nome Fiscal Bot, faixa com logo e nome da OM em todas as telas, seletor de etapa na tela inicial.
- [x] Aplicar no `miniappcofz-dev` (2026-11-12): migration (a "2ª ETAPA" herdou o grupo das 3 obras), deploy de `bot-webhook`, `publish-outbox` e `admin-excluir-obra`, comandos do bot reconfigurados.
- [x] Merge na main (PR #21, 2026-11-12) e app novo publicado pela Vercel.
- [x] Logo da CO-FZ enviado em `/admin/organizacao`; a prévia do logo no site deixou de vazar da caixa (2026-11-13).
- [ ] Usuário: trocar o nome do bot e do Mini App no BotFather para Fiscal Bot (o `/vincular_etapa 2a-etapa` não é necessário: a etapa herdou o grupo).

Verificação: testes de banco (arquivar etapa bloqueia acesso e publicação; excluir etapa exige o nome), Deno, Vitest e Playwright (criar etapa e obra, arquivar, excluir digitando o nome, trocar logo; seletor de etapa no Mini App).

## Encerrar pendência pela equipe

Decisão de 2026-11-13: qualquer participante da obra (equipe ou gestor) encerra pendência, com as mesmas fotos de comprovação. Antes só o gestor. Obra ou etapa arquivada continua bloqueando.

- [x] Banco: migration `20261113120000_encerrar_pendencia_equipe.sql` (`encerrar_pendencia` confere `privado.eh_participante` no lugar de `eh_gestor`; `encerramento.gestor_id` mantém o nome e guarda quem encerrou) e testes de banco.
- [x] Mini App: formulário de encerramento para todos os participantes, sem a nota "Só gestores…"; fixture igual.
- [x] Aplicado no `miniappcofz-dev` (2026-11-13).
- [ ] Merge na main.

## Boletim de Acompanhamento Diário

Plano: `tasks/plano-boletim.md`. Decisões de 2026-11-13: um boletim por etapa por dia, emissão automática com retificação (`-R1`), clima só do INMET (céu estimado pela radiação), número `BA<sigla>/<YYMMDD>/<OM>` (ex.: `BA2/261111/COFZ`), nome de exibição definido por admins, observações por obra escritas pelos participantes. Prévia: `docs/mockups/boletim-diario-v2.pdf`. Contrato da parte 1 (banco e site de administração): `docs/contrato-boletim.md`.

- [x] Migration `20261113150000_boletim_base.sql`: sigla, localização, fuso, estações INMET, horário de emissão e dados do contrato da etapa; `etapa_aditivo`, `etapa_responsavel`, `usuario.nome_exibicao`, `organizacao.cabecalho`, `observacao`, `inmet_estacao`, `clima_dia`, `boletim`, bucket `boletins`, RLS e numeração (`tests/db/test_boletim_base.py`; 547 testes de banco passando).
- [x] Migration aplicada no `miniappcofz-dev` em 2026-11-13, junto com o merge (as 31 funções novas ou alteradas conferidas por hash com o repositório; 2ª etapa com sigla 2, fuso de Fortaleza e o número `BA2/261113/COFZ`).
- [ ] Preencher pelo site os dados da 2ª etapa (14 campos faltando: localização, estação INMET, contrato e responsáveis) e os nomes de exibição.
- [x] Admin: cadastro da etapa com sigla, localização (mapa + estação INMET sugerida), fuso, horário de emissão e dados do contrato, editáveis depois; responsáveis e aditivos na página da etapa; linhas do cabeçalho em Organização (Vitest e e2e passando).
- [x] Página Pessoas no admin (nome de exibição).
- [ ] Nome de exibição no Mini App e nas publicações do Telegram.
- [ ] Cartão Observações do dia na página da obra (com fila offline e trava após a emissão).
- [ ] Edge Function `coletar-clima` (INMET, estação reserva, céu pela radiação) com testes; acesso ao INMET a partir de `sa-east-1`.
- [ ] Snapshot do dia: indicadores, serviços e pendências, com testes de banco (inclui fuso e lançamento tardio).
- [ ] Template HTML, PDF, envio ao grupo da etapa no Telegram.
- [ ] Agendamento por etapa, retificação e tela "Boletins" no Mini App.
- [ ] Exclusão de etapa com boletins: remover também os PDFs do bucket `boletins` (Edge Function de exclusão).
- [ ] Externo: token do INMET; coordenadas e dados administrativos da 2ª etapa; nomes de exibição dos participantes.
