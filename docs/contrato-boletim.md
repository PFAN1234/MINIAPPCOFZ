# Contrato: Boletim de Acompanhamento Diário — parte 1 (banco e site de administração)

Decisões de 2026-11-13 com o usuário; plano em `tasks/plano-boletim.md`, checklist em `tasks/todo.md` (seção "Boletim de Acompanhamento Diário"), prévia em `docs/mockups/boletim-diario-v2.pdf`.

Esta parte cria a base de dados do boletim e as telas de cadastro no site de administração. Ficam para as próximas partes: nome de exibição e observações no Mini App, coleta do INMET (`coletar-clima`), montagem do snapshot, PDF, envio ao Telegram e agendamento.

## Banco

Migration única: `supabase/migrations/20261113150000_boletim_base.sql`. Testes em `tests/db/test_boletim_base.py` (mesmo padrão de `tests/db/test_etapas.py`).

### `etapa`: identificação, localização e contrato

Colunas novas (todas opcionais no banco, porque a 2ª etapa já existe; as regras de criação ficam na RPC):

| Coluna | Tipo | Regra |
|---|---|---|
| `sigla` | text, **unique** | `^[A-Z0-9]{1,10}$`. Forma o número `BA<sigla>/…` |
| `endereco` | text | até 300 |
| `latitude`, `longitude` | double precision | −34…6 e −74…−28 (Brasil); as duas juntas ou nenhuma |
| `fuso` | text **not null** default `'America/Sao_Paulo'` | um destes: `America/Noronha`, `America/Belem`, `America/Fortaleza`, `America/Recife`, `America/Araguaina`, `America/Maceio`, `America/Bahia`, `America/Sao_Paulo`, `America/Campo_Grande`, `America/Cuiaba`, `America/Santarem`, `America/Porto_Velho`, `America/Boa_Vista`, `America/Manaus`, `America/Eirunepe`, `America/Rio_Branco` |
| `inmet_estacao`, `inmet_estacao_reserva` | text | `^[A-Z][0-9]{3}$` (ex.: `A305`); diferentes entre si |
| `boletim_horario` | time **not null** default `'23:30'` | hora local da emissão automática |
| `objeto` | text | até 600 (texto de OBRA/SERVIÇO) |
| `local` | text | até 300 (texto de LOCAL, pode ter quebra de linha) |
| `contratante` | text | até 200 |
| `contrato` | text | até 60 (ex.: `120/2025 - SOP`) |
| `contratada` | text | até 200 |
| `contratada_cnpj` | text | `^\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}$` |
| `os_numero` | text | até 40 |
| `os_data` | date | |
| `vigencia_meses` | int | 1…240 |
| `valor_original` | numeric(15,2) | ≥ 0 |
| `area_construida_m2` | numeric(12,2) | > 0 |

Migração dos dados: `2a-etapa` recebe `sigla = '2'` e `fuso = 'America/Fortaleza'`.

### Tabelas novas

```sql
public.etapa_aditivo (
  id uuid pk default gen_random_uuid(),
  etapa_id uuid not null references etapa on delete cascade,
  numero text not null,                 -- até 40, único por etapa
  data date not null,
  prazo_dias int not null default 0,    -- acréscimo (pode ser negativo: supressão)
  valor numeric(15,2) not null default 0, -- acréscimo (pode ser negativo)
  descricao text,                       -- até 300
  criado_em timestamptz not null default now(),
  criado_por uuid references usuario on delete set null
)

public.etapa_responsavel (
  etapa_id uuid references etapa on delete cascade,
  usuario_id uuid references usuario on delete cascade,
  funcao text not null default 'Fiscal',  -- até 60
  ordem int not null default 0,
  primary key (etapa_id, usuario_id)
)

public.inmet_estacao (                   -- lista de estações automáticas; preenchida pela parte 2 (coletar-clima)
  codigo text pk,                        -- ^[A-Z][0-9]{3}$
  nome text not null, uf text not null,  -- uf: 2 letras
  latitude double precision not null, longitude double precision not null,
  altitude double precision,
  operante boolean not null default true,
  atualizado_em timestamptz not null default now()
)

public.observacao (
  id uuid pk,                            -- gerado no cliente (idempotência, fila sem sinal)
  obra_id uuid not null references obra on delete cascade,
  autor_id uuid not null references usuario on delete cascade,
  data date not null,                    -- dia local (fuso da etapa da obra) de escrito_em
  texto text not null,                   -- 1…1000, sem espaços nas pontas
  escrito_em timestamptz not null,       -- hora do aparelho
  recebido_em timestamptz not null default now(),
  editado_em timestamptz
)
index (obra_id, data)

public.clima_dia (                       -- preenchida pela parte 2
  etapa_id uuid references etapa on delete cascade,
  data date,
  estacao text,
  horario jsonb not null,                -- lista de leituras horárias já convertidas
  resumo jsonb not null,
  obtido_em timestamptz not null default now(),
  primary key (etapa_id, data, estacao)
)

public.boletim (                         -- preenchida pelas próximas partes
  id uuid pk default gen_random_uuid(),
  etapa_id uuid not null references etapa on delete restrict,
  data date not null,
  revisao int not null default 0,        -- 0 = original; 1 = -R1 …
  numero text not null unique,
  snapshot jsonb not null,
  pdf_path text,                         -- caminho no bucket boletins: <etapa_id>/<numero sem barras>.pdf
  emitido_em timestamptz not null default now(),
  emitido_por uuid references usuario on delete set null,  -- null = automático
  unique (etapa_id, data, revisao)
)
```

`public.usuario.nome_exibicao text`: null ou 1…60 caracteres, igual a `upper()` dele mesmo, sem espaços nas pontas nem duplos. O `auth-telegram` continua atualizando só `nome` e `username` (conferir que o upsert não toca a coluna nova).

`public.organizacao.cabecalho text[] not null default '{}'`: até 4 linhas de 1…100 caracteres (subordinação acima do nome; ex.: `{"COMANDO DA AERONÁUTICA","DIRETORIA DE INFRAESTRUTURA DA AERONÁUTICA","COMISSÃO DE OBRAS DE FORTALEZA (CO-FZ)"}`). A migration preenche esse exemplo.

`etapa` excluída (`admin_excluir_etapa`) com boletins: a exclusão apaga os boletins da etapa antes (o `on delete restrict` protege contra apagar a etapa por outro caminho); os PDFs saem pela Edge Function de exclusão em uma parte futura (registrar como pendência no checklist, não implementar agora).

### Funções auxiliares (`privado`)

- `privado.codigo_om(p_nome text) → text`: maiúsculas, sem acentos (`translate` com os acentos do português; não usar a extensão `unaccent`), só `[A-Z0-9]`. `'CO-FZ'` → `'COFZ'`.
- `privado.numero_boletim(p_etapa uuid, p_data date, p_revisao int) → text`: `'BA' || sigla || '/' || to_char(p_data, 'YYMMDD') || '/' || codigo_om(organizacao.nome) || (case when p_revisao > 0 then '-R' || p_revisao else '' end)`. Etapa sem sigla → exceção 22023 "A etapa não tem sigla".
- `privado.data_local(p_obra uuid, p_instante timestamptz) → date`: dia no fuso da etapa da obra.
- `privado.nome_pessoa(p_usuario uuid) → text`: `coalesce(nome_exibicao, nome)`.
- `privado.boletim_emitido(p_etapa uuid, p_data date) → boolean`.

### RLS e grants

- `etapa_aditivo`, `etapa_responsavel`, `clima_dia`, `boletim`: `select` para admin ou participante de obra ativa da etapa (`privado.participa_da_etapa`); escrita só por RPC/service_role.
- `inmet_estacao`: `select` para admin; escrita só service_role.
- `observacao`: `select` para participante da obra (`privado.eh_participante(obra_id)`) ou admin; escrita só pelas RPCs abaixo.
- Bucket **privado** `boletins` (10 MB, `application/pdf` e `image/png` para a imagem do clima): leitura para participante da etapa do primeiro segmento do caminho (`<etapa_id>/…`) ou admin; escrita só service_role.

### RPCs do Mini App (authenticated)

| RPC | Entrada | Regras e retorno |
|---|---|---|
| `salvar_observacao(p jsonb)` | `{id, obra_id, texto, escrito_em}` | Participante de obra ativa. Novo id → insere (autor = `auth.uid()`, `data = data_local(obra, escrito_em)`). Id existente → só o autor edita o texto (`editado_em = now()`); `obra_id` e `escrito_em` não mudam. Repetir com o mesmo texto é idempotente. `escrito_em` no futuro (> 5 min) → 22023. Dia com boletim emitido → 22023 "O boletim de dd/mm/aaaa já foi emitido; a correção é feita por retificação". Retorno: `{id, obra_id, data, texto, escrito_em, editado_em, autor: {id, nome}}` (nome = `nome_pessoa`) |
| `excluir_observacao(p_id uuid)` | | Só o autor, só antes da emissão (mesmas mensagens). Id inexistente → idempotente (sem erro) |
| `observacoes_do_dia(p_obra uuid, p_data date default null)` | data null = hoje no fuso da etapa | Participante. Lista por `escrito_em`: `{id, data, texto, escrito_em, editado_em, autor: {id, nome}, minha: bool, travada: bool}` |
| `organizacao()` | | passa a devolver também `cabecalho` (array de texto) |

### RPCs do site (admin; `privado.exigir_admin()`)

| RPC | Entrada | Retorno |
|---|---|---|
| `admin_listar_pessoas()` | | jsonb: lista de `{id, nome, nome_exibicao, username, telegram_id, eh_admin, participacoes: [{obra_slug, obra_nome, etapa_nome, papel}]}` ordenada por `coalesce(nome_exibicao, nome)` |
| `admin_definir_nome_exibicao(p_usuario uuid, p_nome text)` | null ou só espaços tira o nome | Normaliza: `btrim`, espaços internos colapsados, `upper`. Mais de 60 → 22023. Usuário inexistente → P0002. Retorno `{id, nome, nome_exibicao}` |
| `admin_salvar_etapa(p jsonb)` | Além de `{id?, slug?, nome, ordem}`: `sigla, endereco, latitude, longitude, fuso, inmet_estacao, inmet_estacao_reserva, boletim_horario ("HH:MM"), objeto, local, contratante, contrato, contratada, contratada_cnpj, os_numero, os_data ("AAAA-MM-DD"), vigencia_meses, valor_original, area_construida_m2` | Na **criação**, `sigla`, `latitude`, `longitude` e `fuso` são obrigatórios (22023 com o nome do campo). Na **edição**, chave ausente = mantém; chave com `null` = apaga (exceto `fuso` e `boletim_horario`, que não aceitam null, e `sigla`, que não pode ser apagada depois de existir). Sigla repetida → 23505. Validações das colunas → 22023 com mensagem em português. Texto: `btrim`, vazio vira null. Retorno: o mesmo de `admin_obter_etapa` |
| `admin_obter_etapa(p_slug text)` | | `{id, slug, nome, ordem, arquivada_em, telegram_vinculado, telegram_chat_titulo, sigla, endereco, latitude, longitude, fuso, inmet_estacao, inmet_estacao_reserva, boletim_horario ("HH:MM"), objeto, local, contratante, contrato, contratada, contratada_cnpj, os_numero, os_data, vigencia_meses, valor_original, area_construida_m2, aditivos: [...], responsaveis: [{usuario_id, nome, nome_exibicao, funcao, ordem}], prazo: {termino_original, prazo_aditivos_dias, termino_atual, valor_atual} \| null, faltando: [nomes dos campos vazios entre sigla, localização (latitude/longitude), inmet_estacao, objeto, local, contratante, contrato, contratada, contratada_cnpj, os_numero, os_data, vigencia_meses, valor_original, area_construida_m2, responsaveis]}`. `prazo` só quando há `os_data` e `vigencia_meses`: término original = `os_data + vigencia_meses meses`, atual = original + soma de `prazo_dias`; valor atual = original + soma de `valor` (null sem valor original). Etapa inexistente → P0002 |
| `admin_salvar_aditivo(p jsonb)` | `{id?, etapa_id, numero, data, prazo_dias, valor, descricao}` | cria/edita; número repetido na etapa → 23505. Retorno: a linha |
| `admin_remover_aditivo(p_id uuid)` | | void; inexistente → P0002 |
| `admin_definir_responsaveis(p_etapa uuid, p jsonb)` | lista `[{usuario_id, funcao}]` na ordem desejada (vazia = nenhum) | substitui todos; usuário repetido ou inexistente → 22023/P0002; `funcao` vazia vira `'Fiscal'`. Retorno: a lista como em `admin_obter_etapa` |
| `admin_sugerir_estacoes(p_lat double precision, p_lon double precision, p_limite int default 5)` | | as estações operantes mais próximas: `[{codigo, nome, uf, latitude, longitude, distancia_km}]` (haversine, 1 casa decimal). Tabela vazia → `[]` |
| `admin_salvar_organizacao(p jsonb)` | aceita `cabecalho` (array de texto; `[]` limpa) | retorno ganha `cabecalho` |
| `admin_listar_etapas()` | | cada item ganha `sigla` e `faltando` (quantidade de campos de `faltando`) |

Erros: mesmos códigos já usados no projeto (42501 não admin, 22023 dado inválido, 23505 repetido, P0002 não encontrado), mensagens em português que o site mostra como estão.

## Site de administração

Rotas novas ou alteradas (`basename="/admin"`):

| Rota | Tela |
|---|---|
| `/pessoas` (novo item "Pessoas" na navegação, entre Etapas e Organização) | Tabela: nome de exibição (editável na linha: campo + Salvar; mostra em maiúsculas enquanto digita), nome do Telegram, @username, obras e papéis, selo "admin". Busca por qualquer nome. Sem nome de exibição: texto "usa o nome do Telegram" |
| `/nova-etapa` | Seções **Identificação** (nome, slug, ordem, sigla com prévia "Número do boletim: BA2/261111/COFZ" usando a data de hoje e o nome da OM), **Localização** (endereço; latitude e longitude num campo que aceita colar "−3.7610, −38.5297" ou dois campos; mapa de prévia por `iframe` do OpenStreetMap `https://www.openstreetmap.org/export/embed.html?bbox=…&marker=lat,lon`, com link "abrir no mapa"; fuso numa lista com rótulos legíveis, ex.: "Fortaleza (UTC−3)"; estação INMET e reserva: lista de sugestões de `admin_sugerir_estacoes` quando houver, senão campo de código com a ajuda "a lista de estações aparece depois da primeira coleta"; horário de emissão), **Dados do contrato** (todos os campos; valor em R$ com máscara brasileira; CNPJ com máscara). Obrigatórios marcados; botão Criar |
| `/etapas/:slug` | O mesmo formulário para editar, mais: **Responsáveis** (escolher pessoas da lista de `admin_listar_pessoas`, função, reordenar, remover; mostra o nome de exibição), **Aditivos** (tabela + adicionar/editar/remover; mostra término e valor atualizados de `prazo`), aviso "Faltam para o boletim: …" a partir de `faltando`, e as seções que já existem (grupo do Telegram, obras, arquivar/excluir) |
| `/` (Etapas) | cada etapa mostra a sigla e, se `faltando > 0`, o selo "cadastro incompleto" |
| `/organizacao` | ganha "Linhas do cabeçalho do boletim" (até 4 linhas, adicionar/remover/reordenar), com prévia do cabeçalho (logo + linhas + nome) |

`RepositorioAdmin` (Supabase e fixture) ganha: `listarPessoas`, `definirNomeExibicao`, `obterEtapa`, `salvarEtapa` (campos novos), `salvarAditivo`, `removerAditivo`, `definirResponsaveis`, `sugerirEstacoes`; `obterOrganizacao`/`salvarOrganizacao` com `cabecalho`. Fixture: a 2ª etapa com os dados do exemplo (sigla 2, Fortaleza, contrato 120/2025 - SOP etc.), três pessoas (uma com nome de exibição `CP PATRICIO`), um aditivo, a estação `A305` e mais duas estações para as sugestões.

Formatos de exibição: datas `dd/mm/aaaa`; valores `R$ 79.499.000,00`; área `86.102,17 m²`; coordenadas com 4 casas e vírgula decimal.

## Verificação

- `pytest -q tests/db` com os testes novos: regras das colunas; criação exige sigla, coordenadas e fuso; edição mantém/apaga; sigla repetida; `admin_obter_etapa` com `prazo` e `faltando`; aditivos e responsáveis; `numero_boletim` (`BA2/261111/COFZ`, `-R1`, sem sigla); `codigo_om`; nome de exibição normalizado e só por admin; observações (idempotência, só o autor edita, outra obra não lê, data no fuso da etapa, travada depois de existir boletim do dia); `organizacao()` com `cabecalho`; RLS das tabelas novas; `admin_sugerir_estacoes` ordenado por distância; exclusão de etapa com boletim.
- `npm run typecheck`, `npm run lint`, `npm test` (testes das telas novas com a fixture) e `npm run build` em `app/`.

---

# Parte 2: nome de exibição e observações no Mini App

Decisões de 2026-11-13 (ver `tasks/plano-boletim.md`, seções "Nome de exibição" e "Observações da obra"). A parte 1 já criou no banco `usuario.nome_exibicao`, `privado.nome_pessoa` e as RPCs `salvar_observacao`, `excluir_observacao` e `observacoes_do_dia` (aplicadas no `miniappcofz-dev`).

## Nome mostrado = `coalesce(nome_exibicao, nome)`

Em todo lugar onde o Mini App ou o bot mostram o nome de uma pessoa:

- **Mini App** (`app/src/dados/supabase.ts` e telas): autor dos registros (histórico do ambiente, aba Registros, últimos registros, pendências, detalhe da pendência), quem encerrou a pendência, pedidos de acesso e participantes vistos pelo gestor (`Acessos`, `Gestao`), observações. Consultas por PostgREST passam a pedir `usuario(nome, nome_exibicao)` e o app escolhe; RPCs do banco que devolvem nome de pessoa ao Mini App passam a usar `privado.nome_pessoa` (nova migration `supabase/migrations/20261114090000_nome_exibicao_mini_app.sql`, recriando só as RPCs necessárias, sem mudar assinatura nem formato). O site de administração continua mostrando o nome do Telegram onde já mostra, exceto onde a parte 1 definiu o contrário.
- **Telegram** (`supabase/functions/publish-outbox`): autor do registro e quem encerrou a pendência usam o nome de exibição; o aviso de pedido de acesso usa o nome de exibição (se houver) e mantém o `@username`.
- A pessoa vê o próprio nome de exibição onde o app mostra "você"/o usuário logado, se mostrar.
- Fixture do Mini App: pelo menos uma pessoa com nome de exibição (ex.: `CP PATRICIO`) e uma sem, para os testes.

## Cartão "Observações do dia" na página da obra (`app/src/telas/Obra.tsx`)

- Acima da lista de ambientes (abaixo do cabeçalho da obra), cartão **Observações do dia** com a data de hoje (`observacoes_do_dia(obra, null)`, que usa o fuso da etapa). Lista por hora: `HH:MM · NOME` e o texto; marca "editada" quando `editado_em`. Vazio: "Nenhuma observação hoje." Mais de 3: mostra as 3 últimas e "Ver todas (n)".
- **Adicionar observação**: campo de texto (até 1000 caracteres, contador perto do limite) e botão Salvar. Gera o `id` (UUID) no aparelho e `escrito_em = agora`.
- **Sem sinal**: a observação nova é gravada no aparelho (IndexedDB, mesma infraestrutura de `app/src/offline/`) antes de aparecer como "aguardando envio" e é enviada pela mesma sincronização dos registros (ao abrir, evento `online`, voltar ao app, "Tentar agora"), com o mesmo `id` em toda tentativa (a RPC é idempotente). Rascunhos isolados por usuário, como os registros.
- **Editar/excluir**: só as próprias (`minha`) e só se `travada = false`; exigem conexão (sem sinal, os botões ficam desabilitados com a dica "Precisa de conexão"). Excluir pede confirmação.
- **Travada** (boletim do dia já emitido): sem botões de editar/excluir/adicionar; aviso "O boletim de hoje já foi emitido. Correções são feitas por retificação."
- Erros da RPC: 22023 do dia emitido numa observação da fila → estado de falha definitiva com a mensagem do servidor e as opções "Descartar" (e copiar o texto); demais erros seguem o backoff da fila.
- Cache de consultas no aparelho como as demais telas (a lista do dia aparece sem sinal com o que já foi visto).
- Fixture: duas observações de hoje em uma obra (uma do usuário de teste, outra de `CP PATRICIO`) e suporte às três RPCs.

## Verificação

- Testes de banco (`tests/db/`) das RPCs recriadas devolvendo o nome de exibição.
- Deno (`supabase/functions/publish-outbox`): mensagens com nome de exibição e com fallback para o nome do Telegram.
- Vitest: cartão (lista, adicionar, editar, excluir, travada, sem sinal), fila com observação, nome de exibição nas telas.
- Playwright (fixture, viewport de celular): adicionar observação online; offline → salvar → voltar o sinal → enviada sem duplicar.

---

# Parte 3: geração, emissão e envio do boletim

Decisões de 2026-11-13: emissão automática no horário da etapa, retificação pelo site; clima = imagem da linha da estação na tabela "Últimas 24 horas" do Observatório de Fortaleza (Montese `8836`, reserva Benfica `9281`), copiada na emissão. Prévia visual em `docs/mockups/boletim-diario-v2.pdf` (o layout do PDF segue a prévia; a seção de clima passa a ser a imagem copiada com a legenda da fonte).

## Fluxo

1. **Agendamento (banco):** pg_cron a cada 5 min chama `privado.agendar_boletins()`. Para cada etapa ativa com sigla, quando a hora local (fuso da etapa) passou de `boletim_horario` e ainda não há boletim nem pedido de emissão para a data local de hoje, cria um pedido em `boletim_emissao` e chama o gerador (`privado.disparar_gerador()`, igual a `disparar_publicacao`: `net.http_post` para o segredo do Vault `url_gerador_boletim` com o cabeçalho `x-segredo-interno`; sem o segredo no Vault, não faz nada). Pedidos pendentes com `proxima_tentativa` vencida também disparam o gerador.
2. **Gerador (Vercel, `app/api/gerar-boletim.ts`):** confere `x-segredo-interno` (lê o segredo pela RPC `segredo_interno` com a chave secreta, como `supabase/functions/_shared/segredo.ts`), reivindica pedidos (`reivindicar_emissoes`), e para cada um: lê o snapshot (`boletim_snapshot`), copia o clima, baixa e reduz as fotos, monta o HTML, gera o PDF, envia PDF e imagem do clima ao bucket `boletins` e chama `concluir_emissao` (grava o boletim e enfileira o envio ao Telegram). Erro → `falhar_emissao` (nova tentativa com espera crescente: 5, 10, 20, 40 min…, até 8 tentativas; depois `falhou`, visível no site).
3. **Telegram (`publish-outbox`):** publicação de boletim → `sendDocument` (o PDF) no grupo da etapa (`etapa.telegram_chat_id`, tópico Geral, sem `message_thread_id`), legenda `📄 <b>Boletim BA2/261113/COFZ</b>\n2ª ETAPA · 13/11/2026` (+ `· retificação R1` quando for o caso). Etapa sem grupo → espera, como obra sem tópico.

## Banco (migration `supabase/migrations/20261114120000_boletim_emissao.sql`; testes `tests/db/test_boletim_emissao.py`)

**Estações do Observatório:** `etapa.inmet_estacao`/`inmet_estacao_reserva` passam a `estacao`/`estacao_reserva`, texto `^[0-9]{3,6}$` (diferentes entre si); a `2a-etapa` recebe `8836`/`9281`; na criação, se não vierem, assumem `8836`/`9281`. `admin_salvar_etapa`, `admin_obter_etapa`, `etapa_faltando` (`estacao` no lugar de `inmet_estacao`) e o retorno passam a usar os nomes novos. Saem `public.inmet_estacao`, `admin_sugerir_estacoes` e `clima_dia` (sem uso). Lista fixa das estações (só no site): 3318 Dom Lustosa, 8642 Centro, 8836 Montese, 8869 Vila Velha, 9134 Conjunto Esperança, 9137 Mucuripe, 9169 Messejana, 9242 Guararapes, 9249 Jangurussu, 9281 Benfica, 9282 Granja Lisboa.

**`boletim_emissao`** (fila): `id bigint identity pk, etapa_id → etapa (cascade), data date, revisao int, estado text ('pendente'|'gerando'|'emitido'|'falhou'), tentativas int default 0, proxima_tentativa timestamptz default now(), erro text, pedido_por uuid → usuario (null = automático), criado_em, atualizado_em, boletim_id uuid → boletim (null até emitir); unique (etapa_id, data, revisao)`. Sem acesso direto; leitura pelas RPCs do site.

**RPCs do gerador (service_role):**
- `reivindicar_emissoes(p_limite int default 3)` → `[{id, etapa_id, data, revisao, numero}]`: pega pendentes com `proxima_tentativa <= now()` (`for update skip locked`), passa a `gerando`, soma 1 em `tentativas`; `numero = numero_boletim(etapa, data, revisao)`. Pedido em `gerando` há mais de 15 min volta a ser reivindicável.
- `boletim_snapshot(p_etapa uuid, p_data date)` → jsonb (formato abaixo). Também `admin_boletim_snapshot(p_slug text, p_data date)` (admin) para a prévia.
- `concluir_emissao(p_id bigint, p_snapshot jsonb, p_pdf_path text)` → `{boletim_id, numero}`: insere `boletim` (número, revisão, snapshot com o clima, `pdf_path`, `emitido_por = pedido_por`), marca o pedido `emitido`, enfileira a publicação do boletim e chama `disparar_publicacao`. Idempotente (pedido já emitido → devolve o boletim existente).
- `falhar_emissao(p_id bigint, p_erro text)` → reagenda ou marca `falhou` (8 tentativas).

**`publicacao_telegram`** ganha `boletim_id uuid → boletim (cascade)` (e o `check` de "registro ou encerramento" passa a aceitar boletim; `obra_id` pode ser null quando for boletim — ajustar o que depender disso, inclusive `reivindicar_publicacoes`, que passa a devolver `boletim_id`).

**RPCs do site (admin):**
- `admin_listar_boletins(p_slug text)` → `[{id, data, revisao, numero, emitido_em, emitido_por_nome, pdf_path, publicado: bool}]` e `pedidos: [{id, data, revisao, estado, tentativas, erro, atualizado_em}]` (os não emitidos), mais recentes primeiro.
- `admin_pedir_emissao(p_slug text, p_data date)` → cria pedido manual (`pedido_por = auth.uid()`): sem boletim na data → revisão 0; com boletim → retificação (revisão = maior + 1). Data no futuro → 22023; pedido pendente/gerando para a mesma data → 23505. Dispara o gerador.
- Bucket `boletins`: admin já lê (parte 1); o site abre o PDF por URL assinada.

**Snapshot** (`boletim_snapshot`, datas no fuso da etapa; instantes em ISO; nomes por `privado.nome_pessoa`):
```
{ "versao": 1, "data": "2026-11-13", "fuso": "America/Fortaleza",
  "organizacao": {"nome", "cabecalho": [..], "logo_path"},
  "etapa": {<campos de admin_obter_etapa exceto aditivos/faltando>, "aditivos": [..],
            "prazo": {.., "dias_decorridos", "dias_totais", "percentual", "dias_restantes"}},
  "responsaveis": [{"nome", "funcao"}],
  "indicadores": {
    "pendencias": {"abertas_inicio", "abertas_no_dia", "encerradas_no_dia", "abertas_fim",
                   "total_abertas", "total_encerradas", "taxa_resolucao", "mais_7", "mais_15", "mais_30",
                   "tempo_medio_resolucao_dias"},
    "atividade": {"registros_servico", "fotos", "ambientes", "pessoas"},
    "por_obra": [{"obra", "servicos", "abertas_no_dia", "encerradas_no_dia", "abertas_fim", "mais_15"}] },
  "obras": [{"id", "nome", "slug",
     "servicos": [{"id", "pavimento", "ambiente", "hora", "autor", "legenda", "fotos": [{"path", "largura", "altura"}]}],
     "pendencias_abertas": [ mesmo formato ],
     "pendencias_encerradas": [{"id", "pavimento", "ambiente", "aberta_em", "dias_aberta", "legenda",
         "fotos_registro": [..], "encerramento": {"hora", "autor", "observacao", "fotos": [..]}}],
     "observacoes": [{"hora", "autor", "texto", "editada": bool}] }],
  "tardios": [{"tipo": "servico|pendencia|encerramento|observacao", "data", "obra", "ambiente", "autor", "texto"}],
  "clima": null }
```
Regras: dia = `[data 00:00, data+1 00:00)` no fuso da etapa, por `registro.capturado_em`, `encerramento.encerrado_em` e `observacao.data`. "Abertas no início/fim" pelas datas (não pela `situacao` atual). Envelhecimento sobre as abertas no fim do dia. Tempo médio de resolução sobre todos os encerramentos até o fim do dia. Ordem: obra (`ordem`, nome), pavimento, ambiente, hora. "Tardios": lançamentos de dias anteriores recebidos depois da emissão do boletim daquele dia e ainda não listados em outro boletim. O gerador preenche `clima`: `{"fonte": "Observatório de Riscos Climáticos de Fortaleza (Prefeitura de Fortaleza)", "estacao": {"codigo", "nome"}, "leitura": "há 12 min"|"HH:MM", "copiado_em", "imagem_path"}` ou `{"indisponivel": true, "motivo"}`.

**Agendamento:** `cron.schedule('agendar-boletins', '*/5 * * * *', ...)` (mesmo padrão do `publish-outbox`). Segredo novo no Vault: `url_gerador_boletim` (URL completa do gerador; criado na aplicação, não na migration).

**`publish-outbox`** (`supabase/functions/publish-outbox/`): trata publicação com `boletim_id` (baixa o PDF de `boletins`, `sendDocument` com a legenda acima; resposta e erros como as demais publicações). Testes Deno.

### Reenvio ao Telegram e clima de boletim anterior (`20261114150000_boletim_reenvio_clima.sql`; testes `tests/db/test_boletim_reenvio_clima.py`)

- `admin_reenviar_boletim(p_slug, p_boletim) → {boletim_id, publicacao_estado: 'pendente'}` (admin): o boletim
  tem de ser da etapa (senão `P0002` "Boletim não encontrado") e a etapa precisa de grupo (senão `22023`
  "A etapa não tem grupo do Telegram vinculado"). Trava a linha de `publicacao_telegram`: `falhou` ou `incerto`
  voltam a `pendente` (tentativas 0, erro nulo, `proxima_tentativa_em = now()`) e a publish-outbox é acionada;
  `pendente`/`enviando` → `23505` "O envio deste boletim já está em andamento"; `publicado` → `22023` "Este
  boletim já foi publicado no grupo"; sem linha, cria a pendente. No site, o botão "Reenviar ao Telegram" aparece
  em `falhou` e `incerto` (neste, antes pede confirmação: pode duplicar a mensagem).
- `admin_listar_boletins` passa a trazer, em cada boletim, `publicacao_erro` e `publicacao_tentativas` (0 sem linha).
- `boletim_clima_anterior(p_etapa, p_data) → {numero, revisao, clima} | null` (só `service_role`, para o gerador):
  o boletim de maior revisão da data cujo `snapshot->'clima'->>'imagem_path'` não é nulo; `clima` é o
  `snapshot->'clima'`. Climas indisponíveis são ignorados. No gerador, quando a data não cabe nas
  últimas 24 horas do Observatório (`climaCabeNoDia` falso), `montarBoletim` consulta a RPC, baixa a imagem
  de `boletins/<imagem_path>` e usa o clima com `reaproveitado_de` (número do boletim de origem) e
  `imagem_path` nulo; a emissão envia a cópia para `<etapa>/<numero>-clima.png` e grava o novo caminho. A
  legenda do PDF cita o boletim de origem. Sem anterior, ou com falha na consulta/download (só registrada no
  log), o clima sai indisponível. A prévia também reaproveita.

## Gerador (Vercel, em `app/`)

- Funções Node em `app/api/`: `gerar-boletim.ts` (POST, segredo interno; processa a fila) e `previa-boletim.ts` (GET `?etapa=<slug>&data=AAAA-MM-DD`, cabeçalho `Authorization: Bearer <JWT do admin>`; confere `sou_admin` com o JWT; devolve o PDF com a marca "PRÉVIA — sem número" e sem gravar nada). Código compartilhado em `app/servidor/boletim/` (fora do bundle do Vite): `template.ts` (HTML/CSS do boletim a partir do snapshot, no layout da prévia v2, fonte Liberation/Times, A4, rodapé com número e paginação), `clima.ts` (captura), `fotos.ts` (download pelo Storage com a chave secreta e redução para 1000 px no lado maior, JPEG ~75%, embutidas no HTML), `pdf.ts` (Chromium headless: `@sparticuz/chromium` + `playwright-core` na Vercel; Chromium local nos testes).
- **Captura do clima** (`clima.ts`): abre `https://observatorio.fortaleza.ce.gov.br/riscos-climaticos/estacoes-meteorologicas` (locale `pt-BR`, fuso `America/Fortaleza`, 1280 px), espera a tabela "Últimas 24 horas", localiza a linha `tr` que contém `button.est-tabela-estacao[data-estacao="<codigo>"]` (a última tabela que tiver essa linha) e tira a imagem só dela (escala 2). Lê "há N min" da linha; mais de 180 min, linha ausente ou erro → tenta a reserva; sem nenhuma → `{indisponivel: true, motivo}`. Tempo máximo total de 40 s.
- **Configuração da Vercel** (`app/vercel.json`): `functions` com memória e `maxDuration` suficientes (Chromium); as rotas `/api/*` não podem cair nos `rewrites` do SPA. Variáveis de ambiente (sem valores no Git; documentar em `app/.env.example`): `SUPABASE_URL`, `SUPABASE_SECRET_KEY`.
- **Site de administração:** na página da etapa, a estação vira um seletor com a lista fixa (principal e reserva); seção **Boletins** (`/etapas/:slug/boletins` ou seção na página): lista dos emitidos (número, data, emitido em, por, publicado no Telegram, botão "Abrir PDF" por URL assinada), pedidos pendentes/com falha (com o erro), "Pré-visualizar" (escolhe a data; abre o PDF da prévia) e "Emitir agora / Emitir retificação" para uma data (confirmação explicando número e envio ao grupo). `RepositorioAdmin`: `listarBoletins`, `pedirEmissao`, `urlPdfBoletim`, `previaBoletim`; fixture.

## Verificação

- `pytest -q tests/db`: snapshot com um dia montado (serviços, pendências abertas e encerradas, observações, tardios, fuso), indicadores, fila (reivindicar, concluir idempotente, falhar com espera e limite), agendamento (antes/depois do horário, sem sigla, já emitido), pedido manual e retificação, publicação de boletim na fila.
- Deno: `publish-outbox` envia documento ao grupo da etapa.
- Vitest: template com um snapshot de exemplo (cabeçalho, número, seções, clima indisponível); captura com uma cópia reduzida da página gravada nos testes (linha certa, leitura antiga → reserva, ausente → indisponível); telas do site.
- Gerar localmente um PDF de exemplo a partir de um snapshot de teste e da captura real da página (Chromium pré-instalado) e conferir visualmente.
