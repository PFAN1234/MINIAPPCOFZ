# Contrato: registro de erros do cliente e varredura de órfãos nos buckets

Decisões de 2026-11-18 (com o usuário):

- Erros do Mini App e do site admin ficam numa tabela do Supabase, sem serviço externo; lista no site admin.
- Órfãos nos buckets: começar só com simulação (relatório); a remoção real é ligada depois da conferência humana.
- Backup: adiado.

## Parte A — Registro de erros do cliente

### Banco (migration `20261125090000_erro_cliente.sql`)

- Tabela `public.erro_cliente`:
  `id bigint generated always as identity primary key`, `criado_em timestamptz not null default now()`,
  `usuario_id uuid` (o `auth.uid()` de quem enviou), `app text not null check (app in ('miniapp','admin'))`,
  `versao text`, `rota text`, `mensagem text not null`, `pilha text`, `agente text` (user agent),
  `contexto jsonb` (livre, pequeno). Limites de tamanho aplicados pela RPC: mensagem 1.000, pilha 8.000,
  rota 300, versao 50, agente 300 caracteres; `contexto` até 4 KB (acima disso, gravar `null`).
- RLS habilitada. Sem políticas de insert/update/delete para `anon`/`authenticated`; leitura só por admin
  (`privado.eh_admin(...)`, mesmo padrão das demais tabelas admin).
- RPC `public.registrar_erro_cliente(p_app text, p_versao text, p_rota text, p_mensagem text, p_pilha text, p_agente text, p_contexto jsonb) returns void`:
  `security definer`, `set search_path = ''`, só `authenticated` executa (revogar de `public` e `anon`).
  Usuário sem sessão: ignorar em silêncio. Limite de 20 registros por usuário por minuto (acima disso, ignorar em silêncio, sem erro).
- RPC `public.admin_listar_erros_cliente(p_limite int default 200)`: só admin; devolve os mais recentes primeiro,
  com o nome de exibição do usuário quando houver.
- Retenção: `cron.schedule` diário apagando registros com mais de 90 dias (mesmo padrão de `cron.schedule` já usado nas migrations).
- Testes em `tests/db/test_erro_cliente.py` (padrão de `tests/db/conftest.py`): grava com sessão; sem sessão não grava;
  corta textos longos; limite por minuto; não admin não lê nem lista; admin lista.

### Cliente

- Módulo compartilhado `app/src/util/erros.ts`:
  - `registrarErro(erro, extra?)`: monta o registro (mensagem, pilha, rota atual, versão do app — a mesma constante usada
    na versão da tela inicial —, user agent) e chama a RPC pelo cliente Supabase do app. Nunca lança; falha ao enviar é ignorada.
  - Deduplicação: a mesma mensagem não é enviada de novo em 60 s; no máximo 10 envios por carregamento de página.
  - `instalarCapturaGlobal(app)`: `window.addEventListener('error')` e `'unhandledrejection'`.
  - Com a fixture (`VITE_DADOS=fixture`) ou sem sessão, não envia nada (só `console.error`).
- `ErrorBoundary` em `app/src/components/` (componente de classe): mostra “Algo deu errado” e um botão “Recarregar”,
  registra o erro com o `componentStack` em `contexto`. Usar na raiz de `app/src/main.tsx` e de `app/src/admin/main.tsx`;
  instalar a captura global nos dois.
- Site admin: tela `app/src/admin/telas/Erros.tsx`, rota `erros` e link no menu, com tabela (quando, app, versão, rota,
  usuário, mensagem; clicar mostra a pilha). Hook em `app/src/admin/dados/hooks.ts`, função nos repositórios Supabase e fixture do admin.
- Testes Vitest: `erros.ts` (dedupe, limite, não lança, não envia sem sessão) e `ErrorBoundary` (mostra a tela e registra).

Pronto quando: typecheck, lint, Vitest dos arquivos novos e `pytest tests/db/test_erro_cliente.py` passam; `docs/admin.md` ganha a seção "Erros do cliente".

## Parte B — Varredura de órfãos nos buckets (simulação)

### O que é órfão

Objeto em `storage.objects` dos buckets `fotos`, `plantas`, `modelos`, `boletins`, `relatorios` (e o bucket de logos de etapa, se houver)
cujo `name` não aparece em nenhuma coluna de caminho das tabelas que apontam para aquele bucket, e cujo `created_at` tem mais de 7 dias.
O mapeamento bucket → colunas (ex.: `foto.storage_path`, `planta.imagem_path`/`imagem_hd_path`, `planta_detalhe.imagem_path`,
`modelo.caminho`, PDFs de revisão de planta, `boletim.pdf_path`, `etapa.logo_path`, relatórios) deve ser levantado nas migrations
e escrito no topo da função SQL. Caminhos guardados como prefixo ou montados por convenção (sem coluna) devem ser tratados como referenciados — na dúvida, **não** marcar como órfão.

### Banco (migration `20261125100000_orfaos_storage.sql`)

- Tabela `public.orfao_storage`: `bucket text`, `caminho text`, `tamanho bigint`, `criado_em timestamptz`,
  `detectado_em timestamptz default now()`, `removido_em timestamptz`, PK `(bucket, caminho)`. RLS; leitura só admin.
- Função `privado.varrer_orfaos_storage()` (`security definer`, `search_path = ''`, só o cron executa): recalcula a lista —
  insere os novos órfãos, apaga da tabela os que voltaram a ter referência ou sumiram do bucket. **Não remove nada do Storage.**
- `cron.schedule` diário (03:17 UTC) chamando a varredura.
- RPC `public.admin_resumo_orfaos()`: só admin; devolve, por bucket, quantidade e soma de bytes, e os 100 maiores.
- A remoção real (fase seguinte, fora deste contrato) será por Edge Function usando a API do Storage, nunca `delete` direto em `storage.objects`.
- Testes `tests/db/test_orfaos_storage.py`: objeto referenciado não entra; objeto recente (< 7 dias) não entra; órfão antigo entra;
  ganhar referência depois o tira da lista; nada é apagado de `storage.objects`; não admin não lê.

### Site admin

- Na tela `Erros.tsx` (renomeada no menu para “Manutenção”, com abas “Erros” e “Arquivos órfãos”), a aba de órfãos mostra o resumo por bucket e os maiores arquivos.

Pronto quando: `pytest tests/db/test_orfaos_storage.py`, typecheck, lint e Vitest dos arquivos tocados passam; `docs/admin.md` explica como conferir a lista.
