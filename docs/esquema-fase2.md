# Fase 2 — contrato do banco, permissões e autenticação

Especificação usada para implementar `supabase/migrations/`, `supabase/seed/hto.sql` e a Edge Function `auth-telegram`. Projeto de desenvolvimento: Supabase `miniappcofz-dev` (ref `nyfcualazkngqmrxcczh`, sa-east-1).

Princípios:
- O cliente só **lê** tabelas, e só o que pertence às obras em que participa. Toda gravação de negócio passa por RPC `security definer` com validações explícitas, ou pela service role dentro das Edge Functions.
- `anon` não acessa nada. `authenticated` recebe `select` apenas nas tabelas listadas e `execute` apenas nas RPCs públicas.
- Funções auxiliares de permissão ficam no schema `privado`, que a API não expõe. Toda função `security definer` usa `set search_path = ''` e nomes qualificados.
- Identificadores: `uuid`. Os ids de `registro`, `encerramento` e `foto` são gerados no cliente e servem como chave de idempotência.

## Tabelas (schema `public`)

| Tabela | Colunas | Restrições |
| --- | --- | --- |
| `obra` | `id uuid pk default gen_random_uuid()`, `slug text`, `nome text`, `ordem int default 0`, `telegram_chat_id bigint null`, `telegram_thread_id bigint null`, `criado_em timestamptz default now()` | `slug` único, formato `^[a-z0-9-]+$` |
| `usuario` | `id uuid pk → auth.users(id) on delete cascade`, `telegram_id bigint`, `nome text`, `username text null`, `criado_em`, `atualizado_em` | `telegram_id` único |
| `participacao` | `obra_id → obra`, `usuario_id → usuario`, `papel text`, `criado_em` | pk (`obra_id`, `usuario_id`); `papel in ('equipe','gestor')` |
| `solicitacao_acesso` | `id uuid pk`, `obra_id`, `usuario_id`, `estado text default 'pendente'`, `criado_em`, `decidido_por uuid null → usuario`, `decidido_em null` | `estado in ('pendente','aprovada','recusada')`; índice único parcial (`obra_id`, `usuario_id`) where `estado = 'pendente'` |
| `pavimento` | `id uuid pk`, `obra_id`, `codigo text`, `nome text`, `ordem int` | único (`obra_id`, `codigo`); único (`id`, `obra_id`) para FK composta |
| `ambiente` | `id uuid pk`, `obra_id`, `pavimento_id`, `codigo text`, `nome_operacional text`, `nome_planta text`, `categoria text`, `area_m2 numeric(8,2) null`, `revisao_planta text`, `marcadores jsonb`, `ordem int` | único (`obra_id`, `codigo`); FK (`pavimento_id`, `obra_id`) → `pavimento(id, obra_id)`; único (`id`, `obra_id`) |
| `registro` | `id uuid pk` (cliente), `obra_id`, `ambiente_id`, `tipo text`, `legenda text`, `autor_id → usuario`, `capturado_em timestamptz`, `recebido_em timestamptz default now()`, `situacao text null` | FK (`ambiente_id`, `obra_id`) → `ambiente(id, obra_id)`; `tipo in ('servico','pendencia')`; legenda com 1–1000 caracteres após `btrim`; (`tipo='servico'` e `situacao is null`) ou (`tipo='pendencia'` e `situacao in ('aberta','resolvida')`); único (`id`, `obra_id`) |
| `encerramento` | `id uuid pk` (cliente), `registro_id`, `obra_id`, `gestor_id → usuario`, `observacao text null`, `encerrado_em default now()` | `registro_id` único (1:1 com a pendência); FK (`registro_id`, `obra_id`) → `registro(id, obra_id)` |
| `foto` | `id uuid pk` (cliente), `obra_id`, `registro_id null`, `encerramento_id null`, `storage_path text`, `largura int`, `altura int`, `bytes int`, `ordem int`, `criado_em` | exatamente um entre `registro_id` e `encerramento_id`; `storage_path` único; inteiros positivos |
| `publicacao_telegram` | `id bigint identity pk`, `obra_id`, `registro_id null`, `encerramento_id null`, `estado text default 'pendente'`, `tentativas int default 0`, `proxima_tentativa_em default now()`, `message_ids bigint[] null`, `erro text null`, `criado_em`, `atualizado_em` | exatamente um entre `registro_id` e `encerramento_id`; `estado in ('pendente','enviando','publicado','incerto','falhou')`; índice em (`estado`, `proxima_tentativa_em`) |

Índices para as consultas do app: `registro (ambiente_id, recebido_em desc)`, `registro (obra_id, tipo, situacao)`, `foto (registro_id)`, `foto (encerramento_id)` e `participacao (usuario_id)`.

## Permissões (RLS ligada em todas as tabelas)

Funções auxiliares (`privado`, `security definer`, `stable`):
- `privado.eh_participante(p_obra uuid) returns boolean`: existe `participacao` do `auth.uid()` na obra.
- `privado.eh_gestor(p_obra uuid) returns boolean`: idem com `papel = 'gestor'`.
- `privado.uuid_ou_nulo(p text) returns uuid`: converte sem lançar erro, devolvendo `null` se for inválido. Usada nas políticas de Storage.

| Tabela | `select` para `authenticated` | Gravação pelo cliente |
| --- | --- | --- |
| `obra`, `pavimento`, `ambiente`, `registro`, `foto`, `encerramento`, `publicacao_telegram` | `privado.eh_participante(obra_id)` (em `obra`, pelo `id`) | nenhuma |
| `usuario` | a própria linha ou usuários que dividem alguma obra com quem consulta | nenhuma (só a `auth-telegram`, via service role) |
| `participacao` | as próprias linhas ou as da obra em que é gestor | nenhuma nesta fase (RPC de gestão na fase 7) |
| `solicitacao_acesso` | as próprias ou as da obra em que é gestor | `insert` só da própria (`usuario_id = auth.uid()`, `estado = 'pendente'`) |

## Storage

- Bucket `fotos`, privado, limite de 10 MB, só `image/jpeg`. Caminho: `<obra_id>/<registro_id>/<foto_id>.jpg`. Fotos de encerramento usam o `registro_id` da pendência.
- Políticas em `storage.objects` para `authenticated`, com `bucket_id = 'fotos'`:
  - `select`, `insert` e `update`: `privado.eh_participante(privado.uuid_ou_nulo((storage.foldername(name))[1]))`;
  - `update`: além disso, `owner_id = auth.uid()::text`, para permitir o reenvio (upsert) do mesmo arquivo;
  - sem `delete`.
- A exibição usa URL assinada.

## RPCs (`public`, `security definer`, `execute` só para `authenticated`)

### `concluir_registro(p_id uuid, p_ambiente_id uuid, p_tipo text, p_legenda text, p_capturado_em timestamptz, p_fotos jsonb) returns public.registro`

`p_fotos` é uma lista de `{id, largura, altura, bytes}` com 1 a 10 itens. O caminho de cada foto é derivado no servidor, nunca aceito do cliente.

1. Exige `auth.uid()`. Descobre a obra pelo ambiente; o ambiente precisa existir, e o usuário precisa participar da obra.
2. **Idempotência.** Se já existe um `registro` com `p_id`:
   - mesmo autor e mesmo ambiente: devolve o existente sem alterar nada;
   - qualquer outro caso: erro `registro_id em uso`.

   A inserção usa `on conflict (id) do nothing`, seguida de nova leitura, para tolerar duas chamadas simultâneas.
3. Valida:
   - `tipo`;
   - legenda (`btrim`, 1–1000 caracteres);
   - `capturado_em` até no máximo 5 min no futuro;
   - de 1 a 10 fotos, com ids distintos;
   - para cada foto, existe `storage.objects` com `bucket_id='fotos'` e `name = format('%s/%s/%s.jpg', obra_id, p_id, foto.id)`.
4. Na mesma transação:
   - insere o `registro`, com `situacao = 'aberta'` se for pendência e `null` se for serviço;
   - insere as `foto` com `ordem` pela posição na lista;
   - insere `publicacao_telegram` com `estado = 'pendente'`.

### `encerrar_pendencia(p_id uuid, p_registro_id uuid, p_observacao text, p_fotos jsonb) returns public.encerramento`

1. Exige `auth.uid()`. Faz `select ... for update` do registro, que precisa existir e ser `tipo = 'pendencia'`; o chamador precisa ser gestor da obra do registro.
2. **Idempotência.** Se já existe um `encerramento` com `p_id` para esse registro, devolve-o. Se a pendência já está `resolvida` por outro encerramento, erro `pendência já encerrada`.
3. Valida de 1 a 10 fotos, com objetos em `<obra_id>/<registro_id>/<foto_id>.jpg`, e a observação com até 1000 caracteres (opcional).
4. Na mesma transação:
   - insere o `encerramento` e as `foto` com `encerramento_id`;
   - atualiza o registro para `situacao = 'resolvida'`;
   - enfileira `publicacao_telegram` com `encerramento_id`.

Erros usam `raise exception` com mensagem em português e `errcode`: `28000` para não autenticado, `42501` para sem permissão, `P0002` para não encontrado e `23505` para conflito de id ou pendência já encerrada. Os casos de validação usam `22023`.

## Realidade aumentada (migration `20261113090000_ra.sql`)

Contrato completo em `docs/contrato-ra.md`.

- `ra_referencial` (uma linha por obra): `sigla`, `revisao` e `coordenadas` (9 números de `getCoordinates()` do `.frag` de referência).
- `ambiente_geometria` (uma por ambiente): `guid`, `contorno` (`[[x, z], ...]`, 3 ou mais pontos), `y_piso`, `y_teto` (maior que `y_piso`) e `origem`.
- `ambiente_qr` (uma por ambiente): `parede` (aresta `i` do contorno, `>= 0`), `distancia_m` (`>= 0`), `altura_m` (0 a 5), `lado_m` (0,05 a 1) e `atualizado_por`.
- `modelo.matriz`: nula (identidade) ou array de 16 números.
- `foto.origem` (`normal`, `ra_limpa` ou `ra_modelo`; padrão `normal`) e `foto.ra` (jsonb; nulo quando `origem = 'normal'`).
- RLS nas três tabelas novas: `select` para participantes da obra (`privado.eh_participante`) e admins (`privado.eh_admin`); sem política de escrita para clientes. O `service_role` escreve (seed) e lê `ambiente`.
- `concluir_registro` (mesma assinatura) aceita `origem` e `ra` em cada item de `fotos`; ausentes valem `'normal'` e `null`. `origem` fora da lista ou `ra` com `origem = 'normal'` dão `22023`. `encerrar_pendencia` não muda.
- RPCs de admin: `admin_listar_ra(p_obra uuid)`, `admin_definir_qr(p_ambiente, p_parede, p_distancia_m, p_altura_m, p_lado_m)` (exige geometria, `p_parede` dentro do contorno e `p_distancia_m` até o comprimento da parede) e `admin_remover_qr(p_ambiente)`.

## Boletim: emissão e envio (migration `20261114120000_boletim_emissao.sql`)

Contrato completo em `docs/contrato-boletim.md` (parte 3); a base (`boletim`, `observacao`, `etapa_aditivo`, `etapa_responsavel`, bucket `boletins`) vem de `20261113150000_boletim_base.sql`.

- `etapa.estacao`/`estacao_reserva` (antes `inmet_estacao`/`inmet_estacao_reserva`): código numérico do Observatório de Fortaleza (`^[0-9]{3,6}$`, diferentes entre si; padrão 8836/9281 na criação pelo site). Saíram `inmet_estacao`, `clima_dia` e `admin_sugerir_estacoes`.
- `boletim_emissao` (fila): `id bigint identity pk`, `etapa_id → etapa (cascade)`, `data`, `revisao`, `estado` (`pendente`, `gerando`, `emitido`, `falhou`), `tentativas`, `proxima_tentativa`, `erro`, `pedido_por → usuario` (null = automático), `criado_em`, `atualizado_em`, `boletim_id → boletim (cascade)`; único (`etapa_id`, `data`, `revisao`); `boletim_id` preenchido só quando `emitido`. RLS ligada e sem grant para `anon`/`authenticated`: só pelas RPCs.
- `publicacao_telegram.boletim_id → boletim (cascade)`: exatamente um entre `registro_id`, `encerramento_id` e `boletim_id`; `obra_id` é null só na publicação de boletim (único por boletim). A política de leitura continua `eh_participante(obra_id)`, então a publicação do boletim não aparece no Mini App.
- Gerador (`service_role`): `reivindicar_emissoes`, `boletim_snapshot`, `concluir_emissao`, `falhar_emissao`. Site (admin): `admin_listar_boletins`, `admin_pedir_emissao`, `admin_boletim_snapshot`.
- Agendamento: pg_cron `agendar-boletins` (`*/5 * * * *`) → `privado.agendar_boletins()` → `privado.disparar_gerador()` (segredos `url_gerador_boletim` e `segredo_interno` no Vault).

## Seed da HTO

`scripts/gerar_seed.py` lê `data/hto/ambientes.json` e escreve `supabase/seed/hto.sql`, idempotente com `on conflict ... do update`:
- `obra` com `slug = 'hto'` e `nome = 'HTO'`;
- os 2 `pavimento`: `codigo` = `id` do JSON, `nome`, `ordem` pela posição;
- os 87 `ambiente`:
  - `codigo` = `id` do JSON e `ordem` = posição na lista, que já vem ordenada;
  - `nome_operacional`, `nome_planta`, `categoria` e `area_m2` vêm direto do JSON;
  - `revisao_planta` = `revisao`, e `marcadores` = `marcadores` do JSON, em jsonb.

## Edge Function `auth-telegram`

- `POST` com `{ "initData": "<string>" }`, `verify_jwt = false`. CORS liberado só para as origens em `ALLOWED_ORIGINS` (lista separada por vírgula).
- **Validação.** Segue https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app:
  - `secret = HMAC_SHA256(key="WebAppData", msg=bot_token)`;
  - `hash = hex(HMAC_SHA256(key=secret, msg=data_check_string))`, em que `data_check_string` são os pares `chave=valor`, exceto `hash`, em ordem alfabética e unidos por `\n`;
  - a comparação é em tempo constante;
  - rejeita se `auth_date` tiver mais de 24 h ou estiver mais de 5 min no futuro, ou se faltar `user.id`.
- **Sessão.** Usa o cliente admin com a service role:
  - procura `usuario` pelo `telegram_id`;
  - se não houver, cria o usuário no Auth com `email = tg<telegram_id>@telegram.invalid`, `email_confirm = true` e `app_metadata.telegram_id`;
  - faz upsert de `usuario` (`id`, `telegram_id`, `nome`, `username`);
  - gera o link mágico com `auth.admin.generateLink` e troca o `hashed_token` por sessão (`verifyOtp` com `token_hash`).
- **Resposta.** `{ access_token, refresh_token, expires_at, usuario: { id, nome, username } }`. Erros: `401` para `initData` inválido ou expirado, `400` para corpo inválido e `500` genérico, sem detalhe interno.
- **Variáveis.** `TELEGRAM_BOT_TOKEN`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (com `SUPABASE_SERVICE_ROLE_KEY` como alternativa) e `ALLOWED_ORIGINS`. Nenhum segredo vai para o código.
