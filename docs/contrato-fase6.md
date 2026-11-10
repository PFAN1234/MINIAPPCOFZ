# Fase 6 — contrato do bot, do acesso e da publicação no tópico

Especificação para implementar a fase 6 (`tasks/plano-app.md`, seção 6). Projeto Supabase de desenvolvimento: `miniappcofz-dev` (ref `nyfcualazkngqmrxcczh`). Grupo de teste: **TesteDev** (supergrupo com tópicos, tópico **HTO**, bot `@diarioobra_cofz_bot` como administrador). Mini App: `https://t.me/diarioobra_cofz_bot/fiscalcofz` (título "FISCAL COFZ"), apontando para `https://miniappcofz.vercel.app`.

Decisões (2026-11-10):
- **Acesso "Grupo + aprovação".** Administrador do grupo vinculado à obra entra como **gestor** automaticamente. Membro comum do grupo vê "Solicitar acesso", e um gestor aprova no app. Quem sai do grupo (ou é removido) perde o acesso no próximo login.
- **Segredos.** O token do bot fica só nos segredos das Edge Functions (`TELEGRAM_BOT_TOKEN`), cadastrado pelo usuário no painel do Supabase. O segredo interno (cron → função, SQL → configuração do bot, webhook do Telegram) é gerado **dentro do banco** no Vault e lido pelas funções por RPC restrita à service role. Nenhum segredo passa pelo Git, pelo cliente ou pela conversa.
- A publicação nunca apaga nem altera o registro. Falha no Telegram só muda o estado em `publicacao_telegram`.

## A. Banco (uma migration nova: `supabase/migrations/20261110120000_fase6_acesso_publicacao.sql`)

Mesmos princípios da fase 2: funções `security definer` com `set search_path = ''` e nomes qualificados; erros em português com os `errcode` da fase 2 (`28000`, `42501`, `P0002`, `23505`, `22023`).

### A.1 Tabelas e colunas
- `privado.membro_grupo (obra_id uuid → public.obra on delete cascade, usuario_id uuid → public.usuario on delete cascade, conferido_em timestamptz not null default now(), primary key (obra_id, usuario_id))`. Sem grants para `anon`/`authenticated`.
- `public.solicitacao_acesso` ganha `notificada_em timestamptz null` (aviso do pedido no tópico).
- Remover a política `solicitacao_acesso_insert` e o `insert` de `authenticated` em `solicitacao_acesso`. Pedidos passam a entrar só pela RPC `solicitar_acesso`.

### A.2 RPCs para `authenticated`
- `obras_disponiveis() returns table (id uuid, slug text, nome text, solicitacao text)`: obras em que o usuário tem `membro_grupo` conferido nos últimos 7 dias e **não** tem `participacao`. `solicitacao` é o estado do pedido mais recente (`'pendente'`, `'recusada'` ou `null`). Ordem: `ordem`, `nome`.
- `solicitar_acesso(p_obra uuid) returns public.solicitacao_acesso`:
  - sem `membro_grupo` recente: `42501`, "Entre no grupo da obra no Telegram para pedir acesso.";
  - já participa: `23505`, "Você já tem acesso a esta obra.";
  - pedido pendente existente: devolve-o (idempotente);
  - pedido recusado há menos de 24 h: `22023`, "Pedido recusado recentemente. Fale com o gestor da obra.";
  - caso contrário, insere com `estado = 'pendente'`.
- `listar_solicitacoes(p_obra uuid) returns table (id uuid, usuario_id uuid, nome text, username text, criado_em timestamptz)`: só gestor da obra (`42501`); pedidos pendentes, do mais antigo para o mais novo.
- `decidir_solicitacao(p_id uuid, p_aprovar boolean) returns public.solicitacao_acesso`:
  - `select ... for update`; inexistente: `P0002`; chamador precisa ser gestor da obra (`42501`);
  - já decidido com o mesmo resultado: devolve (idempotente); com resultado diferente: `23505`, "Pedido já decidido.";
  - grava `estado`, `decidido_por = auth.uid()`, `decidido_em = now()`; se aprovado, insere `participacao` com papel `equipe` (`on conflict do nothing`).

### A.3 RPCs só para `service_role` (`revoke execute ... from public, anon, authenticated`)
- `segredo_interno() returns text`: `decrypted_secret` de `vault.decrypted_secrets` com `name = 'segredo_interno'` (ou `null`).
- `sincronizar_acesso(p_usuario uuid, p_itens jsonb) returns void`. `p_itens` é uma lista de `{obra_id, situacao}`, com `situacao` em `admin`, `membro` ou `fora`:
  - `admin`: upsert de `membro_grupo`, mais upsert de `participacao` com papel `gestor` (promove `equipe` a `gestor`);
  - `membro`: upsert de `membro_grupo` (não cria participação nem rebaixa um gestor);
  - `fora`: apaga a `participacao` e o `membro_grupo` e marca os pedidos pendentes como `recusada`, com `decidido_por` nulo.
- `vincular_obra(p_slug text, p_chat bigint, p_thread bigint) returns public.obra`: atualiza `telegram_chat_id` e `telegram_thread_id`. Devolve `null` se a obra não existe. Também reagenda (`proxima_tentativa_em = now()`) as publicações `pendente` da obra.
- `reivindicar_publicacoes(p_limite int default 10) returns setof public.publicacao_telegram`:
  1. publicações em `enviando` com `atualizado_em` de mais de 10 min passam a `incerto`, com `erro = 'Envio interrompido; conferir no tópico.'`;
  2. pega até `p_limite` publicações `pendente` com `proxima_tentativa_em <= now()`, ordenadas por `id`, com `for update skip locked`;
  3. marca essas publicações como `enviando`, com `tentativas + 1` e `atualizado_em = now()`, e devolve as linhas.
- `finalizar_publicacao(p_id bigint, p_estado text, p_message_ids bigint[], p_erro text, p_proxima timestamptz) returns void`: só altera linhas em `enviando`. `p_estado` é `publicado`, `pendente`, `incerto` ou `falhou`. Grava `message_ids`, `erro` (limitado a 500 caracteres), `proxima_tentativa_em = coalesce(p_proxima, now())` e `atualizado_em`.

### A.4 Disparo (pg_cron + pg_net)
- Extensões `pg_cron` e `pg_net`, criadas só se disponíveis (o PostgreSQL puro dos testes não as tem; ver A.5).
- `privado.disparar_publicacao() returns void`: lê no Vault `url_projeto` e `segredo_interno`. Se faltar algum, retorna sem fazer nada. Senão, faz `net.http_post(url := url_projeto || '/functions/v1/publish-outbox', headers := {Content-Type: application/json, x-segredo-interno: <segredo>}, body := '{}', timeout_milliseconds := 55000)`.
- Cron `publicar-telegram`, a cada minuto: `select privado.disparar_publicacao()`. Usar `cron.schedule` de forma idempotente (desagendar antes, se existir).
- Gatilho `after insert ... for each statement` em `publicacao_telegram` e em `solicitacao_acesso` chama `privado.disparar_publicacao()`, para publicar em segundos e não esperar o minuto.
- Os segredos do Vault **não** ficam na migration. São criados uma vez no projeto pelo SQL abaixo, executado pelo assistente:
  - `select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'segredo_interno')`;
  - `select vault.create_secret('https://nyfcualazkngqmrxcczh.supabase.co', 'url_projeto')`.

### A.5 Testes de banco (`tests/db`)
- `stub_supabase.sql` ganha stubs mínimos:
  - `vault.decrypted_secrets` (tabela `name`, `decrypted_secret`);
  - `cron.schedule` / `cron.unschedule`, que gravam numa tabela;
  - `net.http_post`, que grava os pedidos numa tabela, para os testes conferirem.
- Casos:
  - `obras_disponiveis` e `solicitar_acesso`: sem membro recente, já participa, pedido pendente idempotente, recusado há menos de 24 h;
  - `decidir_solicitacao`: não gestor, aprovação cria `equipe`, idempotência, conflito;
  - `sincronizar_acesso`: admin promove, membro não rebaixa, fora remove;
  - `reivindicar_publicacoes`: skip locked e `enviando` antigo vira `incerto`;
  - `finalizar_publicacao` ignora linha fora de `enviando`;
  - funções de service role negadas a `authenticated`;
  - gatilho enfileira `net.http_post` só quando os segredos existem.

## B. Edge Functions (`supabase/functions/`)

Todas com `verify_jwt = false` em `supabase/config.toml`. Lógica em `handler.ts`, com dependências injetadas (`fetch` do Telegram, cliente Supabase e relógio), e `index.ts` fino, como na `auth-telegram`. Testes Deno sem rede. Código compartilhado em `_shared/`:
- `telegram.ts`: chamada à Bot API com timeout de 30 s, com o resultado classificado em `ok`, `http` (status, `description`, `retry_after`) ou `rede`. O token nunca aparece em logs nem em erros.
- `segredo.ts`: obtém o segredo interno pela RPC `segredo_interno`, com cache em memória de 5 min. Também deriva o `secret_token` do webhook: `hex(HMAC_SHA256(key = segredo_interno, msg = "telegram-webhook"))`. Comparações em tempo constante.

Variáveis: `TELEGRAM_BOT_TOKEN` (segredo), `TELEGRAM_BOT_USERNAME=diarioobra_cofz_bot`, `TELEGRAM_APP_NAME=fiscalcofz`, `ALLOWED_ORIGINS=https://miniappcofz.vercel.app`, além de `SUPABASE_URL` e `SUPABASE_SECRET_KEY`/`SUPABASE_SERVICE_ROLE_KEY`, injetadas pelo Supabase. Link do app: `https://t.me/<BOT_USERNAME>/<APP_NAME>`, mais `?startapp=<param>` quando houver.

### B.1 `auth-telegram` (alteração)
Depois do upsert de `usuario` e antes de gerar a sessão, sincroniza o acesso:
- Lista as obras com `telegram_chat_id` não nulo.
- Para cada uma, em paralelo, chama `getChatMember(chat_id, user_id)`, com timeout de 5 s, e converte o status:
  - `creator` ou `administrator` → `admin`;
  - `member` → `membro`;
  - `restricted` → `membro` se `is_member`, senão `fora`;
  - `left` ou `kicked` → `fora`;
  - qualquer erro: pula a obra, sem mudar nada.
- Chama `sincronizar_acesso`.
- Falha na sincronização não impede o login; só fica no log, sem dados pessoais.

### B.2 `bot-webhook` (nova)
- Ação de configuração (`POST` com cabeçalho `x-segredo-interno` válido e corpo `{"acao":"configurar"}`):
  - `setWebhook` com `url = SUPABASE_URL + '/functions/v1/bot-webhook'`, `secret_token` derivado e `allowed_updates: ["message"]`;
  - `setMyCommands` em dois escopos:
    - `all_private_chats`: `start`;
    - `all_chat_administrators`: `vincular_obra` e `fixar_botao`.
  - Devolve o resultado sem o token.
- Update do Telegram:
  - exige o cabeçalho `X-Telegram-Bot-Api-Secret-Token` igual ao derivado; senão, responde `401`;
  - depois disso, responde sempre `200` (erros internos só no log), para o Telegram não reenviar em laço;
  - trata só `message` com `text` que começa com `/`. O comando aceita `/cmd` ou `/cmd@<BOT_USERNAME>`; menção a outro bot é ignorada, assim como mensagens de bots.
- `/start` (só em chat privado): explica o app e manda o botão de URL "Abrir Diário da obra" com o link do app.
- `/vincular_obra <slug>`:
  - exige supergrupo com tópicos (`chat.is_forum`) e mensagem dentro de um tópico (`is_topic_message` e `message_thread_id`);
  - exige que o remetente seja administrador: `getChatMember` com status `creator` ou `administrator`, ou `sender_chat.id === chat.id` (admin anônimo);
  - chama `vincular_obra`;
  - responde no tópico:
    - sucesso: "Tópico vinculado à obra <nome>. Os registros do Diário da obra serão publicados aqui.";
    - "Use este comando dentro do tópico da obra.";
    - "Só administradores do grupo podem vincular a obra.";
    - "Obra “<slug>” não encontrada.";
    - "Uso: /vincular_obra <slug> (ex.: /vincular_obra hto)".
- `/fixar_botao` (só administrador, em qualquer tópico):
  - envia no mesmo tópico "📋 <b>Diário da obra</b>\nToque no botão para registrar serviços e pendências da obra." com o botão de URL "Abrir Diário da obra";
  - fixa a mensagem com `pinChatMessage` e `disable_notification: true`;
  - se faltar permissão, responde "Preciso da permissão de fixar mensagens.".

### B.3 `publish-outbox` (nova)
- Exige o cabeçalho `x-segredo-interno` válido; senão, responde `401`.
- Uma rodada:
  1. `reivindicar_publicacoes(10)` e processa uma a uma, em sequência.
  2. Avisa até 5 pedidos de acesso: pendentes, com `notificada_em` nulo e obra vinculada.
  3. Devolve um resumo em JSON com as contagens.
- **Montagem da publicação de registro.** Lê com a service role:
  - registro, ambiente (`nome_operacional`), pavimento (`nome`), obra (`nome`, chat e tópico) e autor (`nome`);
  - fotos por `ordem`, baixadas de `fotos/<storage_path>`.

  Legenda em HTML (`parse_mode: "HTML"`, com `&`, `<` e `>` escapados):
  ```
  🔧 <b>Serviço</b> · Apto. 101          (pendência: ⚠️ <b>Pendência</b>)
  HTO · Térreo
  <legenda>
  👤 Fulano · 10/11 14:32               (capturado_em em America/Sao_Paulo)
  <a href="<link do app>?startapp=registro_<id>">Abrir no Diário da obra</a>
  ```
  O texto visível fica com no máximo 1024 caracteres. Se passar, a legenda é cortada com "…".
- **Publicação de encerramento.** Mesma montagem, com "✅ <b>Pendência resolvida</b> · <ambiente>", a observação (se houver), o gestor e `encerrado_em`. O link `startapp` aponta para o registro da pendência. Usa `reply_parameters = {message_id: <primeiro message_id da publicação publicada da pendência>, allow_sending_without_reply: true}` quando ele existir.
- **Envio.** Uma foto vai por `sendPhoto`; de 2 a 10 vão por `sendMediaGroup`, com `attach://f<i>` e a legenda na primeira. Os dois usam multipart, `chat_id` e `message_thread_id`. Guarda todos os `message_id` devolvidos.
- **Resultado** (via `finalizar_publicacao`):

  | Situação | Estado | Próxima tentativa |
  | --- | --- | --- |
  | sucesso | `publicado` | — |
  | obra sem chat/tópico | `pendente`, erro "Obra sem tópico vinculado." | +15 min |
  | falha ao baixar foto do Storage | `pendente` | backoff |
  | `429` | `pendente` | `retry_after` |
  | `400`/`403` do Telegram | `pendente` até 8 tentativas, depois `falhou`; erro = `description` | backoff |
  | erro de rede/timeout ou `5xx` (pode ter sido publicado) | `incerto`, sem repetição automática | — |

  O backoff é `min(2^(tentativas-1), 60)` minutos.
- **Aviso de pedido de acesso** (`sendMessage` no tópico): "🔑 <b><nome></b> (@username, se houver) pediu acesso ao Diário da obra.\nGestores: <a href=\"<link>?startapp=acessos_<slug>\">ver pedidos</a>". Se der certo, grava `notificada_em`; se der errado, tenta de novo na próxima rodada.

## C. App (`app/`)

### C.1 Login real (modo Supabase)
- `telegram.ts`: tipar `initDataUnsafe` (`user.id`, `start_param`) e expor `idUsuarioTelegram()` e `parametroInicial()`.
- `Repositorio.temSessao()` na implementação Supabase:
  1. Lê a sessão guardada.
  2. Se a sessão guardada tem `app_metadata.telegram_id` diferente do usuário do Telegram atual, faz `signOut` local e a descarta.
  3. Se há `initData` e `navigator.onLine`, faz `POST` em `<VITE_SUPABASE_URL>/functions/v1/auth-telegram` com `{initData}`, o cabeçalho `apikey` (chave publicável) e timeout de 10 s. Com `200`, chama `setSession` e retorna `true`.
  4. Em qualquer falha (rede, `401`, `500`), retorna se existe sessão guardada válida (o app abre sem sinal com a sessão anterior).
- A consulta `sessao` roda uma vez por abertura (`staleTime: Infinity`). Ao entrar, invalida as demais consultas.
- Fora do Telegram e sem sessão, continua a tela "Abra o Diário da obra pelo Telegram".

### C.2 Acesso
- `Repositorio` ganha (com implementação na fixture):
  - `obrasDisponiveis(): Promise<ObraDisponivel[]>`;
  - `solicitarAcesso(obraId)`;
  - `listarSolicitacoes(obraId): Promise<SolicitacaoAcesso[]>`;
  - `decidirSolicitacao(id, aprovar)`;
  - `localizarRegistro(id): Promise<{ slug, codigo, tipo } | null>`.

  `ObraDetalhe` ganha `papel: 'equipe' | 'gestor'`, lido da própria `participacao`.
- **Fixture.** O `usuario-teste` é gestor da HTO. Existe uma obra disponível, "Obra Demonstração", sem participação. Há um pedido pendente de "Maria Souza" (`@maria`) na HTO.
- **Tela Obras.** Seção "Outras obras" (só com itens e online):
  - cada obra mostra "Solicitar acesso", ou o selo "Aguardando aprovação", ou "Pedido recusado" com o botão "Pedir de novo";
  - um erro da RPC aparece como mensagem.

  Sem obras e sem disponíveis, o estado vazio fica: "Você ainda não tem acesso a nenhuma obra" / "Entre no grupo da obra no Telegram e abra o app de novo para pedir acesso."
- **Tela Obra (gestor).** Com pedidos pendentes, um link "N pedido(s) de acesso" leva à nova rota `/obras/:slug/acessos`. A tela Acessos lista nome, @username e data, com os botões "Aprovar" e "Recusar" (pede confirmação). Vazia: "Nenhum pedido de acesso pendente." Não gestor: "Só gestores da obra veem os pedidos de acesso."

### C.3 Abertura por link `startapp`
- Uma vez por abertura (chave em `sessionStorage` com o parâmetro já consumido):
  - `registro_<uuid>`: `localizarRegistro` e navega para `/obras/<slug>/ambientes/<codigo>?aba=<historico|pendencias>&registro=<id>`;
  - `acessos_<slug>`: navega para `/obras/<slug>/acessos`;
  - registro não encontrado: aviso "Registro não encontrado ou sem acesso.".
- Tela Ambiente com `registro=<id>`: o item da lista ganha destaque, rola até ficar visível e abre o visualizador de fotos.

### C.4 Testes
- Vitest para:
  - o login (`temSessao`, com o `fetch` e o cliente simulados): sucesso, offline com sessão guardada, `401` sem sessão e troca de usuário;
  - `parametroInicial`;
  - a seção "Outras obras";
  - a tela Acessos;
  - o destaque do registro.
- Playwright (fixture, viewport móvel):
  - pedir acesso à "Obra Demonstração" mostra "Aguardando aprovação";
  - o gestor aprova o pedido da Maria;
  - Telegram simulado com `start_param = registro_<id de um registro da fixture>` abre o ambiente com o visualizador.

## D. Configuração e verificação no projeto real (assistente + usuário)
1. Usuário: cadastra `TELEGRAM_BOT_TOKEN` em Supabase → Edge Functions → Secrets (nunca no chat).
2. Assistente:
   - aplica a migration;
   - cria os segredos do Vault (A.4);
   - define `ALLOWED_ORIGINS`, `TELEGRAM_BOT_USERNAME` e `TELEGRAM_APP_NAME`;
   - publica as três funções;
   - configura o webhook pelo SQL `net.http_post(... '/functions/v1/bot-webhook', x-segredo-interno, {"acao":"configurar"})` e confere a resposta em `net._http_response`.
3. Usuário:
   - no tópico HTO: `/vincular_obra hto`;
   - no tópico Geral: `/fixar_botao`;
   - abre o app pelo botão.
4. Verificação:
   - o login real cria o usuário como gestor;
   - um registro novo é publicado no tópico HTO com foto e link;
   - o link abre o registro;
   - um segundo membro pede acesso, o aviso aparece no tópico e a aprovação libera a obra;
   - Telegram fora do ar (token inválido num teste controlado) deixa o registro no histórico, com "Publicação com problema".
