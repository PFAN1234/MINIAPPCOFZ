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
- [x] COFZ: PDF em `obras/cofz/pdf/` (DE009 R06, pavimento único), triagem, extração e imagens; 19 ambientes (17 rotulados + WC da chefia e Sala de apoio à mão), `supabase/seed/cofz.sql`. Decisões de 2026-11-11: nome "COFZ", circulações numeradas por área, "DA" → "Sala DA".
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

## 9. Modelo federado (entregue em `.frag`)

Diagnóstico existente preservado em `docs/validacao-hto.md` e `artifacts/validation/`. Plano executado em `tasks/plano-modelo-federado.md`.

- [x] Inventariar as duas plantas PDF e os três IFCs.
- [x] Extrair textos/coordenadas e gerar previews das plantas.
- [x] Extrair hierarquia, unidades, matrizes e geometria dos espaços IFC.
- [x] Federação e vínculo ambiente ↔ `IfcSpace` validados (`scripts/gerar_geometria.py`, `ra_referencial` e `modelo.matriz`).
- [x] Conversão para `.frag` (Web Worker no `/admin/` + script CLI) e visualizador federado com `@thatopen/components` + `@thatopen/fragments` (substituiu o plano inicial de recortes GLB).
- [x] Ativação do cartão/prévia do modelo federado na obra e cache por hash no aparelho.

Verificação: sobreposição visual e controle independente de coordenadas; recorte não contém ambientes vizinhos inteiros; carregamento sob demanda sem enviar o IFC completo ao celular. Dependência: 8.

## 10. Realidade aumentada no registro de fotos

Plano: `tasks/plano-ra.md` (decisões de 2026-11-12: modelo ELT fornecido pelo usuário; só a "RA parada" dentro do Telegram; alinhamento por dois cantos e por QR; duas fotos por disparo, limpa e com o modelo).

- [x] Código das fases RA0 a RA4 (2026-11-12): tela de teste `/ra-teste`; geometria de 86 dos 87 ambientes no referencial do `ARQ.frag` (`scripts/gerar_geometria.py`, `data/hto/geometria.json`); migration `20261113090000_ra.sql`; tela de RA com dois cantos, QR, ajuste fino e par de fotos no registro; QR no `/admin/obras/<slug>/ra`. Uso e aplicação em `docs/ra.md`.
- [x] Aplicado no `miniappcofz-dev` (2026-11-13): migration `20261113090000_ra.sql` e `supabase/seed/hto_geometria.sql` pelo `scripts/supabase_api.py`; conferido no banco (86 geometrias, 1 referencial ARQ R06, 3 RPCs `admin_*_ra/qr`, ARQ publicado).
- [x] ARQ publicado conferido (2026-11-13): R06, hash `497ec6abd4af7884`, mesmas coordenadas e geometria do `.frag` usado no ajuste do referencial.
- [x] Modelo de elétrica conferido (2026-11-13): ELT R03 cai no lugar só com a coordenação automática, sem `modelo.matriz` (mediana de 2,6 cm entre as descidas de eletroduto e as faces das paredes).
- [ ] RA0 no aparelho: `/ra-teste` em um Android e um iPhone, dentro do Telegram.
- [ ] Conferir a cota do piso acabado e o pé-direito fora do Apto. 101 (hoje 0,385 m e 2,60 m para todos os ambientes).
- [ ] Jardim 2 sem geometria (sem área na planta); Lobby e Circulação do 1º pavimento usam só o contorno externo (o IfcSpace tem furo).
- [x] Planta baixa no ajuste do QR do admin (2026-11-17): `/admin/obras/<slug>/ra` mostra a planta real com o cômodo, cantos numerados e a marca do QR (só visualização; sem planta cai no desenho esquemático). Migration `20261122090000_ra_admin_planta.sql` (`admin_listar_ra` devolve `contorno_pagina` e a planta ativa) aplicada em `miniappcofz-dev`. Design e plano em `docs/superpowers/`.
- [x] Botão "Visualizar modelo" no ambiente (2026-11-17): entre "Novo registro" e "Comparar com o modelo (RA)"; rota `obras/<slug>/ambientes/<codigo>/modelo` abre o modelo 3D cortado em volta do ambiente (mesma caixa da RA), câmera enquadrada nele, chip "Só este ambiente" liga/desliga o corte. **Falta conferir com o `.frag` real num navegador com WebGL** (corte e enquadramento não rodam no jsdom). Design e plano em `docs/superpowers/`.
- [ ] Cadastrar e fixar os QRs dos ambientes do piloto.
- [ ] RA5. Piloto em campo em quatro ambientes, medição do erro.
  - [x] Depois do 1º teste em campo (2026-11-13): mira no centro + "Marcar canto", planta real enquadrada no cômodo com os cantos numerados (folha e miniatura), malha triangular (piso estimado antes de alinhar; piso, paredes e teto do modelo depois, chip "Malha").
  - [x] Produção (2026-11-13): migration `20261119090000_ra_contorno_pagina.sql` aplicada e registrada; seed `hto_geometria.sql` reaplicado; 86 de 86 ambientes com `contorno_pagina` (Apto. 101 conferido com o json).
  - [ ] Repetir o teste em campo.
  - [x] Migration `20261123090000_ra_consistencia.sql` aplicada e conferida no `miniappcofz-dev` (2026-11-17): `boletim_fotos` com `origem`, `admin_registrar_modelo` limpando `matriz`, `admin_definir_qr` exigindo ambiente ativo e constraints de finitos/`contorno_pagina`.

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
- [x] Fase 2 (código, 2026-11-12): planta no navegador. Migration `20261112090000_admin_planta.sql` (bucket `originais`, gravação do admin em `plantas`, `publicacao_planta`, RPCs `admin_publicar_revisao`, `admin_editor_planta`, `admin_listar_publicacoes`); port do extrator e das imagens em `app/src/modules/plantas/domain/` com paridade (HTO e COFZ); editor em `/admin/obras/<slug>/planta/<pavimento>`; histórico na página da obra. Documentação em `docs/admin.md` ("Planta (fase 2)").
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
- [x] Merge na main (2026-11-13).

## Boletim de Acompanhamento Diário

Plano: `tasks/plano-boletim.md`. Decisões de 2026-11-13: um boletim por etapa por dia, emissão automática com retificação (`-R1`), clima só do INMET (céu estimado pela radiação), número `BA<sigla>/<YYMMDD>/<OM>` (ex.: `BA2/261111/COFZ`), nome de exibição definido por admins, observações por obra escritas pelos participantes. Prévia: `docs/mockups/boletim-diario-v2.pdf`. Contrato da parte 1 (banco e site de administração): `docs/contrato-boletim.md`.

- [x] Migration `20261113150000_boletim_base.sql`: sigla, localização, fuso, estações INMET, horário de emissão e dados do contrato da etapa; `etapa_aditivo`, `etapa_responsavel`, `usuario.nome_exibicao`, `organizacao.cabecalho`, `observacao`, `inmet_estacao`, `clima_dia`, `boletim`, bucket `boletins`, RLS e numeração (`tests/db/test_boletim_base.py`; 547 testes de banco passando).
- [x] Migration aplicada no `miniappcofz-dev` em 2026-11-13, junto com o merge (as 31 funções novas ou alteradas conferidas por hash com o repositório; 2ª etapa com sigla 2, fuso de Fortaleza e o número `BA2/261113/COFZ`).
- [ ] Preencher pelo site os dados da 2ª etapa (14 campos faltando: localização, estação INMET, contrato e responsáveis) e os nomes de exibição.
- [x] Admin: cadastro da etapa com sigla, localização (mapa + estação INMET sugerida), fuso, horário de emissão e dados do contrato, editáveis depois; responsáveis e aditivos na página da etapa; linhas do cabeçalho em Organização (Vitest e e2e passando).
- [x] Página Pessoas no admin (nome de exibição).
- [x] Nome de exibição no Mini App e nas publicações do Telegram (migration `20261114090000_nome_exibicao_mini_app.sql` aplicada no `miniappcofz-dev` em 2026-11-13, conferida por hash; `publish-outbox` versão 4 publicada).
- [x] Cartão Observações do dia na página da obra (com fila offline e trava após a emissão).
- [x] Clima pelo Observatório de Fortaleza: imagem da linha da estação Montese (reserva Benfica) na tabela "Últimas 24 horas", copiada na emissão, com fonte e horários; `estacao`/`estacao_reserva` (8836/9281) com lista fixa no cadastro da etapa.
- [x] Migration `20261114120000_boletim_emissao.sql`: fila `boletim_emissao`, `boletim_snapshot` (indicadores, serviços, pendências, fuso, lançamentos tardios), agendamento por cron a cada 5 min, retificação, `admin_listar_boletins`/`admin_pedir_emissao` (575 testes de banco passando). **Não aplicada no banco remoto.**
- [x] Gerador na Vercel (`app/api/gerar-boletim.ts`, `app/api/previa-boletim.ts`, `app/servidor/boletim/`): HTML no modelo da CO-FZ, PDF com Chromium, fotos reduzidas, upload ao bucket; `publish-outbox` envia o PDF ao grupo da etapa (Deno: 143 testes). **`publish-outbox` novo ainda não publicado.**
- [x] Site: seção Boletins na página da etapa (emitidos, pedidos, pré-visualizar, emitir agora/retificação); Vitest 577, e2e 48.
- [x] Produção (2026-11-13, PR #26): migration aplicada (21 funções conferidas por hash), cron `agendar-boletins` ativo, `publish-outbox` versão 5 publicado, Vault `url_gerador_boletim` = `https://miniappcofz.vercel.app/api/gerar-boletim`, `SUPABASE_URL` criado na Vercel (Production).
- [x] Vercel: `SUPABASE_SECRET_KEY` (Production, Sensitive) criada pelo usuário e redeploy feito; banco → gerador responde 202 (pg_net), gerador lê o segredo interno do banco.
- [ ] Testar "Pré-visualizar" no site (confirma o Chromium na função) e acompanhar a primeira emissão automática da 2ª etapa (23:30, horário de Fortaleza).
- [x] Retificação de dia antigo reaproveita o clima do boletim anterior do mesmo dia (imagem copiada para o arquivo da retificação; legenda "reaproveitada do boletim <número>"); sem anterior, sai sem clima (2026-11-13).
- [x] Botão "Reenviar ao Telegram" no site para publicação `falhou` ou `incerto` (com confirmação), erro do envio na tabela; migration `20261114150000_boletim_reenvio_clima.sql` (`admin_reenviar_boletim`, `admin_listar_boletins` com erro e tentativas, `boletim_clima_anterior`) (2026-11-13; testes de banco 584, Vitest 590, e2e 48).
- [x] Migration `20261114150000_boletim_reenvio_clima.sql` aplicada no `miniappcofz-dev` (2026-11-13; as 3 funções conferidas por hash, `boletim_clima_anterior` só para `service_role`) e merge na main.
- [x] Prévia e emissão falhavam na Vercel ("Não foi possível gerar o boletim"): o `--single-process` do `@sparticuz/chromium` derrubava o navegador ao fechar o contexto do clima. Corrigido com `argsServerless()` (2026-11-13, PR #30, merge na main). Em seguida o upload da imagem do clima falhava porque o bucket `boletins` só aceitava PDF: migration `20261114160000_boletim_bucket_png.sql` aplicada no `miniappcofz-dev` (2026-11-13).
- [ ] Exclusão de etapa com boletins: remover também os PDFs do bucket `boletins` (Edge Function de exclusão).
- [ ] Externo: avisar o Observatório/IPPLAN do uso dos dados; coordenadas e dados administrativos da 2ª etapa; nomes de exibição dos participantes.

## Aba Boletins e edição do boletim (contrato: `docs/contrato-boletim.md`, parte 4)

- [x] Parte A: banco (rascunho, retificação editada, listagem geral, `admin_boletim`), gerador (`aplicarEdicao`, prévia por POST) e publish-outbox (retificação apaga a mensagem anterior).
- [x] Aplicar a migration em produção e publicar a publish-outbox (2026-11-13).
- [x] Parte B: site (aba Boletins com filtros, editor `/boletins/:id`, cartão na página da etapa).
- [ ] Usuário: testar no site a edição de um boletim (Salvar, Pré-visualizar, Salvar e reenviar) e conferir no grupo que a mensagem anterior foi substituída.

## Mini App em tela cheia

- [x] Arrasto para baixo travado (7.7+) e tela cheia no celular (8.0+), com áreas seguras `--seguro-topo`/`--seguro-base` (PR #34, merge).
- [ ] Usuário: abrir o Mini App no celular e conferir o topo (logo abaixo dos botões X e ⋯) e que arrastar para baixo só rola.

## Organização de pastas e consolidação do repositório

Plano: `tasks/plano-organizacao-pastas.md` (decisões de 2026-11-12; registrado em `docs/ROADMAP.md`).

- [x] Fase 1: capturas `Screenshot 2026-11-06 *.png` removidas da raiz em 2026-11-12 (commit `ef7277c`, ficam no histórico); READMEs já ajustados.
- [x] Fase 2: padronizar `DOCS COFZ/` e `DOCS HTO/` (e `public/ifc/`) → `obras/<slug>/`, atualizar `.gitignore`, `data/*/obra.json`, re-executar o pipeline Python (`extrair_ambientes.py`, `gerar_plantas.py`, `gerar_seed.py`, `importar_config_obras.py`) e atualizar `app/e2e/planta.spec.ts` e scripts/docs.
- [ ] Fase 3: atualizar o `README.md` raiz para refletir o estado atual do projeto.
- [ ] Fase 4 (após estabilização das entregas de UI): organizar `app/src/` em `miniapp/` e `shared/` (mantendo `admin/` isolado) e validar `precache-manifest.json`.

Verificação: `importar_config_obras.py --verificar`, `pytest -q --ignore=tests/db`, `pytest -q tests/db`, Deno (`fmt`/`lint`/`check`/`test`) e `app/` (`typecheck`, `lint`, `test`, `build`, `build:fixture`, `test:e2e`) verdes.

## Equipe de serviço e abas de etapa

- [x] Contrato `docs/contrato-servico.md`; banco (tabela `servico`, RPCs, snapshot), boletim (seção 8) e aviso no grupo; Mini App (abas de etapa, Equipe de serviço, sem "Últimos registros") (PR #35, merge).
- [x] Produção: migração `20261116090000_equipe_servico` aplicada e registrada; `publish-outbox` publicada.
- [ ] Usuário: cadastrar latitude e longitude da 2ª ETAPA no site (sem elas o check-in é recusado).
- [ ] Usuário: testar check-in e check-out no celular e conferir o aviso no grupo.


## Início, tela da obra e Registros (contrato: `docs/contrato-inicio-registros.md`)

- [x] Banco: `resumo_obras()` e `autores_registros()` (migração `20261117090000`, aplicada e registrada em produção).
- [x] Início: abas de etapa ao lado de "OBRAS"; por obra, Gestão (gestor) ao lado do nome e 3 barrinhas (serviços, abertas, resolvidas).
- [x] Obra: Pendências no topo, prévia 3D só com ARQ (abre o visualizador), Observações por último.
- [x] Registros: filtros por etapa, obra, tipo (serviços/abertas/resolvidas), pessoa e período; aba Pendências removida (`/pendencias` → `/registros?tipo=abertas`).
- [ ] Usuário: conferir no celular o início, a prévia do modelo e os filtros de Registros.

## Site: mapa clicável, dados da 2ª ETAPA e aba Relatórios

- [x] Cadastro da etapa: mapa Leaflet (Mapa/Satélite) em que o toque preenche latitude e longitude.
- [x] 2ª ETAPA em produção: objeto, local, endereço, contratante, contrato, contratada, CNPJ, OS, vigência, valor e área (do boletim de 12/11/26).
- [x] Aba "Boletins" do site passa a se chamar "Relatórios" (rota `/boletins` mantida).
- [ ] Usuário: marcar no mapa o local da 2ª ETAPA, salvar e preencher os responsáveis.

## Site: excluir boletim publicado

- [x] Banco: `admin_excluir_boletim(p_id)` apaga o dia inteiro (revisões, pedidos, publicações, rascunho); 55006 se houver emissão ou envio em andamento (migração `20261118090000`, aplicada e registrada em produção).
- [x] Edge Function `admin-excluir-obra` (v3 em produção): ação `excluir_boletim` apaga a mensagem no grupo (`deleteMessage`) e os PDFs/PNG do bucket `boletins`.
- [x] Relatórios: botão "Excluir" em cada boletim, com confirmação e aviso se a mensagem não puder ser apagada (limite de 48 h do Telegram). O agendador pode reemitir o dia de hoje.
- [ ] Usuário: testar a exclusão de um boletim no site.

## Mini app: aba Relatórios

- [x] Banco: RPC `listar_relatorios()` (etapas do usuário com o boletim/pedido de hoje e registros do dia; boletins emitidos), aplicada em produção.
- [x] Mini app: aba Relatórios na barra inferior: cartão "Hoje" por etapa, lista dos emitidos com Abrir PDF; admin: Emitir agora / Emitir revisão e Excluir (dia inteiro, com a mensagem no grupo).
- [ ] Usuário: testar a aba no Telegram (abrir PDF, emitir e excluir como admin).

## Mini app: versão na tela inicial

- [x] Etiqueta "v39 · 13/11" no canto direito da faixa de identidade, só na tela inicial: número do último PR (da mensagem do commit de merge, `VERCEL_GIT_COMMIT_MESSAGE`), dia do build; um toque mostra o commit curto e a data e hora. Sem PR na mensagem, mostra o commit curto.
- [x] Formato trocado para `vPR.aammdd.commit` (ex.: `v41.261113.abc1234`); o toque mostra "Publicada em dd/mm/aaaa hh:mm". Sem PR: `vdev`.
- [x] Faixa do topo reorganizada: OM à esquerda, logo (40 px) no centro, "Fiscal Bot" à direita; versão em todas as telas, no pé do topo azul, pequena, sem contorno e apagada.
- [x] Redesign "Farda" (conceito 1, revisão 2, aprovado pelo usuário): topo em uma linha só (brasão de 52 px, CO-FZ e Fiscal Bot à esquerda, título no centro, versão no canto); etapas e pavimentos como abas na base do topo, com o atalho Pendências à direita; cartões de obra com os 3 totais rotulados; títulos de seção com marcador amarelo; botões principais em maiúsculas.
- [ ] Usuário: conferir no Telegram o novo topo (Início, obra, ambiente, Registros, Relatórios) e a versão (número do PR desta entrega).

## Mini app: painel e exportação de pendências na aba Relatórios (contrato: `docs/contrato-relatorios-painel.md`)

- [x] Banco: RPCs `painel_relatorios` e `relatorio_pendencias` e bucket privado `relatorios` (migration `20261119100000_relatorios_painel.sql`, testes em `tests/db/test_relatorios_painel.py`).
- [x] Servidor: rota `api/relatorio-pendencias` gera o PDF com fotos (visual do boletim), grava em `relatorios/pendencias/<usuário>/` e devolve URL assinada de 10 min.
- [x] Tela: abas de etapa no topo, filtro de obra, cartões (serviços, pendências abertas, resolvidas), gráfico acumulado com toque, barras por obra, tabela e botão "Relatório de pendências (PDF)".
- [ ] Usuário: no Telegram, abrir Relatórios, conferir os números com o Início e exportar o PDF da etapa e de uma obra.
- [x] PDF de pendências com o mesmo cabeçalho do boletim diário (linhas da OM, obra/serviço, local, responsáveis; abrangência e posição à direita). Migration `20261120090000_relatorio_pendencias_cabecalho.sql` aplicada em produção e conferida (md5 e chamada como admin).
- [x] Câmera no Telegram Android: o WebView ignora `capture` do input e abria a galeria. No Android (`cameraNoApp()`), o botão Câmera abre `CameraFotos`, câmera em tela cheia por getUserMedia (várias fotos seguidas, "Concluir", erro com "Usar galeria"). iOS e navegador seguem com o input nativo. Falta testar em aparelho Android.
- [x] Acessos por lista (`docs/contrato-acessos.md`): tela `/acessos` "Acessos da equipe" (pessoas × obras, Sem acesso/Equipe/Gestor; qualquer gestor altera qualquer obra; admin do grupo fixo em Gestor). RPCs `matriz_acessos`/`definir_acesso`; `membro_grupo.admin`; `sincronizar_acesso` com `visto`. O `bot-webhook` registra quem fala, entra ou sai do grupo (`allowed_updates` com `chat_member`). "Solicitar acesso" continua. Bot já é admin do grupo TesteDev.
- [x] Controle de acesso (`docs/contrato-controle-acesso.md`): "Acessos da equipe" virou "Controle de acesso", botão embaixo de Administração (com selo de pedidos), para gestor ou admin. Sai o botão Gestão; as publicações com problema aparecem num aviso no cartão (`/obras/:slug/publicacoes`; `/gestao` redireciona). `definir_acesso('nenhum')` recusa o pedido pendente. Portal: aba Pessoas com uma coluna por obra. Migration `20261124090000_controle_acesso` aplicada. Falta: teste no Telegram e no portal; limpar hooks sem uso (`useParticipantes`, `useDefinirPapel`, `useRemoverParticipante`).
- [ ] Exclusão de etapa/obra: remover também os PDFs do bucket `relatorios`.

## Melhorias de 2026-11-18: dependências, erros do cliente e órfãos (contrato: `docs/contrato-erros-orfaos.md`)

- [x] `@vercel/functions` 3.11.3 (zera os 4 alertas altos do `npm audit`; restam 2 baixos via `@thatopen/components`, que exigem versão maior).
- [x] Parte A: tabela `erro_cliente`, RPCs, retenção de 90 dias, ErrorBoundary e captura global no Mini App e no admin, tela Manutenção → Erros.
- [x] Parte B: varredura diária de órfãos nos buckets (só simulação, nada é apagado) e aba Manutenção → Arquivos órfãos.
- [x] Migrations `20261125090000_erro_cliente.sql` e `20261125100000_orfaos_storage.sql` aplicadas no `miniappcofz-dev` em 2026-11-18 (md5 das 4 funções igual ao repositório; crons `limpar-erro-cliente` e `varrer-orfaos-storage` agendados; primeira varredura: 0 órfãos).
- [x] Tela Manutenção conferida no site admin pelo usuário (abas Erros e Arquivos órfãos).
- [x] E2E: testes da Gestão passam a usar o Controle de acesso (PR #57).
- [ ] Depois de conferir a lista de órfãos por alguns dias: remoção real por Edge Function (API do Storage), tratando envios de planta/modelo pendentes há mais de 7 dias.
- [ ] Backup e restauração do Postgres e do Storage (adiado pelo usuário).

## Arquitetura — Fase 0 (baseline)

- [x] Fase 0 de `docs/plano-arquitetura-organizacao.md` concluída: aliases `@shared`/`@modules`/`@apps` (tsconfig.app, herdado por tsconfig.testes-node; vite/vitest), pastas `src/shared/{kernel,infra,ui,test}`, `src/modules`, `src/apps/{miniapp,admin}`, fronteiras de lint em `warn` (validadas com arquivo violador temporário, removido) e smoke de alias.
- Baseline: typecheck, lint (0 warnings), build e build:fixture verdes; 856 testes em 101 arquivos (855 anteriores + 1 smoke).
- `precache-manifest.json`: 18 arquivos; `VisualizadorModelo`, `motor-3d`, `jsQR` e `conversor.worker` existem em `dist/assets` (4 chunks) e ficam fora do manifesto, como esperado.

## Arquitetura — Fase 3 (contexto `ra`)

- [x] Fase 3 concluída: `modules/ra/{domain,application,infra,presentation}`; porta + contract test (fixture e Supabase), telas em `presentation/{miniapp,admin}`. Padrão registrado em `docs/padrao-contexto-modulo.md`.
- Estado final: typecheck, eslint (0 avisos), build e build:fixture verdes; 862 testes em 103 arquivos; e2e `ra.spec.ts` 3/3; chunks lazy (`TelaRA`, `DiagnosticoRA`, `motor-3d`) inalterados.

## Arquitetura — Fase 4A (contexto `modelos`)

- [x] Fase 4A concluída: `modules/modelos/{domain,application,infra,presentation}`; telas em `presentation/{miniapp,admin}`.
- Estado final: typecheck, eslint (0 avisos), build e build:fixture verdes; 867 testes em 105 arquivos; e2e `modelo.spec.ts` e `admin-modelo.spec.ts` 5/5; `VisualizadorModelo`, `motor-3d`, `jsQR`, `conversor.worker` fora do precache (manifesto igual, exceto a versão).

## Arquitetura — Fase 4B (contexto `plantas`)

- [x] Fase 4B concluída: `modules/plantas/{domain,application,infra,presentation}`; telas em `presentation/{miniapp,admin}`.
- Estado final: 872 testes; `pdfjs-dist`/`pdf.worker` fora do bundle inicial e do precache.

## Arquitetura — Fase 5A (contexto `acessos`)

- [x] Fase 5A concluída: `modules/acessos/{domain,application,infra,presentation}`; 5 portas (`Acessos`, `AcessosAdmin`, `Sessao`, `SessaoAdmin`, `EquipeServico`), adaptadores Supabase e Fixture, telas em `presentation/{miniapp,admin}`.
- Estado final: typecheck, eslint (0 avisos), build e build:fixture verdes; 890 testes em 107 arquivos; e2e `acesso.spec.ts` e `admin.spec.ts` 6/6; chunks e precache idênticos aos de antes.
- Lacunas conhecidas: sem contract test de `SessaoAdminRepositorio` (coberto por `AdminApp.test`); `acessos-supabase.test.ts` segue em `dados/`; `NomeExibicao.test.tsx` fica em `telas/` (cruza contextos).
- Próximo: 5B (`obras`).

## Arquitetura — Fase 5B (contexto `obras`)

- [x] Parte 1 (lado Mini App): `modules/obras/{domain,application/ports,infra}`; portas `Obras`, `Organizacao`, `EtapasInicio`; adaptadores Supabase e Fixture (estado injetado); `util/etapas.ts` virou `domain/etapas.ts` (puro) + `presentation/miniapp/useEtapaGuardada.ts`.
- Estado: typecheck, eslint (0 avisos), build e build:fixture verdes; 898 testes (890 + 8 de contrato).
- Lacunas: sem contract test contra Supabase (mock já coberto por `dados/etapas-supabase.test.ts`); `Marcador` e `RecortePt` ficam em `dados/tipos.ts` (usados por `shared/kernel/coordenadas` e plantas).
- [x] Parte 2 (lado admin): portas `EtapasAdmin`, `OrganizacaoAdmin`, `ObrasAdmin` + contratos (`ObrasAdminFixture.contract.test.ts`); adaptadores Supabase e Fixture em `modules/obras/infra`; tipos admin em `domain/tiposAdmin.ts`; `RepositorioAdmin` compõe as portas.
- Estado: typecheck, eslint (0 avisos), build e build:fixture verdes; 913 testes em 109 arquivos (898 + 15 de contrato).
- Lacunas: constantes e `ErroAdmin` seguem em `admin/dados/tipos.ts` (adaptadores importam de lá); `fixtureBoletim.ts` (helpers de campos da etapa) segue em `admin/dados` até a 5D; boletins da fixture limpos via callback `aoExcluirEtapa`.
- [x] Parte 3 (telas e `hooks.ts`): telas admin (`ObrasAdmin`, `ObraAdmin`, `Organizacao`, `ArquivarExcluir`, `EtapaAdmin`, `FormularioEtapa`, `MapaEscolha`, `Aditivos`, `Responsaveis`, `ArquivarExcluirEtapa` + testes) e hooks admin movidos para `modules/obras/presentation/admin/`; telas miniapp (`Obras`, `Obra`, `Ambiente` + 5 arquivos de teste) movidas para `modules/obras/presentation/miniapp/`. `Registros.tsx` fica para a 5C (depende de `fiscalizacao`).
- Estado final da 5B: typecheck, eslint (0 avisos), build e build:fixture verdes; 913 testes em 109 arquivos; e2e `navegacao`, `etapas`, `admin-obra`, `admin-etapas` 16/16; chunks (`MapaEscolha` lazy incluído) e `precache-manifest.json` idênticos aos de antes.

## Arquitetura — Fase 5C (contexto `fiscalizacao`)

- [x] Parte 1 (domínio, portas, use-case e adaptadores): `modules/fiscalizacao/{domain/tipos.ts, application/ports/{RegistrosRepositorio,PublicacoesRepositorio}, application/use-cases/envio.ts, infra/{RegistrosSupabaseAdapter,PublicacoesSupabaseAdapter,RegistrosFixtureAdapter,PublicacoesFixtureAdapter}}`; `FiscalizacaoFixture.contract.test.ts` (+9 testes de contrato).
- [x] Parte 2 (telas e componentes): `NovoRegistro`, `Pendencias`, `PendenciaDetalhe`, `Publicacoes`, `Registros`, `CartaoPendencia`, `ListaRegistros`, `MiniaturaRegistro` e testes movidos para `modules/fiscalizacao/presentation/miniapp/`.
- Estado final da 5C: typecheck, eslint (0 avisos), build e build:fixture verdes; 922 testes em 110 arquivos; e2e `novo-registro` e `pendencias` 10/10; chunks e `precache-manifest.json` inalterados.

## Arquitetura — Fase 5D (contexto `relatorios`)

- [x] Parte 1 (domínio, portas, adaptadores e `camposEtapa`): `modules/relatorios/{domain/{tipos,tiposAdmin,painel}, application/ports/{RelatoriosRepositorio,ObservacoesRepositorio,BoletinsAdminRepositorio}, infra/*}`; `admin/dados/fixtureBoletim.ts` movido para `modules/obras/infra/camposEtapa.ts`; `util/periodo.ts` (+ `dataValida`/`somarDias`) movido para `shared/kernel/periodo.ts`; contract tests (+9 testes).
- [x] Parte 2 (telas, componentes e hooks): `Relatorios`, `PainelRelatorios`, `GraficoAcumulado`, `GraficoPorObra`, `CartaoObservacoes` (+ testes) movidos para `modules/relatorios/presentation/miniapp/`; `Boletins`, `EditorBoletim`, `EmitirOuPrever`, `Tabelas`, `util` (+ testes) e hooks admin movidos para `modules/relatorios/presentation/admin/`.
- Estado final da 5D: typecheck, eslint (0 avisos), build e build:fixture verdes; 931 testes em 112 arquivos; e2e `observacoes` e `admin-etapas` 5/5; chunks e `precache-manifest.json` inalterados.

## Arquitetura — Fase 5E (contexto `operacao`)

- [x] Telemetria e manutenção: `modules/operacao/{domain/tipos.ts, application/ports/TelemetriaRepositorio.{port,contract}.ts, infra/Telemetria{Supabase,Fixture}Adapter.ts, presentation/admin/{Erros.tsx,hooks.ts}}`; `OperacaoFixture.contract.test.ts` (+2 testes).
- [x] Offline: `offline/{armazenamento,cacheConsultas}` → `modules/operacao/infra/indexeddb/`; `offline/fila` → `modules/operacao/application/use-cases/`; `offline/contexto` e `components/{BarraSincronizacao,RegistroLocal}` → `modules/operacao/presentation/miniapp/`.
- Estado final da 5E: typecheck, eslint (0 avisos), build e build:fixture verdes; 933 testes em 113 arquivos; e2e `offline`, `sw` e `admin` 8/8; fachadas `Repositorio` e `RepositorioAdmin` 100% compostas por portas.

## Arquitetura — Fase 6 (fechamento)

- [x] Composition Roots movidos para `apps/miniapp/{App,App.test,main}` e `apps/admin/{AdminApp,AdminApp.test,main,admin.css}`; `index.html` e `admin.html` atualizados.
- [x] `Marcador` e `RecortePt` movidos de `dados/tipos.ts` para `shared/kernel/tipos.ts`; `util/util.test.ts` movido para `shared/kernel/util.test.ts`.
- [x] Todos os 31 shims de re-export da Fase 2 removidos (`components/*`, `util/*`, `telegram*.ts`, `registrarSw.ts`); pasta `util/` removida.
- [x] Regras de fronteira `no-restricted-imports` promovidas de `warn` para `error` em `app/eslint.config.js`.
- Estado final da Fase 6: typecheck, eslint (0 erros/avisos com fronteiras em `error`), build e build:fixture verdes; 933 testes em 113 arquivos; suíte E2E completa 48/48; `precache-manifest.json` inalterado (19 arquivos, nenhum chunk do Admin).

## Central de modelos (admin › Modelos)

Plano: `tasks/plano-central-modelos.md`; contrato: `docs/contrato-central-modelos.md`. Branch `feature/admin-central-modelos`, PR único ao fim.

- [x] Decisões fechadas com o usuário (2026-11-20).
- [x] 0 Spike: R1 resolvido (`.frag` traz psets, espacial e GlobalId); minimapa próprio; chunk medido na etapa 2
- [x] 1 Página, tema e casca (migration `admin_central_obras` ainda não aplicada)
- [x] 2 Motor 3D e navegação (e2e `central-modelos.spec.ts` verde; `admin-modelo.spec.ts` volta na etapa 5)
- [x] 3 Inspeção (propriedades por grupos, modo Inspecionar, filtro por atributo direto na sub-aba Filtro; psets no filtro ficam para depois; os .frag da HTO não trazem quantidades)
- [x] 4 Cortes, vistas e medições
  - [x] 4A vistas (planta por pavimento, elevações N/S/L/O, 3D), cortes horizontais com lista e Del, caminhar, minimapa; e2e verde (4.5 min). Em aberto: orientação das elevações não conferida (supõe norte do projeto), corte sem preenchimento de seção, desenho do minimapa não conferido
  - [x] 4B medições (distância, área, volume, ângulo; components-front), painel Medições com lista, apagar e Del/Esc; e2e verde (6,4 min, timeout 480 s). Em aberto: duplo clique para concluir área pode duplicar o último ponto
  - [x] 4C visual: 34 ícones SVG (barra, submenu Medir, trilho, visibilidade, modo), paleta Canteiro nos dois temas (azul-escuro + amarelo; seleção 3D amarela), polimento pelas diretrizes do impeccable (estados, foco, campos, flutuantes, scrollbar, tabular-nums), menus fecham com Esc/clique fora (Medir fica aberto com modo ativo), gaveta < 1024 px acima dos flutuantes. e2e verde (5,4 min). Em aberto: menus Cor/Medir podem ser cortados com a barra rolando < 1024 px; cabeçalho do admin quebra em 820 px (fora da central)
- [x] 5 Gestão de modelos: painel Gestão (enviar IFC/.frag, converter, publicar, retirar, histórico) no lugar de `ModelosObra.tsx` (removido); após publicar/retirar a cena recarrega só a disciplina (obra vazia remonta o motor). Nomes das ferramentas só como dica no hover/foco (`Dica.tsx`), trilho de 56 px. e2e `admin-modelo` reescrito e verde junto com `central-modelos` (5,2 min). Em aberto: na fixture o visualizador lê o manifesto estático, então a publicação não muda a cena no e2e (coberto no teste de componente)
  - Decisão (2026-11-20): não integrar o open-pdf-studio agora (app Tauri/SolidJS sem pacote npm, LGPL com MuPDF AGPL a esclarecer, projeto novo de um mantenedor, quantitativos manuais). Etapa 6 segue com `pdfjs-dist`; medição calibrada e contagem sobre prancha viram etapa própria depois; reavaliar a ferramenta quando amadurecer
- [x] 6 Documentos (2026-11-21)
  - Migration `20261127090000_documentos.sql` (tabelas `documento` e `documento_vinculo`, bucket privado `documentos` de 100 MB, RPCs listar/histórico/registrar/retirar/vincular, `admin_central_obras` contando documentos). **Não aplicada**: vai junto com `admin_central_obras` na etapa 8
  - Módulo `modules/documentos` (domínio com validações, porta com contract test, adaptadores Supabase e fixture com semente PDF + DWG na HTO, caso de uso `enviarDocumento`)
  - Painel Documentos: lista por disciplina, busca, filtro por tipo, envio novo/nova revisão (copia vínculos), download, retirar, histórico; prévia de PDF (pdf.js) sobre o 3D com página e zoom, em `?doc=`
  - Vínculos a pavimento e elementos da seleção; "Documentos deste elemento/pavimento" no contexto; vínculos órfãos na Gestão (`MotorVisualizador.existem`)
  - e2e `central-modelos` cobre vincular, contexto e prévia; suíte completa verde (1061)
  - Em aberto: se copiar os vínculos falhar depois de registrar a revisão, o reenvio dá "revisão já existe" (tratar com mensagem própria)
- [x] 7 Issues e BCF (2026-11-22; decisões: só no site admin; PR próprio com a migration aplicada em produção)
  - Banco: migration `20261129090000_issues.sql` (tabelas `issue`, `issue_vista`, `issue_comentario`; RPCs listar/salvar/comentar/salvar vista/importar BCF; pasta `issues` no R2, PNG até 5 MB, na exclusão de obra e na varredura de órfãos; `admin_central_obras` conta abertas + em andamento). `admin-excluir-obra` remove a pasta `issues`
  - App: módulo `modules/issues` (domínio, porta, fixture com 3 issues na HTO, Supabase, `criarIssueComVista`/`adicionarVista`, hooks); motor com `vistaAtual`/`aplicarVista` (câmera com zoom da ortográfica, cortes, ocultos, isolados, seleção), `capturar` (PNG ≤ 1600 px), `marcadores` (pinos HTML, clique abre a issue) e `origemCena`
  - Painel Issues: lista com filtro e busca, nova issue a partir da vista com miniatura, detalhe editável, vistas com "Restaurar vista", comentários, `?issue=N`, botão de marcadores na barra
  - BCF 2.1/3.0 próprio (`fflate` + DOMParser; o `BCFTopics` exige WebGL): eixos Y-up↔Z-up + origem do modelo-base; a direção exportada guarda a distância até o alvo; campos sem equivalente vão para a descrição com `[BCF]`; reimportar atualiza sem duplicar; snapshots JPEG viram PNG
  - Em aberto: a vista não guarda as cores por categoria/disciplina (modo global do motor) — resolvido na etapa 8 (`modoCor`)
  - Produção (2026-11-22): migration aplicada pela API e registrada (RLS nas 3 tabelas, RPCs só para `authenticated`, pasta `issues` no check e nos limites); `admin-excluir-obra` v8 (CORS ok, 401 sem token); PR #64 em `main` (f29e687), deploy READY. Suítes: vitest 1191, e2e 51 (tempo-limite do teste longo da central em 15 min: já levava ~7,5 min antes da etapa), banco 801, functions 198
  - Usuário: testar no site criar uma issue a partir da vista, restaurar, comentar e exportar/importar BCF
- [x] 8 Fechamento (2026-11-22; decisões: entram todas as correções e recursos pendentes; contrato sem `testar:central`; elevações pelo norte do projeto)
  - Correções: botão Captura baixa o PNG da vista; duplo clique em área/volume não repete o último ponto; menus Cor/Medir fixos abaixo de 1024 px e cabeçalho do admin em duas linhas entre 641 e 1023 px; cópia de vínculos que falha depois de registrar a revisão tem mensagem própria, "Tentar copiar de novo" e "Concluir sem vínculos"
  - Recursos: vistas guardam `modoCor` (e aplicam `cores` explícitas do BCF, que agora importa/exporta `Coloring`); filtro por propriedade de pset (`IsDefinedBy` → `HasProperties`, nome e valor na mesma propriedade; conferido na HTO: `Pset_QuantityTakeOff.Reference` 6059 = 94 iguais + 5965 diferentes); corte com preenchimento (`ClipStyler`, só elementos construtivos: o That Open gera a seção num buffer fixo de 100 mil segmentos)
  - Planta: corte a 1,20 m do piso (antes 0,25 m caía na face da laje e a planta saía quase vazia), profundidade 1,5 m
  - Conferências na HTO: norte verdadeiro do ARQ (-0,75; -0,66), ~131° do +Y; elevações e dicas seguem o norte do projeto (decisão do usuário). Minimapa com norte do projeto para cima, sem espelhamento
  - Testes e docs: `DocumentosSupabaseAdapter.test.ts`, `tests/db/test_documentos.py` (RLS de `documento`/`documento_vinculo`, RPCs, `admin_central_obras`); seção "Central de modelos" em `docs/admin.md`; contrato §3.1 (`modoCor`, `cores`) e §7 (testes de banco no lugar do script)
  - Produção: sem migration nova; conferido pela API que todas as migrations desde 20261115 estão registradas com a mesma versão, RLS ligada em todas as tabelas de `public`, RPCs da Central sem execute para `anon`
  - Suítes: vitest 1212, banco 811, e2e 51 (12,7 min); typecheck, lint, `build` e `build:fixture` verdes; precache sem chunks do visualizador
  - Em aberto: plantas mostram as paredes cortadas sem o preenchimento (o dos cortes do usuário funciona); seta do minimapa não conferida com a câmera dentro do mapa; tempo do preenchimento só medido com WebGL por software
  - PR #65 em `main` (c9757c6), deploy de produção READY
  - Usuário: testar no site Captura, cores numa vista salva, filtro por pset, corte e planta

## Arquivos no Cloudflare R2 (plano: `tasks/plano-r2.md`)

- [x] Acesso conferido (2026-11-22): token de conta ativo, listagem pela API e pelo endpoint S3 funcionando; conta sem buckets
- [x] Decisões: tudo no R2; permissão pela Edge Function `armazenamento`; logo por URL assinada
- [x] Decisões do plano fechadas (2026-11-22): Vercel assina direto; buckets `miniappcofz-arquivos`/`-dev`; links 10 min/1 h/7 dias; `relatorios` sem limite próprio; pendentes apagados após 7 dias; backup semanal no Google Drive
- [x] Contrato `docs/contrato-r2.md` (2026-11-22); `documentos` nasce direto no R2
- [x] 0 Cloudflare (2026-11-22): buckets `miniappcofz-arquivos` e `miniappcofz-arquivos-dev` criados (ENAM); CORS GET/PUT/HEAD para `https://miniappcofz.vercel.app`, `https://miniappcofz-*.vercel.app` (o R2 aceita curinga) e `http://localhost:5173` (só dev); teste no dev: PUT/HEAD/GET/DELETE assinados ok, PUT com tamanho diferente do assinado recusado (403), sem assinatura recusado, preflight de origem alheia recusado
- [x] 1 Banco e permissões (2026-11-22, commits aa6196d e 5a9760d; não aplicada em produção): tabela `arquivo`, `pode_arquivo`, RPCs, funções trocadas, `documentos` sem Storage; suíte de banco 794 ok — pré-condição conferida: `admin_central_obras` e `documentos` não aplicadas (última aplicada: `20261125100000`)
- [x] 2 Function `armazenamento` (2026-11-22, commit 050cf36 + revisão; não publicada): `_shared/r2.ts`, handler com 5 ações, job `manutencao-arquivos` (04:41 UTC, Vault `url_projeto`/`segredo_interno`); deno 199 ok; `r2.ts` testado de verdade no bucket de dev (PUT/HEAD/GET/listar/apagar; tamanho ou tipo diferente do assinado → 403)
- [x] 3 App (2026-11-22, commits 850fc82, d119b51, 7bffcd1): módulo `armazenamento` (porta, fake, adapter real com cache e logo em localStorage) e todos os adapters trocados; nenhum `supabase.storage` em `app/src`; suíte 1074 ok, tsc e lint limpos. **Falta** o fluxo real em prévia: só dá para testar na virada (a function precisa da migration, e o único projeto Supabase é a produção). Logo antigo não é apagado pelo app (nem era antes); a varredura de órfãos o aponta
- [x] 4 Servidores, órfãos e script
  - 4a: `publish-outbox` baixa fotos e PDF do R2; `admin-excluir-obra` apaga no R2 as linhas `excluir` (falha fica para a `manutencao`); `assinar-envio-plantas` removida do código (falta apagar a publicada, na virada).
  - 4b: `app/servidor/_compartilhado/r2.ts` (cópia do `_shared/r2.ts`, só o import muda; teste compara) e `aws4fetch@1.0.20`; boletim e relatório gravam, registram (`arquivo_registrar_servico`) e assinam pelo R2. Variáveis `R2_*` na Vercel (docs/admin.md).
  - 4c: `publicar_plantas.py` e `publicar_modelos.mjs` enviam pela `armazenamento` (interno: enviar → PUT → confirmar); `SEGREDO_INTERNO` opcional, senão vem da RPC `segredo_interno`. `testar_modelos_supabase.mjs` removido.
  - Testes: functions 198, app 1089, scripts 42 (falha à parte: `pymupdf` ausente no ambiente). Grep do Storage vazio.
- [x] 5 Testes, documentação, backup e produção (criar antes o token restrito do app)
  - [x] 5a (repositório): migration `20261128090000_remover_storage.sql` (20 políticas; aplicar só depois da conferência), `.github/workflows/backup-r2.yml` (domingo 03:47, rclone copy), docs (admin, órfãos, ROADMAP, arquitetura), `scripts/README.md` (backup e restauração). Banco 785 testes.
  - [x] 5b (produção, com o usuário): tokens restritos (app e backup só leitura), segredos (functions, Vercel prod/prévia, GitHub), virada na janela, conferência, migration de remoção, apagar buckets e `assinar-envio-plantas` publicada, primeiro backup. Roteiro: `tasks/virada-r2.md` (o usuário decidiu dar à sessão acesso à Cloudflare e à Vercel para cadastrar o token do app).
    - Etapa A (2026-11-22): token `miniappcofz-app` (Object Read & Write só nos dois buckets; Access Key = id, Secret = SHA-256 do valor), conferido por S3 assinado (listar/PUT/HEAD/DELETE ok; ListBuckets e outro bucket 403); segredos `R2_*` nas functions e na Vercel (sensíveis em prod/prévia; `R2_BUCKET` `-dev` na prévia).
    - Janela (2026-11-22): 4 migrations aplicadas e registradas; `armazenamento` v1, `publish-outbox` v9, `admin-excluir-obra` v7 publicadas, `assinar-envio-plantas` apagada; CORS ok e 401 sem token; PR #62 em `main` (469c7fb), deploy READY.
    - Conferência: plantas hto (91) e cofz (21) e modelo ARQ do hto reenviados por script; prévia (PDF), relatório (no R2), emissão na etapa `teste` com sigla provisória (PDF no R2, depois excluído pela `admin-excluir-obra` e sigla desfeita), obra `virada-r2-teste` criada e excluída; registro com foto do usuário publicado no Telegram (msg 88); logs sem erro.
    - Cópia do Storage para o R2 (decisão do usuário): o banco ainda apontava para 80 objetos só no Storage (9 boletins, fotos, modelos, original, logo, relatórios); copiados com os mesmos caminhos e registrados em `arquivo` como confirmados. Toda referência do banco tem arquivo no R2; R2 = `arquivo` (195 objetos, 54 MB).
    - `20261128090000_remover_storage.sql` aplicada (0 políticas em `storage.objects`); 7 buckets do Storage esvaziados e apagados.
    - Primeiro backup (2026-11-22): token `miniappcofz-backup` (Object Read only em `miniappcofz-arquivos`) e os quatro segredos cadastrados pelo usuário; o `[drive]` usa cliente OAuth próprio, publicado "Em produção", com escopo `drive.file` (o client id compartilhado do rclone está sendo desativado). Run 44984063991 concluída com sucesso em 1 min 44 s. Permissão *Account API Tokens: Edit* removida do token da sessão (conferido: 9109); `[drive]` local apagado; logo conferido no `/admin/` e no relatório.
