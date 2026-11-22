# Roteiro da virada para o R2 (Parte 5b)

Roteiro para a sessão que fizer a virada. O código está no PR [PFAN1234/MINIAPPCOFZ#62](https://github.com/PFAN1234/MINIAPPCOFZ/pull/62) (branch `claude/eager-hopper-rj9b0k`); o contrato é `docs/contrato-r2.md`, Parte 5.

## Regras

- **Nunca imprimir valores de segredos.** Tokens e chaves só circulam em variáveis do shell ou em arquivo do scratchpad com `umask 077`, apagado no fim do mesmo comando. Nada de valores em parâmetros de ferramentas MCP, em arquivos do repositório ou no chat. Saídas filtradas com `jq` para mostrar só `success`, ids públicos e nomes.
- A sessão começa do zero a cada comando do Bash: cada etapa que usa um segredo roda num único comando (ou num script do scratchpad).
- Projeto Supabase: `nyfcualazkngqmrxcczh` (é a produção). Hosts com credencial injetada pelo proxy: `api.cloudflare.com`, `api.supabase.com` e, nesta sessão, `api.vercel.com`. Mandar um valor qualquer no `Authorization` (`Bearer x`): o proxy substitui.
- A **Etapa A** pode ser feita a qualquer hora. A **Etapa B** (janela) só quando o usuário disser que pode fazer a virada agora; essa frase autoriza a sequência inteira, inclusive o merge do PR e a exclusão dos buckets antigos. Se uma conferência falhar, parar antes de apagar qualquer coisa e avisar.

## Feito pelo usuário (fora do alcance do Claude)

- Na Cloudflare: permissão *Account API Tokens: Edit* acrescentada ao token do ambiente; **remover logo depois da Etapa A**.
- Na Vercel: token cadastrado em Network secrets do ambiente para `api.vercel.com`.
- Backup inteiro: token `miniappcofz-backup` (Object Read only, só `miniappcofz-arquivos`), `rclone config` do remote `drive` e os quatro segredos do GitHub (`R2_BACKUP_ACCOUNT_ID`, `R2_BACKUP_ACCESS_KEY_ID`, `R2_BACKUP_SECRET_ACCESS_KEY`, `RCLONE_DRIVE_CONF`), como em `scripts/README.md`, "Backup do R2".
- Na janela: um registro com foto no Mini App e a conferência da publicação no grupo do Telegram.

## Etapa A — token do app e segredos (a qualquer hora)

1. **Conferir os acessos** (só leitura): `GET /accounts/{conta}/tokens/verify` ativo; `GET /accounts/{conta}/tokens/permission_groups` responde (sinal da permissão nova); `GET https://api.vercel.com/v2/user` ou `/v9/projects/miniappcofz` responde. Achar o `teamId` e o id do projeto `miniappcofz` na Vercel.
2. **Criar o token `miniappcofz-app`** (se já existir um com esse nome, não criar outro: perguntar ao usuário):
   - `POST /accounts/{conta}/tokens` com `name: "miniappcofz-app"` e uma política `allow` com o grupo de permissão de leitura e escrita de objetos do R2 (pelo `permission_groups`, o de nome `Workers R2 Storage Bucket Item Write`) nos recursos `com.cloudflare.edge.r2.bucket.{conta}_default_miniappcofz-arquivos` e `com.cloudflare.edge.r2.bucket.{conta}_default_miniappcofz-arquivos-dev` (valor `"*"`).
   - Credenciais S3: **Access Key ID** = `result.id`; **Secret Access Key** = SHA-256 em hexadecimal de `result.value`.
   - No mesmo comando: conferir as chaves com um `HEAD` ou `ListObjectsV2` assinado (aws4fetch no Node, de `app/node_modules`) nos dois buckets, e um acesso a outro bucket ou à API administrativa que precisa ser recusado.
3. **Segredos das functions**, no mesmo comando: `POST https://api.supabase.com/v1/projects/nyfcualazkngqmrxcczh/secrets` com `[{name, value}]` para `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` e `R2_BUCKET=miniappcofz-arquivos`.
4. **Variáveis da Vercel**, no mesmo comando: `POST https://api.vercel.com/v10/projects/{projeto}/env?teamId={time}&upsert=true`:
   - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`: `type: "sensitive"`, `target: ["production", "preview"]`;
   - `R2_BUCKET`: `type: "plain"`, `miniappcofz-arquivos` em `["production"]` e `miniappcofz-arquivos-dev` em `["preview"]`.
5. **Conferir só os nomes**: `GET .../secrets` no Supabase (lista de `name`) e `GET .../env` na Vercel (`key` e `target`).
6. Avisar o usuário para **remover a permissão Account API Tokens: Edit** do token do ambiente.

## Etapa B — janela (só com o ok do usuário)

Entre os passos 1 e 3 o app antigo não conclui registros: fazê-los em sequência, sem pausa.

1. **Migrations**, lidas do disco e aplicadas pela API (`POST /v1/projects/{ref}/database/query`), na ordem: `20261126080000_arquivo_r2.sql`, `20261126090000_admin_central_obras.sql`, `20261126100000_manutencao_arquivos.sql`, `20261127090000_documentos.sql`. Antes, conferir em `supabase_migrations.schema_migrations` quais já estão aplicadas; depois de cada uma, registrar a versão lá, seguindo o formato das linhas que já existem (se as anteriores não estiverem registradas, perguntar ao usuário antes de registrar). Conferir: tabela `arquivo`, funções `arquivo_*`, agendamento da manutenção no `cron.job`.
2. **Functions**: publicar `armazenamento`, `publish-outbox` e `admin-excluir-obra` com o `verify_jwt` do `supabase/config.toml` (todas `false`), incluindo `_shared/`; apagar a `assinar-envio-plantas` publicada. Conferir: `OPTIONS` com a origem do site responde com CORS; `POST` sem token na `armazenamento` dá 401.
3. **Merge do PR #62** na `main` (a Vercel publica a produção sozinha). Acompanhar até o deploy ficar `READY`.
4. **Conferência**:
   - Reenviar planta, modelo do boletim e logo: tentar por script (`scripts/publicar_plantas.py`, `app/scripts/publicar_modelos.mjs`, com `SEGREDO_INTERNO` lido pela API de SQL sem imprimir); se não der, pedir ao usuário que reenvie pelo `/admin/`.
   - Usuário: registro com foto no Mini App e publicação no Telegram.
   - Claude: logs das functions e da Vercel sem erro; no banco, linhas novas em `arquivo` com `situacao = 'confirmado'`; prévia e emissão de boletim, relatório de pendências e exclusão de uma obra de teste.
5. **`20261128090000_remover_storage.sql`**: aplicar e registrar; conferir que não sobra política em `storage.objects`.
6. **Buckets antigos do Storage**: listar pela API, esvaziar e apagar (só arquivos de teste).
7. **Primeiro backup**: disparar o workflow "Backup do R2" (se não houver como, pedir ao usuário: Actions → Backup do R2 → Run workflow) e conferir que terminou com sucesso.
8. Marcar a Parte 5 em `tasks/todo.md`, fazer commit e pedir `/compact` ao usuário.
