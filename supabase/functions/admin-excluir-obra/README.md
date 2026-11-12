# admin-excluir-obra

Exclusão de obra pelo site de administração (`/admin/`): apaga a obra no banco
(RPC `admin_excluir_obra`, como o admin) e depois os arquivos dela no Storage
(buckets `fotos`, `plantas`, `originais` e `modelos`, todos em `<obra_id>/...`).
Regras, RPCs e o que acontece com o Telegram em `docs/admin.md` ("Arquivar e
excluir obra").

## Ações

Sempre `POST` com `Authorization: Bearer <access token do admin>` e corpo JSON
`{ "acao": ... }`.

| Ação      | Corpo                       | O que faz                                                                                                               |
| --------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `excluir` | `{acao, slug, confirmacao}` | `admin_excluir_obra(slug, confirmacao)` com o JWT do usuário; remove os arquivos; `admin_registrar_limpeza`             |
| `limpar`  | `{acao, exclusao_id}`       | confere `sou_admin` com o JWT; `admin_exclusao_para_limpar` (service role) dá o `obra_id`; remove os arquivos; registra |

`confirmacao` é o nome da obra, exatamente (o banco ignora só os espaços nas
pontas; maiúsculas e minúsculas contam).

Resposta `200`:

```json
{
  "ok": true,
  "exclusao_id": "<uuid>",
  "obra_id": "<uuid>",
  "resumo": { "registros": 0, "...": 0 },
  "arquivos_removidos": {
    "fotos": 0,
    "plantas": 0,
    "originais": 0,
    "modelos": 0
  },
  "pendente": false
}
```

- `resumo` só vem em `excluir` (o mesmo de `admin_resumo_obra`).
- Se a remoção dos arquivos falhar depois da exclusão no banco: `200` com
  `"pendente": true` e `"erro": "<mensagem>"`. A obra já foi apagada; tente de
  novo com `limpar` e o `exclusao_id`. `arquivos_removidos` conta só o que saiu
  nesta chamada (o banco soma as tentativas em `obra_excluida`).

Erros: `400` corpo inválido ou confirmação que não confere (com a mensagem da
RPC), `401` sem JWT ou JWT inválido, `403` não admin, `404` obra (ou exclusão)
não encontrada, `405` método, `500` erro interno (sem detalhes).

## Remoção dos arquivos

Para cada bucket: lista `<obra_id>` recursivamente (o `list` do Storage devolve
pastas com `id === null`), paginando de 100 em 100, e só depois remove, em lotes
de até 100 caminhos. Um bucket com falha não impede os outros. O `obra_id` é
conferido como UUID antes de listar (nunca lista a raiz de um bucket).

## Variáveis

| Variável                   | Uso                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| `SUPABASE_SECRET_KEY`      | chave secreta (alternativa: `SUPABASE_SERVICE_ROLE_KEY`): JWT, Storage e RPCs da limpeza |
| `SUPABASE_PUBLISHABLE_KEY` | chave pública (alternativa: `SUPABASE_ANON_KEY`) do cliente que chama a RPC como o admin |
| `ALLOWED_ORIGINS`          | origens CORS permitidas, separadas por vírgula (inclui o domínio do site)                |

`SUPABASE_URL` (e `SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY`) são injetadas
pela plataforma. Os segredos entram com `supabase secrets set`, nunca em
arquivo. O token do usuário nunca vai para o log.

## Configuração

A função confere o JWT por conta própria (`auth.getUser` com a chave secreta),
então precisa de `verify_jwt = false` em `supabase/config.toml`:

```toml
[functions.admin-excluir-obra]
verify_jwt = false
```

## Testes

```bash
cd supabase/functions
deno fmt --check && deno lint && deno check */*.ts && deno test
```

Os testes não usam rede nem Supabase: o cliente da service role, o cliente do
usuário e o Storage são injetados em `criarHandler` (`handler.ts`).
