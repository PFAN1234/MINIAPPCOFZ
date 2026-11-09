# auth-telegram

Troca o `initData` do Telegram Mini App por uma sessão Supabase. Especificação
em `docs/esquema-fase2.md`.

## Variáveis

| Variável              | Uso                                                                 |
| --------------------- | ------------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`  | token do bot, para validar o hash do `initData`                     |
| `SUPABASE_SECRET_KEY` | chave secreta do projeto (alternativa: `SUPABASE_SERVICE_ROLE_KEY`) |
| `ALLOWED_ORIGINS`     | origens CORS permitidas, separadas por vírgula                      |

`SUPABASE_URL` é injetada pela plataforma. Os segredos entram com
`supabase secrets set`, nunca em arquivo.

## Configuração

A função valida o `initData` por conta própria, então precisa de
`verify_jwt = false` em `supabase/config.toml`:

```toml
[functions.auth-telegram]
verify_jwt = false
```

## Testes

```bash
cd supabase/functions
deno fmt --check && deno lint && deno check */*.ts && deno test
```

Os testes não usam rede nem Supabase: o cliente é injetado em `criarHandler`
(`handler.ts`).

## Chamada pelo cliente

```js
const r = await fetch(`${SUPABASE_URL}/functions/v1/auth-telegram`, {
  method: "POST",
  headers: { "Content-Type": "application/json", apikey: PUBLISHABLE_KEY },
  body: JSON.stringify({ initData: window.Telegram.WebApp.initData }),
});
const { access_token, refresh_token } = await r.json();
await supabase.auth.setSession({ access_token, refresh_token });
```

Respostas: `200` sessão, `400` corpo inválido, `401` initData inválido ou
expirado, `405` método, `500` erro interno.
