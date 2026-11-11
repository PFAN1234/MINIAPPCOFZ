# admin-sessao

Entrada no site de administração (`/admin/`). Só admins do Mini App (tabela
`admin_app`) recebem link ou sessão. Fluxo completo, RPCs e configuração em
`docs/admin.md`.

## Ações

Sempre `POST` com corpo JSON `{ "acao": ... }`.

| Ação     | Corpo           | Quem chama                                  | Resposta `200`                                                             |
| -------- | --------------- | ------------------------------------------- | -------------------------------------------------------------------------- |
| `criar`  | `{acao}`        | Mini App, com `Authorization: Bearer <JWT>` | `{url: "<ADMIN_URL>#entrar=<token>", expira_em}`                           |
| `trocar` | `{acao, token}` | site, com o token do link                   | `{access_token, refresh_token, expires_at, usuario: {id, nome, username}}` |
| `widget` | `{acao, dados}` | site, com o objeto do Telegram Login Widget | igual a `trocar`                                                           |

- `criar`: o usuário vem de `auth.getUser(jwt)`; a RPC `admin_entrada_criar`
  (service_role) recusa quem não é admin. O token tem 32 bytes aleatórios em
  base64url; o banco guarda só o SHA-256 em hex, por 2 minutos.
- `trocar`: `admin_entrada_consumir` apaga a linha (uso único) e só devolve o
  usuário se o link não expirou e ele ainda é admin. A sessão é aberta com a
  mesma lógica do `auth-telegram` (`_shared/sessao.ts`: `generateLink` +
  `verifyOtp`).
- `widget`: confere os dados conforme
  <https://core.telegram.org/widgets/login#checking-authorization>
  (data_check_string ordenado, chave = SHA-256 do token do bot, HMAC-SHA-256,
  comparação em tempo constante, `auth_date` de no máximo 24 h). Não cria
  usuário: o `telegram_id` precisa existir em `usuario` e ser admin
  (`admin_por_telegram`).

Erros (genéricos, sem dizer se o usuário existe): `400` corpo inválido, `401`
token ou dados do widget inválidos/expirados/reutilizados, `403` sem JWT, não
admin ou usuário inexistente, `405` método, `500` erro interno.

## Variáveis

| Variável              | Uso                                                                       |
| --------------------- | ------------------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`  | token do bot, para validar o hash do Login Widget                         |
| `SUPABASE_SECRET_KEY` | chave secreta do projeto (alternativa: `SUPABASE_SERVICE_ROLE_KEY`)       |
| `ALLOWED_ORIGINS`     | origens CORS permitidas, separadas por vírgula (inclui o domínio do site) |
| `ADMIN_URL`           | endereço do site; padrão `https://miniappcofz.vercel.app/admin/`          |

`SUPABASE_URL` é injetada pela plataforma. Os segredos entram com
`supabase secrets set`, nunca em arquivo.

## Configuração

A função confere o JWT, o token e o widget por conta própria, então precisa de
`verify_jwt = false` em `supabase/config.toml`:

```toml
[functions.admin-sessao]
verify_jwt = false
```

## Testes

```bash
cd supabase/functions
deno fmt --check && deno lint && deno check */*.ts && deno test
```

Os testes não usam rede nem Supabase: o cliente é injetado em `criarHandler`
(`handler.ts`), e `widget_fixture.ts` assina os dados do widget como o Telegram.
