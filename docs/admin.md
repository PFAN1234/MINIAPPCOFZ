# Site de administração

Site web (`/admin/`) para cadastrar e editar as obras do Mini App no navegador do computador, sem terminal e sem chave secreta. Plano e fases em `tasks/plano-admin.md`; checklist em `tasks/todo.md` ("Site de administração"). Esta página descreve a **fase 1** (acesso, obras, pavimentos, configuração, admins e exportação). Envio de PDF (planta) e IFC (modelo) chegam nas fases 2 e 3.

## Peças

| Peça | Onde |
| --- | --- |
| Migration | `supabase/migrations/20261111170000_admin.sql` |
| Edge Function | `supabase/functions/admin-sessao/` (README com as ações) |
| Botão no Mini App | `app/src/telas/Obras.tsx` (`souAdmin()`, `criarLinkAdmin()` no repositório) |
| Site | `app/admin.html` + `app/src/admin/` (entrada própria do Vite, servida em `/admin/`) |
| Dados iniciais | `supabase/seed/admin_config.sql` (gerado por `scripts/importar_config_obras.py`) e `supabase/seed/admins.sql` |
| Testes | `tests/db/test_admin.py`, `tests/test_importar_config_obras.py`, `supabase/functions/admin-sessao/*_test.ts`, `app/src/admin/AdminApp.test.tsx`, `app/src/telas/Obras.test.tsx`, `app/e2e/admin.spec.ts` |

## Quem é admin

Tabela `public.admin_app (usuario_id, criado_em, criado_por)`, independente das obras: admin cria e edita todas as obras e inclui ou remove outros admins (nunca o último). `privado.eh_admin()` confere o usuário da sessão; a RPC `sou_admin()` devolve o mesmo para o cliente. Os primeiros admins (Patrício Ferreira e Eduardo Lima) entram por `supabase/seed/admins.sql`, pelo `telegram_id`; a pessoa precisa ter aberto o Mini App ao menos uma vez (a linha em `usuario` nasce no primeiro login).

## Entrada no site

Duas formas, ambas terminando numa sessão Supabase normal do próprio admin (o mesmo `auth.uid()` do Mini App), guardada no navegador pelo supabase-js com a chave `miniappcofz-admin-auth` (separada da do Mini App).

### 1. Botão "Administração" no Mini App

```
Mini App (tela Obras; botão só aparece se sou_admin())
  │ POST admin-sessao {acao: "criar"}  + Authorization: Bearer <JWT do usuário>
  ▼
admin-sessao: auth.getUser(JWT) → token aleatório (32 bytes, base64url)
  │ RPC admin_entrada_criar(usuario, sha256(token))  ← recusa quem não é admin (42501 → 403)
  │ privado.admin_entrada guarda só o hash, expira em 2 min; apaga os expirados
  ▼
{url: "<ADMIN_URL>#entrar=<token>", expira_em}  → Telegram.WebApp.openLink(url) (fora do Telegram, window.open)
  ▼
Site /admin/: lê #entrar=, apaga o hash da URL (history.replaceState) e chama
  POST admin-sessao {acao: "trocar", token}
  │ RPC admin_entrada_consumir(sha256(token)): apaga a linha (uso único) e só devolve o usuário
  │ se o link não expirou e ele ainda é admin
  ▼
sessão (generateLink + verifyOtp, a mesma lógica do auth-telegram) → supabase.auth.setSession
```

O token em claro só existe na URL (no hash, que o navegador não envia ao servidor) e na resposta da função; o banco guarda o SHA-256 em hexadecimal. Link reutilizado, expirado ou desconhecido recebe a mesma resposta (`401`).

### 2. Telegram Login Widget

Sem link, o site mostra o botão oficial do Telegram (`https://telegram.org/js/telegram-widget.js?22`, `data-telegram-login` = `VITE_TELEGRAM_BOT`, `data-onauth`) e o texto "ou use o botão Administração no Mini App". O retorno do widget (`id`, `first_name`, `last_name`, `username`, `photo_url`, `auth_date`, `hash`) vai para `admin-sessao {acao: "widget", dados}`, que valida conforme a [documentação oficial](https://core.telegram.org/widgets/login#checking-authorization): data_check_string com os campos (menos `hash`) em ordem alfabética, chave = SHA-256 do token do bot, HMAC-SHA-256, comparação em tempo constante e `auth_date` de no máximo 24 h. Depois, `admin_por_telegram(id)`: o usuário precisa existir em `usuario` e ser admin; a função não cria usuário. Quem não é admin (ou não existe) recebe `403` genérico.

Sessão de quem não é admin (por exemplo, removido depois de entrar) mostra "Acesso negado" com o botão Sair; as RPCs recusam com 42501 de qualquer forma.

## RPCs

Todas `security definer`, `search_path = ''`, `execute` só para `authenticated` (as da função, só para `service_role`). As de admin chamam `privado.exigir_admin()`: 28000 sem sessão, 42501 para quem não é admin.

| RPC | O que faz |
| --- | --- |
| `sou_admin()` | `boolean` |
| `admin_listar_obras()` | obras com pavimentos (`jsonb`), ambientes ativos, `status` da configuração e data da última gravação |
| `admin_obter_obra(slug)` | `jsonb` com obra (inclui `telegram_vinculado`), pavimentos (com contagem de ambientes e plantas), configuração e quem gravou por último |
| `admin_salvar_obra(p)` | sem `id`: cria (slug `^[a-z0-9-]+$`, até 40; nome até 120; ordem); com `id`: edita nome e ordem. Slug diferente na edição: 22023. Slug repetido: 23505 |
| `admin_salvar_pavimentos(slug, p)` | `p` é a lista completa `[{codigo, nome, ordem}]`: inclui, atualiza nome e ordem pelo código e apaga os que ficaram fora, desde que não tenham ambientes nem plantas (senão 23503 com os códigos). Código `^[a-z0-9][a-z0-9-]*$`, até 30 |
| `admin_salvar_config(slug, config)` | grava `obra_config` (objeto; `status` em `aguardando_revisao_humana`/`revisado`; `nomes_fixos` e `categorias` texto → texto), com `atualizado_por = auth.uid()` |
| `admin_exportar_obra(slug)` | `jsonb` com `formato`, `versao`, obra, pavimentos, configuração, ambientes e plantas (com detalhes) |
| `admin_listar_admins()`, `admin_incluir_admin(usuario)`, `admin_remover_admin(usuario)` | incluir exige usuário em `usuario` (P0002); remover nunca tira o último (22023) |
| `admin_listar_usuarios()` | quem já entrou no Mini App, com `eh_admin`, para escolher um novo admin |
| `admin_entrada_criar(usuario, hash)` | **service_role**. Link de 2 min; 42501 se não for admin |
| `admin_entrada_consumir(hash)` | **service_role**. Uso único; devolve `usuario_id`, `email`, `nome`, `username` ou nada |
| `admin_por_telegram(telegram_id)` | **service_role**. Admin pelo id do Telegram (Login Widget) |

As tabelas `admin_app`, `obra_config` e `privado.admin_entrada` têm RLS ligada e nenhum grant para `anon`/`authenticated`: o cliente só chega a elas pelas RPCs. Como nas fases anteriores, o `service_role` não tem grant nas tabelas; só executa as três funções acima.

## Configuração da obra (`obra_config`)

`config` é o equivalente do `data/<slug>/obra.json` sem `slug` e `nome` (que ficam em `obra`) e com os pavimentos reduzidos a `codigo`, `pdf` e `pagina` (nome e ordem ficam na tabela `pavimento`, editada pelo site). Na fase 1 o site edita `status`, `nomes_fixos` (abreviações) e `categorias`; os demais campos (`revisao`, `prancha`, `renomear`, `ambientes_manuais`, `manter_codigo`, `revisao_humana`...) são mantidos como estão. HTO e COFZ entram por `supabase/seed/admin_config.sql`, gerado por:

```bash
python3 scripts/importar_config_obras.py              # todas as obras de data/
python3 scripts/importar_config_obras.py --verificar  # falha se o SQL estiver desatualizado
```

Os scripts Python continuam lendo o `obra.json`; o banco passa a ser a fonte quando a fase 2 levar o extrator para o navegador. Até lá, uma mudança feita no site não volta sozinha para o `obra.json` (use "Exportar JSON" para conferir).

## Site `/admin/`

- Telas: Obras (lista com nome, slug, pavimentos, ambientes ativos e status; "Nova obra"), Obra (nome e ordem, slug só leitura; pavimentos com código só na criação; configuração; "Exportar JSON"; aviso de que PDF e IFC chegam nas próximas fases) e Admins (incluir entre usuários existentes, remover com confirmação).
- Vercel: `app/vercel.json` reescreve `/admin` e `/admin/(.*)` para `/admin.html` antes da regra geral do Mini App. Em dev e preview, o plugin `siteAdmin` do `vite.config.ts`.
- Service worker do Mini App: não intercepta `/admin` nem os pedidos feitos por páginas de `/admin`; o precache (`precache-manifest.json`) fica sem `admin.html` e sem os arquivos que só a entrada `admin` usa.
- Desenvolvimento: `VITE_DADOS=fixture npm run dev` e abrir `/admin/` (HTO e COFZ em memória; `localStorage['fixture-admin'] = 'nao'` simula quem não é admin).

## Variáveis e configuração

| Onde | Variável | Valor |
| --- | --- | --- |
| Edge Function `admin-sessao` | `TELEGRAM_BOT_TOKEN` | token do bot (segredo; o mesmo do `auth-telegram`) |
| | `SUPABASE_SECRET_KEY` | chave secreta (segredo; alternativa `SUPABASE_SERVICE_ROLE_KEY`) |
| | `ALLOWED_ORIGINS` | origens CORS separadas por vírgula; precisa incluir o domínio do site (`https://miniappcofz.vercel.app`, que é o mesmo do Mini App, e o domínio de preview se for testar nele) |
| | `ADMIN_URL` | endereço do site, padrão `https://miniappcofz.vercel.app/admin/` |
| Vercel (app) | `VITE_TELEGRAM_BOT` | nome do bot, sem `@` (Login Widget); `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` já existentes |
| BotFather | `/setdomain` | escolher o bot e informar o domínio do site (`miniappcofz.vercel.app`); sem isso o widget mostra "Bot domain invalid" |
| `supabase/config.toml` | `[functions.admin-sessao] verify_jwt = false` | a função confere o JWT, o token e o widget por conta própria |

Segredos entram com `supabase secrets set` ou pelo painel, nunca em arquivo.

## Aplicar num projeto

1. Migration `20261111170000_admin.sql`.
2. Deploy da função: `supabase functions deploy admin-sessao` (com `verify_jwt = false`, já no `config.toml`), segredos acima e `ALLOWED_ORIGINS`/`ADMIN_URL`.
3. Seeds de dados: `supabase/seed/admin_config.sql` (depois de `hto.sql` e `cofz.sql`) e `supabase/seed/admins.sql` (depois de os admins terem entrado no Mini App). Ambos idempotentes.
4. Vercel: `VITE_TELEGRAM_BOT` e novo deploy do app (o `vercel.json` novo publica `/admin/`).
5. BotFather: `/setdomain` com o domínio do site.
6. Conferir: no Mini App, o botão "Administração" aparece só para os admins e abre o site já logado; no site, o Login Widget entra com um admin e recusa outra conta.
