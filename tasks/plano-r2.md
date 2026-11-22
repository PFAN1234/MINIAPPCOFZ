# Plano — Arquivos no Cloudflare R2 (sai o Storage do Supabase)

## Contexto

Os arquivos saem do Storage do Supabase e vão para o Cloudflare R2 (plano gratuito: 10 GB, 1 milhão de operações de escrita e 10 milhões de leitura por mês, sem cobrança de saída de dados). O restante continua no Supabase: Postgres, login Telegram → sessão, RPCs, RLS, pg_cron e Edge Functions. Sair do Supabase por completo foi avaliado e descartado (35 migrations, ~9.900 linhas de SQL, 205 funções, 46 políticas, 82 usos de `auth.uid`/JWT).

Os arquivos que estão hoje no Storage são de teste e **não serão migrados**.

### Decisões confirmadas (2026-11-22)

- **Escopo:** todos os buckets vão para o R2. Ao final, o projeto não usa mais o Storage do Supabase.
- **Permissão:** uma Edge Function nova do Supabase, `armazenamento`, confere a permissão no banco (mesmas regras de hoje) e assina as URLs do R2. Sem Worker da Cloudflare.
- **Logo da organização:** URL assinada como os demais arquivos, com validade longa e cache no app. Nenhum bucket público.

### Acesso conferido (2026-11-22)

- API da Cloudflare: token de conta ativo, sem expiração; lista de buckets funciona (conta sem buckets).
- Endpoint S3 (`<conta>.r2.cloudflarestorage.com`) com `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`: listagem funciona (HTTP 200).
- O token atual é **Admin Read & Write em todos os buckets**. Antes de produção, criar um token só para o app (Object Read & Write, apenas os buckets do projeto) e trocar os segredos das functions e da Vercel por ele.

## Inventário do que depende do Storage

Buckets atuais (8), com os limites que passam a ser conferidos pela function:

| Pasta no R2 | Tamanho máx. | Tipos aceitos | Uso |
|---|---|---|---|
| `fotos` | 10 MB | image/jpeg | fotos dos registros (envio pela fila offline) |
| `plantas` | 5 MB | image/webp | plantas renderizadas (script e site) |
| `originais` | 50 MB | application/pdf | PDF original da planta |
| `modelos` | 200 MB | application/octet-stream | `.frag` do modelo federado |
| `boletins` | 10 MB | application/pdf, image/png | boletim emitido (servidor Vercel) |
| `relatorios` | sem limite hoje → definir | — | relatórios exportados (servidor Vercel) |
| `organizacao` | 1 MB | image/png, jpeg, webp | logo (hoje público) |
| `documentos` | 100 MB | pdf, imagens, dwg/dxf, xlsx, docx… | documentos da obra (admin) |

Pontos de código:

- **App (adapters `infra`):** `documentos/DocumentosSupabaseAdapter`, `documentos/presentation/admin/salvarBlob`, `fiscalizacao/RegistrosSupabaseAdapter`, `modelos/ModelosSupabaseAdapter`, `obras/OrganizacaoAdminSupabaseAdapter`, `plantas/PlantasSupabaseAdapter`, `ra/RaSupabaseAdapter`, `relatorios/BoletinsAdminSupabaseAdapter`, `relatorios/RelatoriosSupabaseAdapter`; fila offline em `operacao/infra/indexeddb/armazenamento.ts`.
- **Edge Functions:** `publish-outbox` (lê fotos para o Telegram), `admin-excluir-obra` (apaga arquivos), `assinar-envio-plantas` (assina envio de plantas).
- **Servidores Vercel:** `app/servidor/boletim/supabase.ts`, `app/servidor/relatorio/supabase.ts`.
- **Script:** `scripts/publicar_plantas.py` (via `assinar-envio-plantas`).
- **SQL que lê `storage.objects`:** `concluir_registro` (rpcs), emissão e edição do boletim, plantas, modelos, documentos, resumo de exclusão de obra, `varrer_orfaos_storage`; políticas de `storage.objects` em 14 migrations.
- **Testes de banco** que tocam storage (`tests/db/`): `stub_supabase.sql`, `test_banco`, `test_etapas`, `test_admin_planta`, `test_admin_modelo`, `test_admin_arquivar_excluir`, `test_boletim_base`, `test_boletim_emissao`, `test_boletim_edicao`, `test_relatorios_painel`, `test_revisoes_banco`, `test_orfaos_storage`.

## Desenho

### Buckets R2

Só existe um projeto Supabase (`miniappcofz-dev`, que é a produção; decisão de 2026-11-12). Por isso: um bucket de **produção**, ligado aos segredos das functions e da Vercel, e um bucket de **dev** usado só em testes locais, testes manuais da function e prévias, se configuradas para ele. As 8 pastas como prefixo da chave. A chave do objeto é `<pasta>/<caminho atual>`, mantendo as convenções de caminho de hoje para mexer o mínimo no SQL. CORS de cada bucket: `PUT`, `GET` e `HEAD` a partir do domínio da Vercel (produção e prévias) e do `localhost` de desenvolvimento, no bucket de dev.

### Tabela `arquivo` (substitui `storage.objects`)

`arquivo(id, pasta, caminho, tamanho, tipo, autor, situacao, criado_em, confirmado_em)`, com `(pasta, caminho)` único e `situacao` ∈ `pendente | confirmado | excluir`.

- Envio: a function cria a linha `pendente` e devolve a URL de PUT; depois do envio, o cliente pede a confirmação, a function faz HEAD no R2, confere tamanho e tipo e marca `confirmado`.
- As RPCs que hoje consultam `storage.objects` (ex.: `concluir_registro` exige as fotos enviadas) passam a exigir `arquivo.situacao = 'confirmado'`.
- Exclusão: o banco marca `excluir` (inclusive na exclusão de obra) e um processo da function apaga no R2 e remove a linha. O banco nunca fica apontando para arquivo que já sumiu.
- RLS: leitura só para admin (diagnóstico); escrita só pelas RPCs `security definer` chamadas pela function.

### Edge Function `armazenamento`

Recebe o JWT do usuário, chama RPCs de permissão (uma por operação, reaproveitando as regras das políticas de `storage.objects` de hoje) e assina com SigV4 (`aws4fetch` ou equivalente, em `_shared/r2.ts`). As chaves R2 ficam como segredos da function.

- `enviar`: pasta, caminho, tamanho e tipo → URL de PUT com `Content-Length` e `Content-Type` assinados (validade curta, ~10 min).
- `confirmar`: pasta e caminho → HEAD no R2 → `confirmado`.
- `ler`: lista de (pasta, caminho) → URLs de GET (validade padrão ~1 h; logo com validade longa).
- `excluir` e `manutencao` (só com a chave de serviço): processa a fila `excluir` e a varredura de órfãos.

**Fila offline:** a URL de envio expira, então a fila do app pede a URL **na hora de enviar**, não quando a foto é tirada. Reenvio do mesmo caminho é idempotente (PUT sobrescreve; `confirmar` repete sem efeito colateral).

### Servidores e script

- `publish-outbox` e `admin-excluir-obra` usam `_shared/r2.ts` direto (já rodam com a chave de serviço).
- `assinar-envio-plantas` passa a assinar no R2; `publicar_plantas.py` segue chamando essa function.
- Servidores Vercel (boletim e relatório): ver decisão em aberto 1.

## Partes

Cada parte vira um contrato (`docs/contrato-r2.md`, uma seção por parte) antes de ir para o implementador.

### 0. Cloudflare
- Criar os buckets de dev e produção, o CORS de cada um e (antes da parte 5) o token restrito do app.
- **Pronto quando:** PUT, GET e HEAD assinados funcionam no bucket de dev a partir de um script de teste, e o CORS responde ao preflight do domínio da Vercel.

### 1. Banco e permissões
- Migration da tabela `arquivo` e das RPCs de permissão/registro/confirmação/exclusão; trocar as consultas a `storage.objects` pelas de `arquivo`; remover as políticas de `storage.objects` (os buckets do Supabase ficam vazios e são apagados na parte 5).
- Atualizar `tests/db/` (o stub de storage dá lugar à tabela `arquivo`).
- **Pronto quando:** suíte de banco verde, com testes de permissão por papel para cada pasta.

### 2. Function `armazenamento`
- Handler + `_shared/r2.ts` + testes Deno com R2 simulado.
- **Pronto quando:** testes cobrem negação de permissão, tamanho/tipo fora do limite, confirmação com HEAD divergente e expiração; teste manual contra o bucket de dev.

### 3. App
- Módulo `armazenamento` no app (porta + adapter) e troca dos 9 adapters e da fila offline.
- **Pronto quando:** testes do app verdes e fluxo real em prévia da Vercel: registro com fotos (inclusive offline → online), planta, modelo, documento, boletim, relatório e logo.

### 4. Servidores
- `publish-outbox`, `admin-excluir-obra`, `assinar-envio-plantas`, `app/servidor/boletim`, `app/servidor/relatorio`, varredura de órfãos (pg_cron + pg_net chamando `manutencao`), `scripts/publicar_plantas.py`.
- **Pronto quando:** publicação no Telegram com fotos, emissão de boletim, exportação de relatório, exclusão de obra e publicação de plantas funcionam no dev.

### 5. Testes, documentação, backup e produção
- Suíte completa; atualizar `scripts/README.md`, `docs/admin.md` e os contratos afetados; backup com `rclone` (cópia do bucket de produção para um destino a definir).
- Produção: token restrito, segredos das functions e da Vercel, migrations, deploy das functions, conferência no banco de produção, esvaziar e apagar os buckets do Supabase.
- **Pronto quando:** fluxo completo em produção conferido e nenhum uso de `storage.` no código (fora do histórico de migrations).

## Decisões em aberto (antes do contrato)

1. **Servidores Vercel:** assinar direto no R2 com as chaves do token restrito (recomendado: menos uma chamada, e eles já rodam com a chave de serviço) ou pedir URLs à function `armazenamento`.
2. **Nomes dos buckets** de dev e produção.
3. **Validade das URLs:** envio ~10 min, leitura ~1 h, logo ~7 dias (proposta).
4. **Limite de `relatorios`**, que hoje não tem limite.
5. **Pendentes abandonados:** prazo para apagar o que ficou `pendente` sem confirmação (proposta: 24 h, na varredura diária).
6. **Destino do backup** com `rclone` e frequência.

## Dependências

- **Central de modelos (etapas 7 e 8 em `tasks/todo.md`):** a migration `20261127090000_documentos.sql` ainda não foi aplicada e cria o bucket `documentos` no Storage. Fechar a central antes de começar a parte 1, ou já levar `documentos` direto para o R2 e retirar o bucket dessa migration antes de aplicá-la.

## Riscos

- **Cota gratuita do R2:** acompanhar no painel; as visualizações do modelo (`.frag` de até 200 MB) são o maior consumo de leitura. Cache no app reduz.
- **Prévias da Vercel:** o domínio muda a cada prévia; o CORS precisa aceitar o padrão do projeto, e não um domínio fixo.
- **Relógio e expiração:** foto tirada offline e enviada dias depois só funciona se a URL for pedida no envio (ver fila offline).
