# Contrato — Central de modelos (admin › Modelos)

Spec da página `/modelos` do site de administração. Plano e decisões: `tasks/plano-central-modelos.md`. Os nomes de classes da That Open abaixo são os esperados no v3 e são confirmados no spike (etapa 0); divergências atualizam este documento antes da implementação.

## 1. Rotas e navegação

| Rota | Conteúdo |
| --- | --- |
| `/modelos` | Lista de obras com pelo menos um modelo ou documento publicado: nome, nº de disciplinas, nº de documentos, issues abertas, última atualização. Busca por nome. Obras sem nada ficam num grupo recolhido "Sem arquivos", com ação "Enviar primeiro modelo". |
| `/modelos/:slug` | Visualizador da obra. Query string opcional: `?painel=itens\|documentos\|issues\|medicoes\|gestao`, `?issue=<numero>`, `?doc=<id>`. |
| `/obras/:slug/modelos` | `<Navigate replace to="/modelos/:slug?painel=gestao" />`. |

- Menu: `<NavLink to="/modelos">Modelos</NavLink>` logo depois de "Manutenção". Os testes que conferem a ordem dos links (`Pessoas.test.tsx`, `Organizacao.test.tsx`) passam a incluir "Modelos".
- O visualizador é `React.lazy`; Three, That Open e workers não entram no bundle inicial do admin nem no precache do mini app.

## 2. Layout e tema

```text
┌ header do admin ───────────────────────────────────────────────────────────┐
├──┬──────────────────┬──────────────────────────────────────────────────────┤
│T │ Painel (Itens,   │ [barra superior: projeção · cor · modelos · issues · │
│r │ Documentos,      │  medir · cortar · captura · obra]   (Carregando…)    │
│i │ Issues, Medições,│                                                      │
│l │ Gestão)          │                     canvas 3D                        │
│h ├──────────────────┤                                                      │
│o │ Contexto (obra,  │        [Ver | Inspecionar]                 eixos/cubo│
│  │ seleção, docs)   │  [Selecionado ◇ ⊘ 👁 ▣ ◎ ↺ | Caminhar]               │
└──┴──────────────────┴──────────────────────────────────────────────────────┘
```

- Tela cheia abaixo do header (o `main` da página não usa a largura máxima do admin). Painel esquerdo redimensionável e recolhível; abaixo de 1024 px os painéis viram gavetas sobre o canvas.
- Trilho: Itens, Documentos, Issues, Medições, Gestão; no rodapé, Configurações (tema, qualidade de render).
- Tema: tokens CSS em `.central[data-tema="escuro"|"claro"]`; escuro é o padrão. Preferência em `localStorage` (`central.tema`), com leitura e escrita em `try/catch`. O fundo do canvas, o grid e o contorno seguem o tema. Paleta escura de referência: fundo `#16161a`, painel `#1e1e24`, borda `#2c2c34`, texto `#e6e6ea`, secundário `#9a9aa5`, acento `#7c4dff` (abas e botão ativo), alerta `#ff8a3d` (marcadores de issue).
- Acessibilidade: todos os botões da barra com `aria-label` e `aria-pressed`; abas com `role="tablist"`; atalhos de teclado (Esc limpa a seleção, H oculta, I isola, F enquadra, Del apaga a medição ou o corte selecionado).

## 3. Arquitetura

```text
apps/admin/AdminApp.tsx ── rota /modelos ──► modules/modelos/presentation/admin/central/
                                              CentralModelos.tsx (lista) · CentralObra.tsx (lazy)
                                              paineis/{Itens,Propriedades,Documentos,Issues,Medicoes,Gestao}.tsx
                                              barras/{BarraSuperior,BarraVisibilidade}.tsx
                                              central.css
modules/modelos/application/ports/MotorVisualizador.port.ts   ◄── React só fala com a porta
modules/modelos/infra/thatopen/motor.ts                       ◄── única pasta que importa OBC/OBF/three
modules/documentos/{domain,application/ports,infra,presentation/admin}
modules/issues/{domain,application/ports,infra,presentation/admin}   (inclui bcf.ts)
```

- Segue `docs/padrao-contexto-modulo.md`: portas segregadas com contract test, adaptadores Supabase e fixture, fronteiras do ESLint em `error`.
- `documentos` e `issues` não importam `three`: a vista da issue e os vínculos usam tipos puros (`Vista`, `RefElemento`).
- Dependência nova: `@thatopen/components-front` 3.6.1, versão exata (peer `potree-core` é opcional e não é instalado).

### 3.1 Porta `MotorVisualizador`

```ts
type RefElemento = { sigla: string; globalId: string; classe?: string; nome?: string }
type Vista = {
  camera: { posicao: [number, number, number]; alvo: [number, number, number]; projecao: 'perspectiva' | 'ortografica'; campo?: number }  // campo: fov (graus) na perspectiva; altura visível (m) na ortográfica
  cortes: { origem: [number, number, number]; normal: [number, number, number] }[]
  selecionados: RefElemento[]; ocultos: RefElemento[]; isolados: RefElemento[] | null
  cores?: { refs: RefElemento[]; cor: string }[]
}
interface MotorVisualizador {
  montar(el: HTMLElement, tema: 'escuro' | 'claro'): Promise<void>
  carregar(modelos: { sigla: string; dados: Uint8Array }[], progresso: (f: number) => void): Promise<void>
  descarregar(sigla: string): void
  arvore(): Promise<NoArvore[]>                 // projeto › edifício › pavimento › elementos
  categorias(): Promise<{ classe: string; total: number }[]>
  propriedades(ref: RefElemento): Promise<GrupoPropriedades[]>
  buscar(filtro: FiltroAtributo): Promise<RefElemento[]>
  selecionar(refs: RefElemento[]): void
  ocultar(refs: RefElemento[]): void; isolar(refs: RefElemento[]): void; mostrarTudo(): void
  fantasma(ligado: boolean): void
  colorirPor(modo: 'nenhum' | 'categoria' | 'disciplina'): void
  enquadrar(refs?: RefElemento[]): void
  projecao(p: 'perspectiva' | 'ortografica'): void
  vistaPlanta(pavimento: string): void; vistaElevacao(lado: 'N' | 'S' | 'L' | 'O'): void; vista3d(): void
  caminhar(ligado: boolean): void
  cortes: { criar(): void; apagar(id?: string): void; listar(): Corte[] }
  medir: { modo(m: 'distancia' | 'area' | 'volume' | 'angulo' | null): void; listar(): Medida[]; apagar(id?: string): void }
  origemCena(): Ponto3   // deslocamento da cena: mundo = cena + origem (coordenadas do modelo-base); [0,0,0] sem modelo
  vistaAtual(): Vista; aplicarVista(v: Vista): Promise<void>
  capturar(): Promise<Blob>                     // PNG da vista atual
  marcadores(itens: { id: string; posicao: [number, number, number]; rotulo: string }[]): void
  ao(evento: 'selecao' | 'medicao' | 'marcador', cb: (dados: unknown) => void): () => void
  liberar(): void                               // dispose de world, fragments, worker e listeners
}
```

Estados da tela: sem WebGL, carregando (com progresso por disciplina), erro por disciplina (as outras continuam), obra sem modelos (só documentos e gestão), modelo sem propriedades (aviso R1).

## 4. Recursos 3D (v1)

| Grupo | Recursos | Componente That Open esperado |
| --- | --- | --- |
| Navegação | Orbitar, pan, zoom, enquadrar tudo/seleção, eixos e cubo de vista, contorno de arestas, grade | `SimpleWorld`, `OrthoPerspectiveCamera`, `Grids`, `PostproductionRenderer` (front) |
| Itens | Árvore espacial, categorias IFC, lista de modelos com liga/desliga, busca por nome | `Classifier`, dados de estrutura espacial do `FragmentsModel` |
| Visibilidade | Selecionar (clique, Ctrl+clique), destacar ao passar, ocultar, isolar, fantasma, mostrar tudo, colorir por categoria/disciplina | `Highlighter`, `Hoverer`, `Outliner` (front), `Hider`, `Classifier` |
| Inspeção | Atributos, property sets, quantidades (quando o IFC trouxer), contagem por classe, busca por atributo | `FragmentsModel.getItemsData` (relação `IsDefinedBy`), `ItemsFinder` |
| Cortes e vistas | Planos de corte (com preenchimento de seção), plantas por pavimento, elevações, orto/perspectiva, minimapa, caminhar | `Clipper` + `ClipStyler` (front), `Views.createFromIfcStoreys` / `Views.createElevations`, `OrthoPerspectiveCamera` (`PlanMode`, `FirstPersonMode`). Minimapa não existe no v3: implementação própria no adaptador (segunda câmera ortográfica de topo em canvas pequeno) |
| Medições | Distância, área, volume, ângulo; lista e apagar; unidades m, m², m³, graus com 2 casas | `LengthMeasurement`, `AreaMeasurement`, `VolumeMeasurement`, `AngleMeasurement` (front) |
| Issues | Criar a partir da vista, marcadores, restaurar vista, BCF | `BCFTopics`, `Viewpoints` |

Medições e cortes não persistem na v1, exceto quando fazem parte da vista de uma issue.

## 5. Dados (Supabase)

Tudo com RLS ligada e acesso só para `privado.eh_admin()`. Escrita por RPCs `security definer`, no padrão de `admin_registrar_modelo`. Modelos: tabelas `modelo` e `publicacao_modelo` sem mudança.

### 5.1 Documentos

```sql
create table public.documento (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obra (id) on delete cascade,
  serie uuid not null,                 -- agrupa as revisões do mesmo documento
  codigo text,                         -- ex.: CE01-14PE01-ARQ-PR-012
  titulo text not null,
  tipo text not null,                  -- prancha | memorial | planilha | desenho | imagem | outro
  disciplina text,                     -- sigla ^[A-Z]{2,4}$, opcional
  revisao text not null,
  caminho text not null,               -- documentos/<obra_id>/<serie>/<sha256>.<ext>
  arquivo_nome text not null,
  mime text not null,
  bytes bigint not null check (bytes > 0 and bytes <= 104857600),
  sha256 text not null,
  visibilidade text not null default 'admin' check (visibilidade in ('admin')),
  enviado_por uuid references public.usuario (id) on delete set null,
  enviado_em timestamptz not null default now(),
  retirado_em timestamptz,
  retirado_por uuid references public.usuario (id) on delete set null,
  unique (serie, revisao)
);
create table public.documento_vinculo (
  documento_id uuid not null references public.documento (id) on delete cascade,
  tipo text not null check (tipo in ('pavimento', 'elemento')),
  sigla text not null,                 -- disciplina do modelo onde está o GlobalId
  global_id text not null,
  classe text, nome text,              -- para revincular se o GlobalId sumir (R2)
  primary key (documento_id, sigla, global_id)
);
```

- Bucket privado `documentos`, 100 MB, mimes: `application/pdf`, `image/png`, `image/jpeg`, `image/webp`, `application/acad`, `image/vnd.dwg`, `application/dxf`, `image/vnd.dxf`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `application/octet-stream` (DWG sem mime). Admin lê e grava; sem delete (retirar só marca `retirado_em`).
- RPCs: `admin_listar_documentos(p_obra)` (revisão vigente de cada série + vínculos), `admin_historico_documento(p_serie)`, `admin_registrar_documento(...)` (nova série ou nova revisão; valida caminho no Storage como `admin_registrar_modelo`), `admin_retirar_documento(p_id)`, `admin_vincular_documento(p_id, p_vinculos jsonb)` (substitui os vínculos).
- Prévia: PDF abre num painel com `pdfjs-dist` (paginação, zoom); outros formatos mostram metadados e "Baixar".

### 5.2 Issues

```sql
create table public.issue (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obra (id) on delete cascade,
  numero int not null,                 -- sequencial por obra
  guid uuid not null default gen_random_uuid(),   -- GUID BCF
  titulo text not null,
  descricao text,
  tipo text not null default 'problema',          -- problema | duvida | conflito | pendencia
  prioridade text not null default 'normal',      -- baixa | normal | alta | critica
  status text not null default 'aberta',          -- aberta | em_andamento | resolvida | fechada
  responsavel_id uuid references public.usuario (id) on delete set null,
  prazo date,
  criado_por uuid references public.usuario (id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (obra_id, numero), unique (guid)
);
create table public.issue_vista (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issue (id) on delete cascade,
  guid uuid not null default gen_random_uuid(),
  vista jsonb not null,                -- tipo Vista (seção 3.1)
  imagem_path text,                    -- issues/<obra_id>/<issue_id>/<vista_id>.png
  criado_em timestamptz not null default now()
);
create table public.issue_comentario (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issue (id) on delete cascade,
  guid uuid not null default gen_random_uuid(),
  autor_id uuid references public.usuario (id) on delete set null,
  texto text not null,
  vista_id uuid references public.issue_vista (id) on delete set null,
  criado_em timestamptz not null default now()
);
```

- Bucket privado `issues` (PNG, 5 MB). Responsável: qualquer usuário admin (lista de `admin_app`).
- RPCs: `admin_listar_issues(p_obra)`, `admin_salvar_issue(jsonb)` (cria com próximo número ou atualiza), `admin_comentar_issue(...)`, `admin_salvar_vista_issue(...)`, `admin_importar_bcf(p_obra, jsonb)` (upsert por `guid`, idempotente).
- BCF: exportar/importar `.bcfzip` versão 2.1 e 3.0, com implementação própria (`fflate` + `DOMParser` na leitura e strings escapadas na escrita, em `infra/bcf/`) em vez do `BCFTopics`, que exige `Components`, mundo com renderer e vistas vivas (WebGL); assim a ida e volta é determinística, testável sem WebGL, e a idempotência vem do GUID do tópico; o mapeamento issue ↔ topic é função pura em `modules/issues/domain/bcf.ts` (status, prioridade, tipo, comentários, viewpoints; GlobalIds como `components`). Os eixos trocam Y-up da cena por Z-up do BCF e somam a `origemCena()` do motor (o Fragments desloca a cena para o modelo-base ficar na origem). Campos BCF sem equivalente vão para `descricao` com o prefixo `[BCF]`.

### 5.3 Lista de obras

`admin_central_obras()` → `[{ obra_id, slug, nome, disciplinas, documentos, issues_abertas, atualizado_em }]`.

## 6. Gestão de modelos

Mesmo comportamento de `ModelosObra.tsx` (conversão IFC no worker, `.frag` direto, sigla/revisão, publicar, retirar, histórico), movido para o painel "Gestão". O componente atual é refatorado em peças reutilizáveis; as RPCs e o bucket `modelos` não mudam. Após publicar ou retirar, a cena recarrega só a disciplina afetada. Na Gestão também ficam os documentos órfãos de vínculo (GlobalId ausente na revisão nova).

## 7. Testes e critério de pronto

- Domínio: validações de documento (tipo, tamanho, mime, revisão), mapeamento BCF ida e volta, montagem da árvore, formato de medidas.
- Contract tests das portas `DocumentosRepositorio` e `IssuesRepositorio` (fixture e Supabase com cliente simulado).
- Componentes (jsdom) com dublê de `MotorVisualizador`: lista de obras, troca de obra libera o motor, seleção → propriedades → documentos vinculados, criar issue a partir da vista, tema persistido.
- Banco: script `npm run testar:central` no Supabase local, conferindo RLS (admin lê e grava; participante, estranho e anônimo não).
- e2e Playwright (`VITE_DADOS=fixture`, Chromium com WebGL): abrir `/modelos`, entrar numa obra, carregar `.frag` de fixture, selecionar, isolar, cortar, medir, criar issue, exportar BCF.
- Pronto: `npm run typecheck`, `lint`, `test`, `build` e `build:fixture` verdes; e2e completo verde; `precache-manifest.json` sem chunks do visualizador; migrations aplicadas e RLS conferida em produção; `docs/admin.md` atualizado.
