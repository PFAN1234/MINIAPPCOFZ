# Contrato: etapas, organização militar e nome "Fiscal Bot"

Decisões de 2026-11-12 com o usuário. Checklist em `tasks/todo.md` (seção "Etapas e organização").

## Objetivo

O campus é implantado em várias **etapas**; cada etapa tem várias obras e **um grupo do Telegram, com um tópico por obra**. O site de administração passa a gerenciar todas as etapas (criar, editar, arquivar, excluir com as obras) e a identidade da organização militar (nome e logo). O app passa a se chamar **Fiscal Bot**.

## Decisões

| Tema | Decisão |
|---|---|
| Nome do app | "Fiscal Bot" no lugar de "Diário da obra" em telas, títulos, textos do bot e documentação viva (README, `docs/admin.md`). Contratos de fases antigas, mockups e planos antigos não são reescritos. O nome do bot e do Mini App no BotFather é trocado pelo usuário. |
| Tela inicial do Mini App | Seletor de etapa no topo: mostra as obras de uma etapa por vez e lembra a última escolhida. Com uma etapa só, o nome dela aparece sem seletor. |
| Grupo da etapa | Comando `/vincular_etapa <slug>` no grupo (admin do grupo). `/vincular_obra` só funciona depois, e só em tópico do grupo da etapa da obra. |
| Logo e nome da OM | Faixa fina no topo de **todas** as telas do Mini App (logo à esquerda, nome da OM e "Fiscal Bot") e na barra do site de administração. Configurados em `/admin/organizacao`. |
| Obras existentes | Todas entram na etapa "2ª ETAPA" (slug `2a-etapa`). |
| Arquivar etapa | Reversível. Vale como arquivar todas as obras dela, sem mexer no `arquivada_em` de cada obra: desarquivar a etapa devolve cada obra ao estado que tinha. |
| Excluir etapa | Irreversível, apaga a etapa e todas as obras dela (dados e arquivos). Confirmação digitando o nome da etapa, com a lista do que será apagado, como na exclusão de obra. |

## Banco

Migration `supabase/migrations/20261112180000_etapas.sql`.

### Tabelas

```sql
public.etapa (
  id uuid pk default gen_random_uuid(),
  slug text not null unique,            -- ^[a-z0-9-]+$, até 40
  nome text not null,                   -- até 120
  ordem int not null default 0,
  telegram_chat_id bigint unique,       -- grupo da etapa; null = sem grupo
  telegram_chat_titulo text,            -- título do grupo na hora do vínculo
  arquivada_em timestamptz,
  arquivada_por uuid references usuario on delete set null,
  criado_em timestamptz not null default now()
)
public.obra.etapa_id uuid not null references etapa (id) on delete restrict
public.organizacao (               -- linha única
  id boolean pk default true check (id),
  nome text not null default 'CO-FZ',   -- até 80
  logo_path text,                       -- caminho no bucket `organizacao`; null = sem logo
  atualizado_em timestamptz, atualizado_por uuid references usuario on delete set null
)
public.obra_excluida.etapa_nome text    -- preenchido quando a obra saiu junto com a etapa
```

- Migração dos dados: cria `2a-etapa` / "2ª ETAPA" e põe todas as obras nela. Se as obras já vinculadas apontam todas para o mesmo `telegram_chat_id`, a etapa herda esse grupo (título null).
- RLS de `etapa`: leitura para quem participa de alguma obra não arquivada da etapa (etapa não arquivada) e para admin. Escrita só por RPC.
- `organizacao`: sem acesso direto; leitura pela RPC `organizacao()`.
- Bucket **público** `organizacao` (1 MB; `image/png`, `image/jpeg`, `image/webp`). Admin insere, atualiza e apaga (`privado.eh_admin()`). Caminho: `logo-<16 hex>.<png|jpg|webp>` (nome novo a cada troca, para não ficar em cache).

### Obra "ativa"

Em todo lugar que hoje confere `obra.arquivada_em is null` (funções `privado.eh_participante`, `eh_gestor`, `divide_obra_com`; `obras_disponiveis`, `solicitar_acesso`, `sincronizar_acesso`, `vincular_obra`, `reivindicar_publicacoes`; políticas que citem a coluna), passa a valer: **obra não arquivada e etapa não arquivada**. Desarquivar a etapa recoloca na fila as publicações pendentes das obras dela (como `admin_arquivar_obra`).

### RPCs do Mini App (authenticated)

- `organizacao()` → `{ "nome": text, "logo_path": text|null }`. Também para `anon` (a tela de entrada do site mostra o logo).
- `obras_disponiveis()` ganha as colunas `etapa_id uuid, etapa_nome text, etapa_ordem int`.
- A lista de obras continua vindo de `obra` por RLS; o app passa a pedir `etapa(id, slug, nome, ordem)` embutida.

### RPCs do site (admin; `privado.exigir_admin()`)

| RPC | Entrada | Retorno |
|---|---|---|
| `admin_listar_etapas()` | | jsonb: lista de `{id, slug, nome, ordem, arquivada_em, telegram_vinculado, telegram_chat_titulo, obras, obras_arquivadas}` por `ordem, nome` |
| `admin_salvar_etapa(p jsonb)` | `{id?, slug?, nome, ordem}`; sem `id` cria (slug obrigatório; repetido → 23505), com `id` edita nome e ordem | `{id, slug, nome, ordem}` |
| `admin_arquivar_etapa(p_slug, p_arquivada)` | | `{slug, arquivada_em}`; idempotente |
| `admin_desvincular_etapa(p_slug)` | | void. Limpa o grupo da etapa e `telegram_chat_id`/`telegram_thread_id` das obras dela |
| `admin_resumo_etapa(p_slug)` | | `{obras: [{slug, nome}], total: <mesmo formato de admin_resumo_obra, somado>}` |
| `admin_excluir_etapa(p_slug, p_confirmacao)` | confirmação = nome da etapa (só espaços das pontas ignorados; senão 22023) | `{etapa_id, exclusoes: [uuid…], resumo}`. Para cada obra: linha em `obra_excluida` (com `etapa_nome`) e a mesma remoção de `admin_excluir_obra`; depois apaga a etapa. Etapa sem obras também pode ser excluída |
| `admin_salvar_organizacao(p jsonb)` | `{nome, logo_path}` (`logo_path` null tira o logo; se informado, precisa existir no bucket e seguir o formato) | `{nome, logo_path}` |
| `admin_listar_obras()` | | ganha `etapa_id, etapa_slug, etapa_nome, etapa_arquivada_em` |
| `admin_obter_obra(slug)` | | `obra` ganha `etapa: {id, slug, nome, arquivada_em, telegram_vinculado}` |
| `admin_salvar_obra(p)` | ganha `etapa_id`: obrigatório ao criar; ao editar, se vier, move a obra | Ao mover para etapa cujo grupo é diferente do `telegram_chat_id` da obra, o vínculo da obra com o tópico é apagado |
| `admin_listar_exclusoes()` | | cada item ganha `etapa_nome` |

### RPCs do bot (service_role)

- `vincular_etapa(p_slug text, p_chat bigint, p_titulo text)` → `public.etapa` (null se o slug não existe). 22023, com a mensagem que o bot repete no grupo, quando: etapa arquivada; o grupo já é de outra etapa; a etapa já tem outro grupo (pede para desvincular no site). Mesmo grupo de novo: atualiza o título.
- `vincular_obra(p_slug, p_chat, p_thread)`: além do que já faz, 22023 quando a etapa da obra não tem grupo ("Vincule antes a etapa: /vincular_etapa <slug>") ou tem outro grupo ("A obra X é da etapa Y, que usa outro grupo").

## Edge Functions

- `bot-webhook`: comando `/vincular_etapa <slug>` (só em supergrupo; só admin do grupo; em qualquer tópico); entra no `setMyCommands` dos admins de grupo. Textos com "Fiscal Bot".
- `publish-outbox`: só os textos (nome do app).
- `admin-excluir-obra`: nova ação para etapa. Corpo `{ "acao": "excluir_etapa", "slug", "confirmacao" }`; chama `admin_excluir_etapa` com o JWT do admin e limpa o Storage de cada exclusão devolvida, como já faz para uma obra. Resposta: `{ exclusoes: [{exclusao_id, removidos, pendente, erro}], pendente: boolean, erro: string|null }`. O corpo e a resposta das ações existentes não mudam.

## Site de administração

Rotas (`basename="/admin"`):

| Rota | Tela |
|---|---|
| `/` | **Etapas**: cada etapa ativa com a tabela das obras dela, "Nova obra" (já na etapa) e link para a página da etapa; botão "Nova etapa"; etapas arquivadas em seção própria; "Obras excluídas" como hoje (com a etapa, quando houver) |
| `/nova-etapa` | slug, nome, ordem |
| `/etapas/:slug` | nome e ordem; grupo do Telegram (vinculado a "título" / instrução `/vincular_etapa <slug>`; botão desvincular com confirmação); obras da etapa; "Arquivar ou excluir" |
| `/nova-obra?etapa=<slug>` | como hoje, com o seletor de etapa |
| `/obras/:slug…` | como hoje; mostra a etapa (link), permite mudar de etapa e avisa quando a etapa está arquivada |
| `/organizacao` | nome da OM e logo (enviar, pré-visualizar, remover) |
| `/admins` | como hoje |

Barra do topo: logo da OM, nome da OM, "Fiscal Bot · Administração"; navegação Etapas / Organização / Admins.

Excluir etapa: mesmo desenho do excluir obra (`telas/obra/ArquivarExcluir.tsx`): alerta com as obras e as contagens que serão apagadas, campo para digitar o nome da etapa, botão habilitado só quando confere; depois volta para `/` com o aviso (inclusive quando sobraram arquivos no Storage).

`RepositorioAdmin` ganha: `listarEtapas`, `salvarEtapa`, `arquivarEtapa`, `desvincularEtapa`, `resumoEtapa`, `excluirEtapa`, `obterOrganizacao`, `salvarOrganizacao`, `enviarLogo` (envia ao bucket e devolve o caminho). Fixture e Supabase.

## Mini App

- Faixa de identidade em todas as telas, no `TopoTela`, acima do "Voltar"/título: logo (28 px de altura, se houver), nome da OM e "Fiscal Bot". Sem logo, só os textos.
- Tela inicial: título "Obras"; seletor de etapa no topo (as etapas das obras da pessoa e das "Outras obras" que ela pode pedir), ordenado por `ordem, nome`; a escolha fica no aparelho (`localStorage`); etapa guardada que sumiu → primeira da lista. A lista de obras, a busca e "Outras obras" seguem a etapa escolhida. "Últimos registros" e as abas Registros e Pendências continuam com todas as obras.
- Organização: hook `useOrganizacao()` (RPC `organizacao`), guardada no cache de consultas do aparelho como as demais; URL pública do logo `…/storage/v1/object/public/organizacao/<logo_path>`.
- Fixture: organização "CO-FZ" sem logo; pelo menos duas etapas para os testes do seletor.
