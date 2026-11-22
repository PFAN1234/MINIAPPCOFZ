# Contrato: arquivos no Cloudflare R2

Plano e decisões: `tasks/plano-r2.md`. Este contrato substitui o Storage do Supabase pelo R2 em todo o projeto. Cada parte abaixo é passada a um implementador com o trecho que vale para ela.

Decisões de 2026-11-22 (com o usuário):

- Todos os 8 buckets viram pastas de um bucket R2: `fotos`, `plantas`, `originais`, `modelos`, `boletins`, `relatorios`, `organizacao`, `documentos`. A chave do objeto no R2 é `<pasta>/<caminho>`, com o caminho igual ao de hoje.
- Buckets R2: `miniappcofz-arquivos` (produção, o único projeto Supabase) e `miniappcofz-arquivos-dev` (testes).
- A permissão é conferida no banco e as URLs são assinadas pela Edge Function `armazenamento`. Os servidores da Vercel e as Edge Functions que já usam a chave de serviço assinam direto no R2.
- Validade dos links: envio 10 min; leitura 1 h; logo (`organizacao`) 7 dias.
- `relatorios`: sem limite próprio (só o servidor grava); teto do R2, 5 GB.
- Envios `pendente` não confirmados em 7 dias são apagados pela manutenção diária.
- `documentos` nasce direto no R2: a migration `20261127090000_documentos.sql`, ainda não aplicada, é editada para não criar bucket nem políticas de Storage.
- Backup: GitHub Action semanal com `rclone` para uma pasta do Google Drive.

Arquivos atuais do Storage são de teste e não são migrados.

## Parte 1 — Banco e permissões

### Pré-condição (conversa principal, antes de chamar o implementador)

Conferir no banco que `20261126090000_admin_central_obras` e `20261127090000_documentos` não foram aplicadas. Se alguma foi, a mudança de `documentos` vira migration nova em vez de edição.

### Migration `20261126080000_arquivo_r2.sql`

Fica antes de `admin_central_obras` e `documentos` porque `documentos` passa a depender dela.

**Tabela `public.arquivo`**

```
id bigint generated always as identity primary key
pasta text not null check (pasta in ('fotos','plantas','originais','modelos','boletins','relatorios','organizacao','documentos'))
caminho text not null  -- sem '/' inicial, sem '..', até 300 caracteres (check)
tamanho bigint not null check (tamanho >= 0)
tipo text not null
autor uuid             -- auth.uid() de quem pediu o envio; null quando foi servidor/script
situacao text not null default 'pendente' check (situacao in ('pendente','confirmado','excluir'))
criado_em timestamptz not null default now()
atualizado_em timestamptz not null default now()
confirmado_em timestamptz
unique (pasta, caminho)
```

- Índices: `(situacao, atualizado_em)` para a manutenção; `(pasta, caminho text_pattern_ops)` para busca por prefixo (`<obra_id>/%`).
- RLS habilitada. Só `select` para admin (`privado.eh_admin()`). Nenhuma escrita direta para `anon` e `authenticated`; tudo passa pelas RPCs.

**Limites por pasta: `privado.limite_pasta(p_pasta text) returns table (tamanho_max bigint, tipos text[])`**

| pasta | tamanho_max | tipos |
|---|---|---|
| fotos | 10 MB | image/jpeg |
| plantas | 5 MB | image/webp |
| originais | 50 MB | application/pdf |
| modelos | 200 MB | application/octet-stream |
| boletins | 10 MB | application/pdf, image/png |
| relatorios | 5 GB | application/pdf |
| organizacao | 1 MB | image/png, image/jpeg, image/webp |
| documentos | 100 MB | a mesma lista de `allowed_mime_types` hoje em `20261127090000_documentos.sql:67` |

(MB = 1.048.576 bytes, como nos buckets atuais.)

**Permissão: `privado.pode_arquivo(p_acao text, p_pasta text, p_caminho text) returns boolean`**

`p_acao` ∈ `ler`, `enviar`, `excluir`. Usa `auth.uid()` e reproduz exatamente as políticas atuais de `storage.objects` (estado final):

| pasta | ler | enviar | excluir |
|---|---|---|---|
| fotos | participante da obra (1ª pasta, `eh_participante(uuid_ou_nulo(...))`) ou admin | participante da obra + caminho `<uuid>/<uuid>/<uuid>.jpg`; se já existe linha: só o mesmo autor e `not privado.foto_registrada(caminho)` | ninguém |
| plantas | participante ou admin | admin + `privado.caminho_de_obra` | ninguém |
| originais | admin | admin + regex e `caminho_de_obra` de `20261112090000_admin_planta.sql:39-46` | ninguém |
| modelos | participante ou admin | admin + regex e `caminho_de_obra` de `20261112120000_admin_modelo.sql:18-25` | ninguém |
| boletins | admin ou `participa_da_etapa(1ª pasta)` | ninguém (só servidor) | ninguém |
| relatorios | ninguém (o servidor assina) | ninguém | ninguém |
| organizacao | qualquer usuário autenticado (o logo era público) | admin + regex `logo-<16hex>.(png\|jpg\|webp)` de `20261112180000_etapas.sql:493-499` | admin |
| documentos | admin | admin + regex e `caminho_de_obra` de `20261127090000_documentos.sql:81-88` | ninguém |

As regex devem ser copiadas das migrations citadas, não reescritas.

**Ajudantes:** `privado.arquivo_confirmado(p_pasta, p_caminho) returns boolean` e `privado.arquivo_tamanho(p_pasta, p_caminho) returns bigint` (null se não confirmado).

**RPCs para `authenticated`** (`security definer`, `set search_path = ''`, revogar de `public` e `anon`):

- `public.arquivo_preparar_envio(p_pasta text, p_caminho text, p_tamanho bigint, p_tipo text) returns text`
  - Confere `pode_arquivo('enviar', ...)`, tamanho e tipo contra `limite_pasta`.
  - Erros, sempre com `raise exception` e mensagem igual ao código: `sem_sessao`, `sem_permissao` (42501), `caminho_invalido`, `fora_do_limite`, `em_exclusao` (22023).
  - Caminho sem linha: cria `pendente` com `autor = auth.uid()` e devolve `'enviar'`.
  - Linha `pendente`: atualiza tamanho, tipo, autor e `atualizado_em` e devolve `'enviar'`.
  - Linha `confirmado`, com reenvio permitido pela regra da tabela: volta para `pendente` e devolve `'enviar'`.
  - Foto já registrada (`foto_registrada`): devolve `'ja_confirmado'` sem erro. Hoje o app trata o erro de RLS do reenvio como "já enviada" (`app/src/dados/erros.ts:74`); isso passa a ser esse retorno.
  - Linha `excluir`: erro `em_exclusao`.
  - Limite: 300 `pendente` por usuário. Acima disso, erro `fora_do_limite`.
- `public.arquivo_pode_ler(p_itens jsonb) returns jsonb`: recebe `[{"pasta","caminho"}]` (máx. 200) e devolve só os itens que o usuário pode ler **e** que estão `confirmado`.
- `public.arquivo_marcar_exclusao(p_pasta text, p_caminho text) returns void`: confere `pode_arquivo('excluir', ...)` e marca `excluir`.

**RPCs só para `service_role`:**

- `public.arquivo_confirmar(p_pasta, p_caminho, p_tamanho bigint, p_tipo text, p_autor uuid) returns text`: exige linha `pendente` do mesmo autor (`p_autor` null aceita qualquer). Se tamanho e tipo batem com o `pendente`, marca `confirmado` e preenche `confirmado_em`, devolvendo `'confirmado'`. Se não batem, devolve `'divergente'` e a linha fica `pendente`. Sem linha, devolve `'nao_encontrado'`.
- `public.arquivo_registrar_servico(p_pasta, p_caminho, p_tamanho, p_tipo) returns void`: confere caminho (sem `..`) e `limite_pasta`, e faz upsert direto como `confirmado`, com `autor` null. É o que os servidores e scripts usam depois de gravar.
- `public.arquivo_fila_manutencao(p_limite int default 500) returns setof public.arquivo`: linhas `excluir` mais linhas `pendente` com `atualizado_em < now() - interval '7 days'`.
- `public.arquivo_remover(p_ids bigint[]) returns void`: apaga as linhas (chamada depois de apagar no R2).
- `public.arquivo_marcar_exclusao_prefixo(p_pastas text[], p_prefixo text) returns int`: marca `excluir` em lote (exclusão de obra ou etapa).
- `public.arquivo_sem_registro(p_chaves text[]) returns text[]`: recebe chaves `<pasta>/<caminho>` listadas no R2 e devolve as que não têm linha.

### Trocas no SQL existente (via `create or replace` na mesma migration)

Trocar `exists (select from storage.objects ...)` por `privado.arquivo_confirmado(...)`, e `metadata` de tamanho por `privado.arquivo_tamanho(...)`, sempre na **versão final** de cada função:

- `privado.exigir_objetos_fotos` (`20261109123914_rpcs.sql:57`), usada por `concluir_registro`
- `public.admin_publicar_revisao` (`20261112090000_admin_planta.sql:183`; originais e plantas)
- `public.admin_registrar_modelo` (versão final `20261123090000_ra_consistencia.sql:29`; usa o tamanho)
- `public.concluir_emissao` (versão final `20261115090000_boletim_edicao.sql:214`)
- `public.admin_salvar_organizacao` (versão final `20261113150000_boletim_base.sql:1322`; logo)
- `privado.resumo_obra` (`20261112150000_admin_arquivar_excluir.sql:434`) e `privado.resumo_etapa` (`20261112180000_etapas.sql:535`): contar em `arquivo` (`situacao <> 'excluir'`), com o mesmo formato de saída
- `privado.excluir_obra` (`20261112180000_etapas.sql:569`): também chamar `arquivo_marcar_exclusao_prefixo` para as pastas da obra (`fotos`, `plantas`, `originais`, `modelos`, `documentos`, prefixo `<obra_id>/`) na mesma transação. Exclusão de boletins: marcar os PDFs/PNGs dos boletins apagados.
- `privado.varrer_orfaos_storage()` (`20261125100000_orfaos_storage.sql:38`): ler de `arquivo` (`confirmado`) em vez de `storage.objects`; incluir `documentos`. Continua só registrando em `orfao_storage`, sem apagar. Acrescentar a `orfao_storage` a coluna `origem text not null default 'sem_referencia'` (valores `sem_referencia`, `sem_registro`) para a manutenção registrar objetos do R2 sem linha.

As políticas de `storage.objects` **não** são removidas nesta migration: o app antigo segue funcionando até a virada (parte 5). A remoção fica numa migration separada, aplicada só depois da virada.

### Edição de `20261127090000_documentos.sql`

Remover o `insert into storage.buckets` e as 3 políticas de `storage.objects`. Em `admin_registrar_documento`, trocar a checagem da linha 314 por `privado.arquivo_confirmado('documentos', v_caminho)`. Manter a validação de regex e extensão.

### Testes (`tests/db/`)

- Novo `test_arquivo.py` com a matriz pasta × papel (admin, participante, não participante, sem sessão) × ação; limites de tamanho e tipo; reenvio de foto (mesmo autor, outro autor, já registrada → `ja_confirmado`); confirmar (bate, diverge, outro autor, sem linha); fila de manutenção (7 dias); exclusão de obra marcando `excluir`; RPCs de serviço negadas a `authenticated`.
- Ajustar os testes que hoje inserem em `storage.objects` para gravar em `arquivo` (`conftest.py`, `test_banco`, `test_etapas`, `test_admin_planta`, `test_admin_modelo`, `test_admin_arquivar_excluir`, `test_boletim_base`, `test_boletim_emissao`, `test_boletim_edicao`, `test_relatorios_painel`, `test_revisoes_banco`, `test_orfaos_storage`). Os testes das políticas de `storage.objects` viram testes de `pode_arquivo` com a mesma intenção. O stub `stub_supabase.sql` continua, porque as migrations antigas usam o schema `storage`.
- **Pronto quando:** a suíte de banco está verde e nenhuma função na versão final lê `storage.objects`.

## Parte 2 — Function `armazenamento` e `_shared/r2.ts`

### `supabase/functions/_shared/r2.ts`

Cliente R2 só com `fetch` e `aws4fetch` (versão fixa). Sem API exclusiva do Deno, para o arquivo poder ser copiado sem mudança para `app/servidor/_compartilhado/r2.ts` na parte 4.

- Configuração: `{ contaId, chaveId, segredo, bucket }`, lida de `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.
- Endpoint: `https://<contaId>.r2.cloudflarestorage.com/<bucket>/<chave>`, região `auto`.
- Funções:
  - `urlAssinada(metodo: 'GET'|'PUT', chave, segundos, cabecalhos?)`: para PUT, assina `content-type` e `content-length`.
  - `cabecalho(chave)`: HEAD, devolve `{tamanho, tipo}` ou null.
  - `baixar(chave)`: bytes.
  - `gravar(chave, bytes, tipo)`.
  - `apagar(chaves[])`: em lotes de até 1.000; chave inexistente não é erro.
  - `listar(prefixo, continuacao?)`.
- Chave: `${pasta}/${caminho}`. Rejeitar pasta fora das 8 e caminho com `..` ou `/` inicial.

### `supabase/functions/armazenamento/` (`index.ts`, `handler.ts`, `handler_test.ts`)

Mesmo padrão das outras functions: `handler` com dependências injetadas, `index.ts` só monta as dependências reais. CORS igual ao das functions chamadas pelo navegador (`ALLOWED_ORIGINS`).

`POST` com JSON. Há dois modos de chamada:

- **Usuário:** `Authorization: Bearer <JWT da sessão>`. As RPCs de `authenticated` são chamadas com esse JWT, e as de `service_role` com a chave de serviço, passando `p_autor = uid`. Seguir `_shared/sessao.ts` para validar a sessão.
- **Interno:** cabeçalho `x-segredo-interno`, conferido como em `_shared/segredo.ts`. Não confere permissão de usuário. É usado por scripts e pelo pg_cron.

Ações:

| acao | entrada | saída (200) | notas |
|---|---|---|---|
| `enviar` | `pasta, caminho, tamanho, tipo` | `{situacao:'enviar', url, metodo:'PUT', cabecalhos:{'content-type'}, expira_em}` ou `{situacao:'ja_confirmado'}` | usuário: `arquivo_preparar_envio`; interno: confere `limite_pasta` via `arquivo_registrar_servico` só na confirmação. Validade 600 s |
| `confirmar` | `pasta, caminho` | `{situacao:'confirmado'}` | HEAD no R2 → `arquivo_confirmar` (usuário) ou `arquivo_registrar_servico` (interno). Objeto ausente: 404 `nao_encontrado`; divergente: 409 `divergente` |
| `ler` | `itens:[{pasta,caminho}]` (máx. 200) | `{urls:{"<pasta>/<caminho>": url}, expira_em}` | usuário: `arquivo_pode_ler`; itens negados ou ausentes ficam de fora. Validade 3.600 s; `organizacao` 604.800 s |
| `excluir` | `pasta, caminho` | `{situacao:'excluido'}` | `arquivo_marcar_exclusao` → apagar no R2 → `arquivo_remover` |
| `manutencao` | — | `{removidos, sem_registro}` | só interno. Processa `arquivo_fila_manutencao` (apaga no R2 e remove as linhas); depois lista o bucket inteiro e grava em `orfao_storage` (`origem='sem_registro'`) as chaves que `arquivo_sem_registro` devolver. Nunca apaga objeto sem linha |

Erros: 400 `entrada_invalida` / `caminho_invalido` / `fora_do_limite`; 401 `sem_sessao`; 403 `sem_permissao`; 404; 409 `divergente` / `em_exclusao`. Corpo `{erro:'<codigo>'}`. Os erros do banco são mapeados pela mensagem.

Agendamento: job pg_cron diário `manutencao-arquivos`, chamando a function com `pg_net` e o segredo interno, no mesmo padrão do job que já chama uma function (ver as migrations do `publish-outbox`). Fica na migration da parte 1 ou numa nova, sem horário fixo nas horas cheias.

**Testes (`handler_test.ts`, R2 e banco simulados):**

- cada ação nos dois modos;
- sessão ausente ou inválida;
- negação vinda do banco;
- `ja_confirmado`;
- assinatura de PUT com `content-length`;
- HEAD divergente e ausente;
- `ler` com item negado;
- validade de `organizacao`;
- `manutencao` sem apagar objeto sem registro.

Também há um teste de `_shared/r2.ts` com o vetor de assinatura conferido contra um exemplo conhecido de SigV4.

**Pronto quando:** os testes Deno passam e, na conversa principal, um teste manual contra `miniappcofz-arquivos-dev` faz enviar → PUT → confirmar → ler → excluir.

## Parte 3 — App

### Módulo `app/src/modules/armazenamento/`

Segue `docs/padrao-contexto-modulo.md`.

- Porta `Armazenamento`:
  - `enviar(pasta, caminho, dados: Blob, tipo): Promise<'enviado'|'ja_confirmado'>`: chama `enviar`, faz o PUT e depois `confirmar`.
  - `urls(pasta, caminhos[]): Promise<Map<string,string>>`: com cache em memória até 5 min antes de expirar.
  - `baixar(pasta, caminho): Promise<Blob>`
  - `excluir(pasta, caminho)`
- Teste de contrato da porta, que roda contra o adapter fake (em memória) e o real com `fetch` simulado.
- Adapter real: `supabase.functions.invoke('armazenamento', …)` mais `fetch` para PUT e GET.
- Erros de rede e timeout no PUT viram erro `rede` (a fila já sabe retentar). 403 no PUT (URL vencida) leva a pedir uma URL nova uma vez.
- Logo: além do cache em memória, guardar URL e validade em `localStorage`, com `try/catch`.

### Troca nos pontos de uso

- `fiscalizacao/infra/RegistrosSupabaseAdapter.ts`: `urlsImagens` (:178) e `enviarFoto` (:190). `enviarFoto` com `ja_confirmado` conta como enviada. Ajustar o mapeamento de `app/src/dados/erros.ts:74`.
- `ra/infra/RaSupabaseAdapter.ts:91`
- `relatorios/infra/BoletinsAdminSupabaseAdapter.ts:209, 262`
- `relatorios/infra/RelatoriosSupabaseAdapter.ts:108`
- `plantas/infra/PlantasSupabaseAdapter.ts:27, 45`
- `modelos/infra/ModelosSupabaseAdapter.ts:55`
- `documentos/infra/DocumentosSupabaseAdapter.ts:105` e `documentos/presentation/admin/salvarBlob.ts`
- `obras/infra/OrganizacaoAdminSupabaseAdapter.ts:14, 36`: a URL pública montada à mão sai; o logo passa por `urls('organizacao', …)`. A troca de logo apaga o antigo com `excluir`, como hoje.
- A fila offline (`fiscalizacao/application/use-cases/envio.ts`, `fila.ts`) não muda de lógica: a URL é pedida no momento do envio, porque `enviarFoto` faz tudo.
- Testes a ajustar: `app/src/admin/dados/supabaseBoletins.test.ts`, `app/src/dados/relatorios-supabase.test.ts`, `app/src/dados/modelos-supabase.test.ts`, `app/src/dados/erros.test.ts`, `RegistrosRepositorio.contract.ts`, `envio.test.ts`, e2e que simulam storage.

**Pronto quando:** `grep -rn "\.storage\b\|storage/v1" app/src` não encontra nada fora de testes de compatibilidade, a suíte do app está verde e, na conversa principal, o fluxo real funciona numa prévia da Vercel apontando para o bucket de dev:

- registro com fotos, inclusive offline → online e reenvio;
- planta;
- modelo;
- documento;
- boletim;
- relatório;
- logo.

## Parte 4 — Servidores e scripts

- **`app/servidor/_compartilhado/r2.ts`:** cópia idêntica de `supabase/functions/_shared/r2.ts`, com um teste que compara os dois arquivos.
- **`app/servidor/boletim`:** `FonteBoletim.baixar` e `enviar` (`supabase.ts:111, 116`) passam a usar o R2. Depois de cada `gravar`, chamar `arquivo_registrar_servico` **antes** de `concluir_emissao`.
- **`app/servidor/relatorio`:** `FonteRelatorio.baixar`, `enviar` e `assinar` passam a usar o R2. `assinar` usa `urlAssinada('GET', …, VALIDADE_URL_SEGUNDOS)`, e o upload é registrado com `arquivo_registrar_servico`.
- **Variáveis da Vercel:** `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. Documentar em `docs/admin.md`.
- **`supabase/functions/publish-outbox`:** os downloads de fotos e do PDF do boletim (`handler.ts:215, 466`) usam `_shared/r2.ts`. A interface `ClienteAdmin.storage` dá lugar a uma dependência `r2`.
- **`supabase/functions/admin-excluir-obra`:**
  - sai a listagem e remoção de `BucketStorage` (`handler.ts:51-141`, `465`);
  - depois da exclusão no banco, que já marca `excluir`, processar as linhas `excluir` do prefixo da obra (apagar no R2 e chamar `arquivo_remover`);
  - o que falhar fica para a `manutencao`;
  - ajustar o fake de `handler_test.ts`.
- **`supabase/functions/assinar-envio-plantas`:** remover. O único uso foi a carga de plantas, que passa ao script abaixo.
- **`scripts/publicar_plantas.py` e `app/scripts/publicar_modelos.mjs`:**
  - em vez do POST em `/storage/v1/object/...` com a chave de serviço, chamar `armazenamento` no modo interno (`enviar` → PUT → `confirmar`);
  - o segredo interno é lido de variável de ambiente;
  - atualizar `scripts/README.md`.
- **`app/scripts/testar_modelos_supabase.mjs`:** remover, junto com o script `testar:modelos` do `package.json`.
- **Pronto quando:** `grep -rn "storage\.from\|storage/v1\|\.storage\b"` em `app/servidor`, `supabase/functions`, `scripts` e `app/scripts` não encontra nada, e os testes dos servidores e das functions estão verdes.

## Parte 5 — Virada, backup e documentação

### Antes (conversa principal com o usuário)

- Criar o token restrito do app na Cloudflare (Object Read & Write, só os dois buckets) e um token só de leitura para o backup.
- Cadastrar os segredos:
  - functions: `R2_*`, com `R2_BUCKET=miniappcofz-arquivos`;
  - Vercel: produção e prévia, com o bucket de dev nas prévias;
  - GitHub: backup.

### Ordem da virada (fora do horário de uso; avisar a equipe)

1. Aplicar a migration `arquivo_r2` (e, se a central já estiver pronta, `admin_central_obras` e `documentos`).
2. Publicar as functions `armazenamento`, `publish-outbox` e `admin-excluir-obra`; remover `assinar-envio-plantas`.
3. Publicar o app na Vercel.
4. Conferir em produção: registro com foto, publicação no Telegram, planta, modelo, boletim, relatório, logo e exclusão de obra de teste.
5. Aplicar a migration que remove as políticas de `storage.objects`.
6. Esvaziar e apagar os buckets do Storage pela API.

Entre os passos 1 e 3, o app antigo não conclui registros: a janela deve ser curta.

### Backup

- `.github/workflows/backup-r2.yml`: agendado uma vez por semana e também com execução manual.
- Usa `rclone copy` (não `sync`, para o backup guardar o que foi apagado) de `miniappcofz-arquivos` para `backup-r2/` no Google Drive.
- Segredos: a configuração do rclone para o Drive e as chaves do token de leitura.
- Documentar em `scripts/README.md` como criar a configuração do Drive e como restaurar.

### Documentação

- `docs/admin.md`: variáveis e segredos.
- `docs/contrato-erros-orfaos.md`: a parte B passa a ler `arquivo` e ganha `origem`.
- `docs/ROADMAP.md`: remover `assinar-envio-plantas`.
- `tasks/todo.md`.

**Pronto quando:** o fluxo completo está conferido em produção, o backup rodou uma vez com sucesso e não sobra uso do Storage do Supabase no código.

## Parte 0 — Cloudflare (conversa principal, antes da parte 2)

- Criar `miniappcofz-arquivos` e `miniappcofz-arquivos-dev`.
- CORS dos dois:
  - métodos `GET`, `PUT`, `HEAD`;
  - cabeçalhos `content-type`;
  - expor `etag`;
  - `MaxAgeSeconds` 3600;
  - origens: `https://miniappcofz.vercel.app` e as prévias do projeto; no dev, também `http://localhost:5173`.
- Conferir se o R2 aceita curinga para as prévias. Se não aceitar, listar os domínios ou usar `*`; as URLs são assinadas de qualquer forma.
- **Pronto quando:** PUT, GET e HEAD assinados funcionam no bucket de dev a partir de um script, e o preflight do domínio da Vercel responde com os cabeçalhos certos.
