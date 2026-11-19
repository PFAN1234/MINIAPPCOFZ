# Plano de Organização de Arquivos e Evolução Arquitetural (DDD, Clean Architecture e TDD)

> **Status:** Proposta de arquitetura e plano de migração incremental  
> **Data:** 2026-11-19  
> **Escopo:** Todo o repositório (`app/`, `supabase/`, `scripts/`, `data/`, `obras/`, `docs/`, `tests/`), com foco principal na estruturação de `app/src/` e alinhamento de `app/servidor/`.  
> **Relação com planos anteriores:** Expande e consolida o plano operacional de limpeza de pastas em [`tasks/plano-organizacao-pastas.md`](../tasks/plano-organizacao-pastas.md), introduzindo fronteiras arquiteturais explícitas de **Domain-Driven Design (DDD)**, **Clean Architecture** e **Test-Driven Development (TDD)**.

---

## 1. Diagnóstico do Estado Atual

O projeto evoluiu rapidamente com excelente disciplina de contratos (`docs/contrato-*.md`), boa cobertura de testes (Vitest, Playwright, Pytest, Postgres/RLS e Deno) e separação já existente entre **Mini App** (`index.html`), **Admin** (`admin.html`), **Funções Vercel** (`app/api/` + `app/servidor/`) e **Edge Functions** (`supabase/functions/`).

Entretanto, a organização atual de `app/src/` cresceu orientada a **tipo técnico de arquivo** (`telas/`, `components/`, `dados/`, `util/`), gerando quatro gargalos estruturais:

1. **Interfaces e adaptadores monolíticos ("God Repositories"):**
   - `app/src/dados/repositorio.ts` concentra ~35 operações de 8 domínios distintos em uma única interface `Repositorio`.
   - `app/src/admin/dados/repositorio.ts` concentra ~50 operações na interface `RepositorioAdmin`.
   - Como consequência, os adaptadores cresceram demais: `app/src/admin/dados/fixture.ts` (~1.731 linhas), `app/src/dados/fixture.ts` (~1.418 linhas), `app/src/dados/supabase.ts` (~1.181 linhas) e `app/src/admin/dados/supabase.ts` (~999 linhas).
2. **Mistura de regras de domínio com infraestrutura e UI:**
   - `app/src/util/` mistura lógica pura de domínio (`etapas.ts`, `painel.ts`, `periodo.ts`, `coordenadas.ts`) com detalhes de navegador/plataforma (`imagem.ts`, `localizacao.ts`, `online.ts`, `guardaSaida.ts`).
   - Diretórios como `app/src/ra/` e `app/src/modelo/` já agrupam por assunto, mas misturam matemática pura (`geometria.ts`, `pose.ts`, `corte.ts`), adaptadores de hardware/storage (`camera.ts`, `motor.ts`, `cacheModelo.ts`) e componentes React (`TelaRA.tsx`, `VisualizadorModelo.tsx`) no mesmo nível.
3. **Fronteira implícita entre Mini App, Admin e código compartilhado:**
   - `app/src/admin/` importa utilitários e componentes espalhados pela raiz de `app/src/`. Embora `app/vite.config.ts` (`arquivosSoDoAdmin`) proteja o `precache-manifest.json` no build, o acoplamento em tempo de desenvolvimento não é visível nem bloqueado por lint.
4. **Ruído na raiz do repositório:**
   - `DOCS COFZ/` e `DOCS HTO/` ainda usam espaços e maiúsculas (pendente da Fase 2 de `tasks/plano-organizacao-pastas.md`).

### O que já funciona bem e será preservado

- **Deploy na Vercel (`Root Directory = app/`):** não criar monorepo artificial (`apps/` / `packages/`). Manter `app/api/*.ts` como entrypoints finos das funções serverless.
- **Padrão `index.ts` → `handler.ts` + `handler_test.ts`** nas Edge Functions em `supabase/functions/`.
- **Separação `api/*.ts` → `servidor/{boletim,relatorio}/`** (já próxima de Clean Architecture).
- **Inversão de dependência via `fixture` vs `supabase`** com *tree-shaking* em tempo de build (`import.meta.env.VITE_DADOS === 'fixture'`).
- **Isolamento de bundles no Vite** (`index.html` vs `admin.html` e exclusão de chunks exclusivos do Admin no `precache-manifest.json`).

---

## 2. Premissas Arquiteturais

### 2.1 Domain-Driven Design (DDD)

O código passa a ser organizado em torno de **Contextos Delimitados (Bounded Contexts)** alinhados à **Linguagem Ubíqua** já consolidada nos contratos em `docs/contrato-*.md` e nas RPCs do Supabase:

| Contexto Delimitado | Responsabilidade (Core / Supporting / Generic) | Conceitos / Agregados principais | Origem atual aproximada |
| --- | --- | --- | --- |
| **`obras`** | **Core** — Estrutura física e contratual | `Obra`, `Etapa`, `Pavimento`, `Ambiente`, `Aditivo`, `Responsavel`, `Organizacao` | `telas/Obra*`, `admin/telas/etapa/*`, `admin/telas/obra/*`, `admin/telas/Organizacao*`, `util/etapas.ts` |
| **`fiscalizacao`** | **Core** — Execução de campo e acompanhamento | `Registro` (Serviço/Pendência), `Encerramento`, `ObservacaoDoDia`, `Foto`, `PublicacaoOutbox` | `telas/NovoRegistro*`, `telas/Registros*`, `telas/Pendencia*`, `telas/Publicacoes*`, `components/CartaoObservacoes*`, `dados/envio.ts` |
| **`acessos`** | **Supporting** — Identidade, autorização e presença | `Sessao`, `Usuario`, `PapelObra`, `SolicitacaoAcesso`, `MatrizAcessos`, `EquipeServico` (Check-in/out) | `telas/Acessos*`, `admin/telas/Pessoas*`, `admin/telas/Admins*`, `admin/telas/Entrar*`, `dados/login.ts`, `dados/nome.ts`, `components/EquipeServico*` |
| **`plantas`** | **Supporting** — Engenharia 2D e revisão de PDFs | `Planta`, `RevisaoPlanta`, `Recorte`, `SpanTexto`, `AmbienteExtraido` | `admin/planta/*`, `admin/telas/planta/*`, `components/AbaPlanta*`, `components/PlantaViewer*`, `components/OndeFica*` |
| **`modelos`** | **Supporting** — BIM / Modelo Federado 3D | `ModeloFrag`, `Disciplina`, `PlanoCorte`, `CacheModelo` | `modelo/*`, `admin/modelo/*`, `admin/telas/modelo/*`, `telas/Modelo.tsx`, `telas/AmbienteModelo.tsx` |
| **`ra`** | **Supporting** — Realidade Aumentada em campo | `GeometriaAmbiente`, `MarcadorQr`, `Pose`, `Orientacao`, `Malha` | `ra/*`, `admin/ra/*`, `admin/telas/ra/*` |
| **`relatorios`** | **Core** — Boletim Diário, Pendências e Painel | `Boletim`, `EdicaoBoletim`, `PedidoEmissao`, `Clima`, `RelatorioPendencias`, `PainelRelatorios` | `telas/Relatorios*`, `admin/telas/boletins/*`, `util/painel.ts`, `util/periodo.ts`, `servidor/boletim/*`, `servidor/relatorio/*` |
| **`operacao`** | **Generic** — Resiliência offline e observabilidade | `FilaOffline`, `CacheConsultas`, `ErroCliente`, `ResumoOrfaos` | `offline/*`, `dados/erros.ts`, `admin/telas/Erros.tsx`, `registrarSw.ts` |

Além dos contextos, existirão dois núcleos explícitos em `app/src/shared/`:
- **`shared/kernel/` (Shared Kernel):** Value Objects transversais (`Slug`, `Periodo`, `Fuso`, `Coordenada`, `PapelAcesso`), hierarquia de erros de domínio (`ErroDominio`, `ErroEnvio`) e funções puras sem dependência de framework (`busca`, `formato`, `ordenacao`, `fuso`).
- **`shared/ui/` (Design System):** Tokens CSS (`tokens.css`, `fontes.css`), componentes visuais reutilizáveis e agnósticos de regra de negócio (`Layout`, `TopoTela`, `BarraInferior`, `Abas`, `Aviso`, `Estado`, `Icones`, `CampoBusca`, `ErrorBoundary`, `SeloVersao`).

#### Mapa de Contextos (Context Map)

```mermaid
flowchart LR
    SK["shared/kernel<br/>(Shared Kernel)"]

    subgraph Core["Core Domain"]
        OB["obras<br/>(Upstream)"]
        FI["fiscalizacao<br/>(Core)"]
        RE["relatorios<br/>(Downstream)"]
    end

    subgraph Supporting["Supporting Subdomains"]
        AC["acessos<br/>(Upstream / Auth)"]
        PL["plantas"]
        MO["modelos"]
        RA["ra"]
    end

    subgraph Generic["Generic Subdomain"]
        OP["operacao<br/>(Offline / Telemetria)"]
    end

    OB -->|"Customer-Supplier<br/>(obraId, ambienteId, etapaId)"| FI
    OB -->|"Customer-Supplier<br/>(etapas, aditivos, obras)"| RE
    FI -->|"Published Language<br/>(registros, pendencias, observacoes)"| RE
    AC -->|"Conformist / Auth<br/>(usuarioId, papel, equipe)"| FI
    AC -->|"Auth / Permissoes"| OB
    AC -->|"Equipe de Servico"| RE
    OB -->|"Pavimentos / Ambientes"| PL
    OB -->|"Disciplinas / Obra"| MO
    OB -->|"Contorno / Ambiente"| RA
    MO -->|"ModeloFrag / Referencial"| RA
    OP -->|"Sincronizacao / Fila"| FI

    OB -.-> SK
    FI -.-> SK
    RE -.-> SK
    AC -.-> SK
    PL -.-> SK
    MO -.-> SK
    RA -.-> SK
    OP -.-> SK
```

> **Regra de comunicação entre contextos:** um contexto **nunca** importa arquivos internos de outro contexto. Toda comunicação entre contextos ocorre exclusivamente pela API pública (`index.ts` do contexto ou contratos em `domain/`/`application/ports/`), preferencialmente por IDs e DTOs imutáveis.

---

### 2.2 Clean Architecture (Regra de Dependência)

Dentro de cada contexto em `app/src/modules/<contexto>/` (e nos serviços Node em `app/servidor/<contexto>/`), os arquivos seguem **4 camadas concêntricas**. As dependências apontam **sempre para dentro**:

```mermaid
flowchart TD
    subgraph Outer["4. Presentation & Entrypoints (UI / HTTP / CLI)"]
        UI["presentation/<br/>React Screens, Components, Hooks (React Query)"]
        APP["apps/miniapp & apps/admin<br/>Composition Root, Rotas, Providers"]
        API["app/api/*.ts & supabase/functions/*/index.ts<br/>Entrypoints HTTP / Serverless / Deno"]
    end

    subgraph Infra["3. Infrastructure (Adapters)"]
        AD["infrastructure/<br/>Supabase Adapters, Fixture Adapters,<br/>Browser APIs (IDB, Camera, GPS, PDF.js, Three.js),<br/>Playwright/Chromium PDF"]
    end

    subgraph AppLayer["2. Application (Use Cases & Ports)"]
        UC["application/use-cases/<br/>Orquestracao de fluxos, validacoes de entrada"]
        PO["application/ports/<br/>Interfaces segregadas (Repositorios, Gateways)"]
    end

    subgraph Domain["1. Domain (Nucleo Puro)"]
        DO["domain/<br/>Entidades, Value Objects, Regras Puras,<br/>Servicos de Dominio, Erros de Dominio"]
    end

    APP --> UI
    APP --> AD
    APP --> UC
    API --> AD
    API --> UC
    UI --> UC
    UI --> DO
    AD --> PO
    AD --> DO
    UC --> PO
    UC --> DO
```

#### Matriz de Dependências Permitidas e Proibidas

| Camada | Pode importar de | **Proibido** importar de |
| --- | --- | --- |
| `modules/<ctx>/domain/` | Próprio `domain/`, `shared/kernel/` | React, Vite, Supabase, DOM (`window`/`document`), `idb`, `three`, `pdfjs-dist`, `application/`, `infrastructure/`, `presentation/` |
| `modules/<ctx>/application/` | Próprio `domain/`, próprio `application/ports/`, `shared/kernel/`, contratos públicos de outros contextos | React, Supabase SDK, `infrastructure/`, `presentation/`, APIs de navegador |
| `modules/<ctx>/infrastructure/` | Próprio `application/ports/`, próprio `domain/`, `shared/kernel/`, `shared/infra/`, SDKs externos (`@supabase/supabase-js`, `idb`, `three`, `pdfjs-dist`) | `presentation/`, outros `infrastructure/` (exceto via `shared/infra/`) |
| `modules/<ctx>/presentation/` | Próprio `application/` (use cases/ports), próprio `domain/`, `shared/ui/`, `shared/kernel/`, React / React Query / React Router | `infrastructure/` (instanciação direta de Supabase/Fixture), `presentation/` de outro contexto sem contrato explícito |
| `apps/miniapp/` e `apps/admin/` | Qualquer `modules/<ctx>/` (é o **Composition Root** onde adaptadores são ligados às portas) | `apps/miniapp/` não pode importar de `apps/admin/` e vice-versa (garante `arquivosSoDoAdmin` no precache) |

---

### 2.3 Test-Driven Development (TDD)

A migração e todo desenvolvimento futuro adotam **TDD estruturado por camada**, evitando tanto a falta de testes quanto testes frágeis acoplados a detalhes de implementação:

```mermaid
flowchart TB
    E2E["E2E (Playwright - app/e2e/)<br/>Fluxos criticos ponta a ponta: Mini App, Admin, Offline, Planta, RA"]
    INT["Integracao & Banco (tests/db/, *.node.test.ts, supabase/functions/*_test.ts)<br/>RLS, RPCs Postgres, paridade PDF/Python, Chromium PDF, Deno handlers"]
    CTR["Contract Tests de Portas (application/ports/*.contract.test.ts)<br/>Mesma suite valida FixtureAdapter e SupabaseAdapter"]
    UC["Unitarios de Casos de Uso (application/use-cases/*.test.ts)<br/>Testes com fakes em memoria, foco em comportamento e erros"]
    DOM["Unitarios de Dominio (domain/*.test.ts)<br/>100% puros, determinísticos, execucao em milissegundos"]

    E2E --> INT --> CTR --> UC --> DOM
```

#### Regras de TDD durante a migração

1. **Testes de Caracterização antes de mover código:** antes de refatorar um trecho de `supabase.ts`, `fixture.ts` ou uma tela complexa, garantir que exista teste cobrindo o comportamento atual.
2. **Ciclo Red → Green → Refactor em cada fatia:**
   - **Red:** escrever o teste unitário de domínio ou teste de contrato da nova porta antes de extrair a implementação.
   - **Green:** extrair/mover a implementação mínima para satisfazer o contrato.
   - **Refactor:** remover duplicações, ajustar nomes para a Linguagem Ubíqua e eliminar *shims* obsoletos.
3. **Testes colocalizados com o código-fonte:**
   - `*.test.ts` / `*.test.tsx` ao lado do arquivo testado (Vitest jsdom).
   - `*.node.test.ts` ao lado do arquivo para testes Node puros (mantendo o `exclude` atual em `app/tsconfig.app.json` e a inclusão em `app/tsconfig.testes-node.json`).
   - `*.contract.test.ts` em `application/ports/` para testar implementações de repositório contra o mesmo contrato.

---

## 3. Estrutura-Alvo de Arquivos

### 3.1 Visão do Repositório (Raiz)

```text
MINIAPPCOFZ/
├── obras/                          # (Fase 1) Substitui DOCS COFZ/, DOCS HTO/ e public/ifc/
│   ├── cofz/
│   │   ├── README.md
│   │   └── pdf/
│   └── hto/
│       ├── README.md
│       ├── pdf/
│       └── ifc/                    # Ignorado no Git (.gitignore)
├── app/                            # Root Directory na Vercel (Mini App + Admin + API Node)
│   ├── api/                        # Entrypoints finos Vercel Serverless (inalterados nas rotas)
│   │   ├── gerar-boletim.ts
│   │   ├── previa-boletim.ts
│   │   └── relatorio-pendencias.ts
│   ├── servidor/                   # Backend Node do gerador de PDFs (tsconfig.servidor.json)
│   │   ├── shared/                 # Infra comum (chromium, fontes, http-errors, supabase-client)
│   │   ├── boletim/
│   │   │   ├── domain/             # tipos, edicao, formato, regras de consolidacao
│   │   │   ├── application/        # gerador (use case), portas (FonteBoletim, RenderizadorPdf, ServicoClima)
│   │   │   ├── infrastructure/     # supabase, clima, estacoes, fotos, pdf (Playwright/Chromium), template
│   │   │   ├── http/               # controller HTTP (tratarGerar, tratarPrevia)
│   │   │   └── __fixtures__/
│   │   └── relatorio/
│   │       ├── domain/
│   │       ├── application/
│   │       ├── infrastructure/
│   │       └── http/
│   ├── src/                        # Frontend (Mini App + Admin) — detalhado em 3.2
│   ├── e2e/                        # Testes Playwright ponta a ponta
│   ├── public/                     # sw.js e modelos locais de desenvolvimento
│   ├── scripts/                    # Utilitários Node (ifc_para_frag, publicar_modelos, etc.)
│   ├── index.html                  # Entrypoint Vite -> /src/apps/miniapp/main.tsx
│   ├── admin.html                  # Entrypoint Vite -> /src/apps/admin/main.tsx
│   ├── vercel.json
│   └── vite.config.ts
├── supabase/
│   ├── migrations/                 # Migrations SQL (inalterado)
│   ├── seed/                       # Seeds SQL (inalterado)
│   └── functions/                  # Edge Functions Deno (index.ts -> handler.ts + handler_test.ts)
│       ├── _shared/
│       ├── admin-excluir-obra/
│       ├── admin-sessao/
│       ├── assinar-envio-plantas/
│       ├── auth-telegram/
│       ├── bot-webhook/
│       └── publish-outbox/
├── scripts/                        # Pipeline Python de extração de plantas/ambientes/seeds
├── data/                           # Dados gerados e configuracoes por obra (cofz/, hto/)
├── tests/                          # Testes Python (pipeline + tests/db Postgres/RLS)
├── docs/                           # Contratos, arquitetura, ROADMAP, mockups, specs
├── tasks/                          # Checklists e planos operacionais
└── artifacts/                      # Evidências históricas de validação PDF/IFC
```

### 3.2 Estrutura-Alvo de `app/src/`

```text
app/src/
├── apps/                                   # Composition Roots (isolamento estrito de bundles)
│   ├── miniapp/
│   │   ├── main.tsx                        # Entrypoint de index.html
│   │   ├── App.tsx                         # Rotas e shell do Mini App
│   │   ├── App.test.tsx
│   │   ├── container.ts                    # Instancia adaptadores (Supabase vs Fixture) e injeta portas
│   │   └── providers.tsx                   # QueryClient, Contextos de portas, Offline, Telegram
│   └── admin/
│       ├── main.tsx                        # Entrypoint de admin.html
│       ├── AdminApp.tsx                    # Rotas e shell do Admin
│       ├── AdminApp.test.tsx
│       ├── admin.css
│       ├── container.ts                    # Instancia adaptadores Admin (Supabase vs Fixture)
│       └── providers.tsx
│
├── shared/                                 # Nucleo compartilhado (sem acoplamento a contexto)
│   ├── kernel/                             # 100% puro (zero React, zero DOM, zero SDK)
│   │   ├── erros.ts                        # ErroDominio, ErroEnvio, codigos de erro
│   │   ├── busca.ts
│   │   ├── coordenadas.ts
│   │   ├── formato.ts
│   │   ├── fuso.ts
│   │   ├── ordenacao.ts
│   │   ├── tipos.ts                        # Value Objects e tipos comuns (PapelAcesso, Posicao, etc.)
│   │   └── index.ts
│   ├── infra/                              # Adaptadores tecnicos transversais
│   │   ├── supabaseClient.ts               # Cliente/configuracao base Supabase
│   │   ├── telegram/                       # telegram.ts, telegramBack.ts
│   │   ├── browser/                        # imagem.ts, localizacao.ts, online.ts, guardaSaida.ts, telaCheia.ts
│   │   └── sw/                             # registrarSw.ts
│   ├── ui/                                 # Design System (componentes puros de apresentacao)
│   │   ├── estilo/                         # tokens.css, fontes.css, index.css
│   │   ├── layout/                         # Layout.tsx, TopoTela.tsx, BarraInferior.tsx, FaixaIdentidade.tsx
│   │   ├── feedback/                       # Aviso.tsx, Estado.tsx, ErrorBoundary.tsx, SeloVersao.tsx
│   │   ├── inputs/                         # CampoBusca.tsx, Abas.tsx, AbasEtapa.tsx, SeletorFotos.tsx
│   │   ├── midia/                          # CameraFotos.tsx, GaleriaFotos.tsx, VisualizadorFotos.tsx, useFotosEscolhidas.ts
│   │   └── icones/                         # Icones.tsx
│   └── test/                               # Infraestrutura compartilhada de testes
│       ├── setup.ts
│       └── renderApp.tsx
│
└── modules/                                # Contextos Delimitados (Vertical Slices + Clean Architecture)
    ├── obras/
    │   ├── domain/                         # Obra, Etapa, Pavimento, Ambiente, Aditivo, etapas.ts (regras puras)
    │   ├── application/
    │   │   ├── ports/                      # ObrasRepositorio.port.ts, EtapasRepositorio.port.ts, OrganizacaoRepositorio.port.ts
    │   │   └── use-cases/                  # salvarEtapa, salvarObra, arquivarObra, excluirObra, etc.
    │   ├── infrastructure/
    │   │   ├── supabase/                   # ObrasSupabaseAdapter.ts, EtapasSupabaseAdapter.ts
    │   │   └── fixture/                    # ObrasFixtureAdapter.ts, EtapasFixtureAdapter.ts
    │   ├── presentation/
    │   │   ├── miniapp/                    # Obras.tsx, Obra.tsx, Ambiente.tsx, hooks
    │   │   └── admin/                      # ObrasAdmin.tsx, ObraAdmin.tsx, etapa/*, obra/*, Organizacao.tsx
    │   └── index.ts
    │
    ├── fiscalizacao/
    │   ├── domain/                         # Registro, Pendencia, Encerramento, Observacao, regras de envio/idempotencia
    │   ├── application/
    │   │   ├── ports/                      # RegistrosRepositorio.port.ts, ObservacoesRepositorio.port.ts, PublicacoesRepositorio.port.ts
    │   │   └── use-cases/                  # concluirRegistro, encerrarPendencia, salvarObservacao, republicar
    │   ├── infrastructure/
    │   │   ├── supabase/                   # RegistrosSupabaseAdapter.ts, StorageFotosAdapter.ts
    │   │   └── fixture/                    # RegistrosFixtureAdapter.ts
    │   ├── presentation/
    │   │   └── miniapp/                    # NovoRegistro.tsx, Registros.tsx, Pendencias.tsx, PendenciaDetalhe.tsx, Publicacoes.tsx, CartaoObservacoes.tsx, CartaoPendencia.tsx, ListaRegistros.tsx
    │   └── index.ts
    │
    ├── acessos/
    │   ├── domain/                         # Sessao, PapelObra, SolicitacaoAcesso, EquipeServico, nome.ts
    │   ├── application/
    │   │   ├── ports/                      # SessaoRepositorio.port.ts, AcessosRepositorio.port.ts, EquipeServicoRepositorio.port.ts
    │   │   └── use-cases/                  # autenticarTelegram, solicitarAcesso, definirAcesso, fazerCheckin
    │   ├── infrastructure/
    │   │   ├── supabase/                   # AcessosSupabaseAdapter.ts, login.ts
    │   │   └── fixture/                    # AcessosFixtureAdapter.ts
    │   ├── presentation/
    │   │   ├── miniapp/                    # Acessos.tsx, AcessosEquipe.tsx, EquipeServico.tsx, PedidosAcesso.tsx, GuardaSessao.tsx
    │   │   └── admin/                      # Entrar.tsx, Pessoas.tsx, Admins.tsx
    │   └── index.ts
    │
    ├── plantas/
    │   ├── domain/                         # tipos.ts, extrair.ts, spans.ts, editor.ts, sinteticos.ts, metricasFonte.ts
    │   ├── application/
    │   │   ├── ports/                      # PlantasRepositorio.port.ts, ServicoPdf.port.ts
    │   │   └── use-cases/                  # extrairPlanta, publicarRevisaoPlanta
    │   ├── infrastructure/
    │   │   ├── pdf/                        # carregarPdfJs.ts, pdf.ts, render.ts, servicoNavegador.ts
    │   │   ├── supabase/                   # PlantasSupabaseAdapter.ts, publicar.ts
    │   │   └── fixture/                    # PlantasFixtureAdapter.ts, servicoFalso.ts
    │   ├── presentation/
    │   │   ├── miniapp/                    # AbaPlanta.tsx, PlantaViewer.tsx, OndeFica.tsx, Pino.tsx
    │   │   └── admin/                      # PlantaObra.tsx, EditorPlanta.tsx, Ambientes.tsx, NovaRevisao.tsx, Recorte.tsx
    │   └── index.ts
    │
    ├── modelos/
    │   ├── domain/                         # modelos.ts, corte.ts (regras puras de disciplina e corte 3D)
    │   ├── application/
    │   │   ├── ports/                      # ModelosRepositorio.port.ts, CacheModelo.port.ts, ConversorIfc.port.ts
    │   │   └── use-cases/                  # carregarModeloComCache, registrarModelo, retirarModelo
    │   ├── infrastructure/
    │   │   ├── cache/                      # cacheModelo.ts (IndexedDB)
    │   │   ├── conversor/                  # conversor.ts, conversor.worker.ts, globais.d.ts
    │   │   ├── supabase/                   # ModelosSupabaseAdapter.ts
    │   │   └── fixture/                    # ModelosFixtureAdapter.ts
    │   ├── presentation/
    │   │   ├── miniapp/                    # VisualizadorModelo.tsx, PreviaModelo.tsx, Modelo.tsx, AmbienteModelo.tsx
    │   │   └── admin/                      # ModelosObra.tsx
    │   └── index.ts
    │
    ├── ra/
    │   ├── domain/                         # tipos.ts, geometria.ts, pose.ts, orientacao.ts, malha.ts, qr.ts, planta.ts
    │   ├── application/
    │   │   ├── ports/                      # RaRepositorio.port.ts, Camera.port.ts, LeitorQr.port.ts
    │   │   └── use-cases/                  # calibrarAmbienteRA, definirQrAmbiente
    │   ├── infrastructure/
    │   │   ├── dispositivo/                # camera.ts, leitorQr.ts, motor.ts
    │   │   ├── supabase/                   # RaSupabaseAdapter.ts
    │   │   └── fixture/                    # RaFixtureAdapter.ts
    │   ├── presentation/
    │   │   ├── miniapp/                    # TelaRA.tsx, DiagnosticoRA.tsx, ra.css
    │   │   └── admin/                      # RaObra.tsx
    │   └── index.ts
    │
    ├── relatorios/
    │   ├── domain/                         # painel.ts, periodo.ts, tipos de boletim/relatorio
    │   ├── application/
    │   │   ├── ports/                      # RelatoriosRepositorio.port.ts, BoletinsAdminRepositorio.port.ts
    │   │   └── use-cases/                  # emitirBoletim, retificarBoletim, exportarPendencias
    │   ├── infrastructure/
    │   │   ├── supabase/                   # RelatoriosSupabaseAdapter.ts, BoletinsSupabaseAdapter.ts
    │   │   └── fixture/                    # RelatoriosFixtureAdapter.ts, fixtureBoletim.ts
    │   ├── presentation/
    │   │   ├── miniapp/                    # Relatorios.tsx, PainelRelatorios.tsx, GraficoAcumulado.tsx, GraficoPorObra.tsx
    │   │   └── admin/                      # Boletins.tsx, EditorBoletim.tsx, EmitirOuPrever.tsx, Tabelas.tsx
    │   └── index.ts
    │
    └── operacao/
        ├── domain/                         # fila.ts (regras de retentativa/estado), erros de cliente, orfaos
        ├── application/
        │   ├── ports/                      # ArmazenamentoOffline.port.ts, TelemetriaRepositorio.port.ts
        │   └── use-cases/                  # sincronizarFila, registrarErroCliente
        ├── infrastructure/
        │   ├── indexeddb/                  # armazenamento.ts, cacheConsultas.ts
        │   ├── supabase/                   # TelemetriaSupabaseAdapter.ts
        │   └── fixture/                    # TelemetriaFixtureAdapter.ts
        ├── presentation/
        │   ├── miniapp/                    # contexto.tsx, BarraSincronizacao.tsx, RegistroLocal.tsx
        │   └── admin/                      # Erros.tsx
        └── index.ts
```

> **Atenção crítica ao bundle do Vite (`precache-manifest.json`):**  
> Separar `presentation/miniapp/` e `presentation/admin/` dentro de cada contexto (e manter `apps/miniapp/` isolado de `apps/admin/`) garante que o grafo de imports a partir de `index.html` **nunca** alcance código exclusivo do Admin. Além disso, o nome dos chunks pesados excluídos em `montarManifesto` (`VisualizadorModelo`, `motor-3d`, `jsQR`, `conversor.worker`) deve ser mantido inalterado ou atualizado em conjunto com `app/vite.config.ts` e `app/vite.config.test.ts`.

### 3.3 Interligação Ponta a Ponta das Camadas

```mermaid
sequenceDiagram
    participant U as Usuario (Mini App / Admin)
    participant UI as presentation/ (React + Hooks)
    participant UC as application/use-cases/
    participant DOM as domain/ (Regras Puras)
    participant PORT as application/ports/
    participant AD as infrastructure/ (Supabase ou Fixture)
    participant EXT as Supabase / Vercel API / IndexedDB

    U->>UI: Acao na tela (ex.: concluir registro)
    UI->>UC: Invoca caso de uso (injetado via Composition Root)
    UC->>DOM: Valida invariantes e regras puras
    DOM-->>UC: Entidade valida ou ErroDominio
    UC->>PORT: Chama contrato da porta (ex.: RegistrosRepositorio)
    PORT->>AD: Implementacao concreta (SupabaseAdapter ou FixtureAdapter)
    AD->>EXT: RPC / Storage / API / IndexedDB
    EXT-->>AD: Resposta ou falha de rede
    AD-->>UC: DTO ou ErroEnvio normalizado
    UC-->>UI: Resultado tipado
    UI-->>U: Atualiza cache React Query e interface
```

---

## 4. Plano de Migração em Fases Seguras (Zero Quebra)

### Estratégia de Segurança ("Strangler Fig" + Barrels Temporários)

Para migrar sem interromper entregas nem quebrar o deploy na Vercel ou o CI:

1. **Nunca fazer "Big Bang":** cada fase (e subfase) é um PR pequeno, revisável e reversível.
2. **Shims de compatibilidade (re-exports):** ao mover um módulo para `modules/<ctx>/` ou `shared/`, manter temporariamente um arquivo de re-export no caminho antigo até todos os consumidores serem atualizados — só então remover o arquivo antigo.
3. **Composição de interfaces na transição dos repositórios:** `Repositorio` e `RepositorioAdmin` passam a estender/compor as novas portas segregadas por contexto; assim, telas antigas continuam funcionando enquanto novas telas já consomem apenas a porta do seu contexto.
4. **Gate de verificação obrigatório ao fim de cada fase** (espelhando `.github/workflows/ci.yml`):
   ```bash
   # App (TypeScript + ESLint + Vitest + Build + Fixture Build)
   cd app && npm run typecheck && npm run lint && npm test && npm run build && npm run build:fixture

   # E2E (Playwright) + Testes de boletim com Chromium (quando aplicável)
   cd app && npm run test:e2e

   # Python + Paridade de configuração de obras
   pytest -q --ignore=tests/db && python3 scripts/importar_config_obras.py --verificar

   # Banco (quando houver alteração de contrato/SQL)
   pytest -q tests/db

   # Edge Functions (quando houver alteração em supabase/functions)
   cd supabase/functions && deno fmt --check && deno lint && deno check */*.ts && deno test
   ```

---

### Fase 0 — Rede de Segurança, Aliases e Fronteiras Automatizadas

**Objetivo:** Preparar o terreno sem alterar comportamento nem mover código de negócio.

- **Ações:**
  1. Configurar *path aliases* em `app/tsconfig.app.json`, `app/tsconfig.testes-node.json` e `app/vite.config.ts`:
     - `@shared/*` → `src/shared/*`
     - `@modules/*` → `src/modules/*`
     - `@apps/*` → `src/apps/*`
  2. Adicionar regras de fronteira em `app/eslint.config.js` (via `no-restricted-imports`) inicialmente em nível `warn` para os novos diretórios (`modules/*/domain/**` não pode importar `react`, `@supabase/supabase-js`, `infrastructure/`, `presentation/`; `apps/miniapp/**` não pode importar `apps/admin/**`).
  3. Criar estrutura inicial de pastas `app/src/shared/`, `app/src/modules/`, `app/src/apps/`.
  4. **TDD (Caracterização):** rodar a suíte completa e registrar o baseline de testes passando e o conteúdo atual de `app/dist/precache-manifest.json` (lista de arquivos excluídos do Admin).
- **Risco:** Muito baixo (apenas configuração e baseline).
- **Critério de pronto:** `typecheck`, `lint`, `test`, `build` e `build:fixture` verdes; aliases funcionando em um teste smoke.

---

### Fase 1 — Higienização da Raiz e Padronização de `obras/<slug>/`

**Objetivo:** Concluir a organização de ativos externos ao `app/src/` já prevista em `tasks/plano-organizacao-pastas.md` (Fases 2 e 3 daquele documento), eliminando diretórios com espaços e maiúsculas.

- **Ações:**
  1. Mover `DOCS COFZ/PDF/` → `obras/cofz/pdf/`, `DOCS COFZ/README.md` → `obras/cofz/README.md`.
  2. Mover `DOCS HTO/PDF/` → `obras/hto/pdf/`, `DOCS HTO/README.md` → `obras/hto/README.md` e `public/ifc/` → `obras/hto/ifc/`.
  3. Atualizar `.gitignore`, `data/hto/obra.json`, `data/cofz/obra.json`, `app/e2e/planta.spec.ts`, `artifacts/validation/pdf/reproduce/inspect_pdfs.py`, `scripts/README.md`, `CLAUDE.md` e `README.md`.
  4. Re-executar o pipeline Python (`extrair_ambientes.py`, `gerar_plantas.py`, `gerar_seed.py`, `importar_config_obras.py`) garantindo zero diff inesperado nos JSONs/seeds.
- **Risco:** Baixo (caminhos hardcoded em scripts e testes).
- **Verificação:** `pytest -q --ignore=tests/db`, `python3 scripts/importar_config_obras.py --verificar` e `cd app && npm run test:e2e -- e2e/planta.spec.ts`.

---

### Fase 2 — Extração do Shared Kernel e Infraestrutura Transversal (`app/src/shared/`)

**Objetivo:** Desacoplar utilitários puros, tokens/componentes genéricos de UI e adaptadores de navegador antes de fatiar os contextos.

- **Ações (com TDD Red → Green → Refactor):**
  1. Mover funções puras para `shared/kernel/`: `busca.ts`, `coordenadas.ts`, `formato.ts`, `fuso.ts`, `ordenacao.ts`, `erros.ts` (de `util/erros.ts` + `dados/erros.ts` separados entre modelo de erro e envio). Garantir 100% de testes unitários puros.
  2. Mover adaptadores de plataforma para `shared/infra/`: `telegram.ts`, `telegramBack.ts`, `imagem.ts`, `localizacao.ts`, `online.ts`, `guardaSaida.ts`, `telaCheia.ts`, `registrarSw.ts`.
  3. Mover componentes puramente visuais e CSS base para `shared/ui/`: `estilo/*`, `Layout`, `TopoTela`, `BarraInferior`, `Abas`, `Aviso`, `Estado`, `ErrorBoundary`, `Icones`, `CampoBusca`, `CameraFotos`, `GaleriaFotos`, `VisualizadorFotos`, `SeletorFotos`, `SeloVersao`.
  4. Manter arquivos *shim* (re-export) nos locais antigos (`src/util/*.ts`, `src/components/*.tsx`) durante a transição para não quebrar telas ainda não migradas.
- **Risco:** Baixo (re-exports preservam compatibilidade total).
- **Verificação:** `typecheck`, `lint`, `test`, `build` e inspeção do `precache-manifest.json`.

---

### Fase 3 — Segregação das Portas (Quebra dos God Repositories via ISP)

**Objetivo:** Eliminar o acoplamento de toda a aplicação a `Repositorio` (35 métodos) e `RepositorioAdmin` (50 métodos) aplicando o **Princípio da Segregação de Interfaces (ISP)** da Clean Architecture.

- **Ações (com TDD Contract Tests):**
  1. Definir interfaces de porta pequenas e focadas em `modules/<ctx>/application/ports/*.port.ts`:
     - `ObrasRepositorio`, `EtapasRepositorio`, `OrganizacaoRepositorio`
     - `RegistrosRepositorio`, `ObservacoesRepositorio`, `PublicacoesRepositorio`
     - `SessaoRepositorio`, `AcessosRepositorio`, `EquipeServicoRepositorio`
     - `PlantasRepositorio`, `ModelosRepositorio`, `RaRepositorio`
     - `RelatoriosRepositorio`, `BoletinsAdminRepositorio`, `TelemetriaRepositorio`
  2. Escrever **Contract Tests** (`*.contract.test.ts`) para as portas prioritárias, validando que `Fixture` e `Supabase` obedecem ao mesmo contrato (incluindo erros esperados e idempotência).
  3. Fazer `Repositorio` e `RepositorioAdmin` legados atuarem como **fachadas compostas** (`interface Repositorio extends ObrasRepositorio, RegistrosRepositorio, ...`), permitindo migrar consumidor por consumidor e fatiar `supabase.ts` e `fixture.ts` sem quebrar nada.
- **Risco:** Baixo a moderado (mudança de tipos; TypeScript captura qualquer incompatibilidade imediatamente).
- **Verificação:** `typecheck`, `test` (incluindo novos contract tests) e `build:fixture`.

---

### Fase 4 — Migração por Contexto Delimitado — Onda 1 (Baixo Acoplamento)

**Objetivo:** Validar a arquitetura na prática com os três contextos mais autocontidos e já parcialmente modularizados. Executar um PR por subfase:

#### Fase 4A — Contexto `ra` (Realidade Aumentada)
- `domain/`: `tipos.ts`, `geometria.ts`, `pose.ts`, `orientacao.ts`, `malha.ts`, `admin/ra/geometria.ts`, `admin/ra/planta.ts`, `admin/ra/qr.ts` (unificando regras duplicadas entre Mini App e Admin).
- `application/`: portas `RaRepositorio`, `CameraPort`, `LeitorQrPort` + casos de uso.
- `infrastructure/`: `camera.ts`, `leitorQr.ts`, `motor.ts`, adaptadores Supabase/Fixture de RA (extraídos de `dados/supabase.ts` e `admin/dados/supabase.ts`).
- `presentation/`: `miniapp/` (`TelaRA`, `DiagnosticoRA`, `ra.css`) e `admin/` (`RaObra`).
- **Verificação:** `npm test -- ra`, `npm run test:e2e -- e2e/ra.spec.ts`.

#### Fase 4B — Contexto `modelos` (Modelos 3D / IFC → `.frag`)
- `domain/`: `modelos.ts`, `corte.ts` (unificando regras de disciplinas e corte).
- `application/`: portas `ModelosRepositorio`, `CacheModeloPort`, `ConversorIfcPort`.
- `infrastructure/`: `cacheModelo.ts`, `conversor.ts`, `conversor.worker.ts`, adaptadores Supabase/Fixture de modelos.
- `presentation/`: `miniapp/` (`VisualizadorModelo`, `PreviaModelo`, `Modelo`, `AmbienteModelo`) e `admin/` (`ModelosObra`).
- **Atenção:** validar que `conversor.worker` e `VisualizadorModelo` continuam fora do `precache-manifest.json` e que `modelos.node.test.ts` continua passando.
- **Verificação:** `npm test -- modelo`, `npm run test:e2e -- e2e/modelo.spec.ts e2e/admin-modelo.spec.ts`.

#### Fase 4C — Contexto `plantas` (PDF, Extração e Revisões 2D)
- `domain/`: `tipos.ts`, `extrair.ts`, `spans.ts`, `editor.ts`, `sinteticos.ts`, `metricasFonte.ts`.
- `application/`: portas `PlantasRepositorio`, `ServicoPdfPort` + caso de uso `publicarRevisao`.
- `infrastructure/`: `carregarPdfJs.ts`, `pdf.ts`, `render.ts`, `servicoNavegador.ts`, `servicoFalso.ts`, adaptadores Supabase/Fixture.
- `presentation/`: `miniapp/` (`AbaPlanta`, `PlantaViewer`, `OndeFica`, `Pino`) e `admin/` (`PlantaObra`, `EditorPlanta`, `Ambientes`, `NovaRevisao`, `Recorte`).
- **Verificação:** `npm test -- planta`, `paridade.node.test.ts`, `spans.node.test.ts`, `npm run test:e2e -- e2e/planta.spec.ts`.

---

### Fase 5 — Migração por Contexto Delimitado — Onda 2 (Core Domain e Backend Node)

**Objetivo:** Migrar os contextos centrais de negócio (onde estão os arquivos mais longos de `dados/` e `telas/`) e alinhar a estrutura interna de `app/servidor/`. Um PR por subfase:

#### Fase 5A — Contexto `acessos`
- Extrair `Sessao`, `Acessos`, `Pessoas`, `Admins` e `EquipeServico` (check-in/out) dos adaptadores monolíticos.
- **Verificação:** `npm test -- acesso`, `npm run test:e2e -- e2e/acesso.spec.ts`.

#### Fase 5B — Contexto `obras`
- Extrair `Obras`, `Etapas` (com `util/etapas.ts` → `domain/`), `Pavimentos`, `Ambientes`, `Aditivos`, `Responsáveis` e `Organização`.
- **Verificação:** `npm test -- obra etapa`, `npm run test:e2e -- e2e/navegacao.spec.ts e2e/etapas.spec.ts e2e/admin-obra.spec.ts e2e/admin-etapas.spec.ts`.

#### Fase 5C — Contexto `fiscalizacao`
- Extrair `Registros`, `Pendências`, `Encerramentos`, `Observações do Dia`, `Publicações` e regras de envio (`dados/envio.ts` → `domain/` + `application/`).
- **Verificação:** `npm test -- registro pendencia observac`, `npm run test:e2e -- e2e/novo-registro.spec.ts e2e/pendencias.spec.ts e2e/observacoes.spec.ts`.

#### Fase 5D — Contexto `relatorios` (Frontend + Alinhamento de `app/servidor/`)
- **Frontend:** extrair `Relatórios`, `Painel` (`util/painel.ts`, `util/periodo.ts` → `domain/`), `Boletins` e `EditorBoletim` (`fixtureBoletim.ts` → `infrastructure/fixture/`).
- **Backend Node (`app/servidor/`):** organizar `app/servidor/boletim/` e `app/servidor/relatorio/` em `domain/`, `application/`, `infrastructure/` e `http/`, mantendo `app/api/gerar-boletim.ts`, `app/api/previa-boletim.ts` e `app/api/relatorio-pendencias.ts` como entrypoints finos (sem alterar URLs nem `app/vercel.json`).
- **Verificação:** `npm test -- relatorio boletim servidor`, `BOLETIM_EXIGIR_CHROMIUM=1 npx vitest run servidor`.

#### Fase 5E — Contexto `operacao`
- Migrar `offline/` (`fila.ts` → `domain/`, `armazenamento.ts` e `cacheConsultas.ts` → `infrastructure/indexeddb/`, `contexto.tsx` e `BarraSincronizacao.tsx` → `presentation/miniapp/`).
- Migrar telemetria de erros do cliente (`Erros.tsx`) e resumo de órfãos de storage.
- **Verificação:** `npm test -- offline erro`, `npm run test:e2e -- e2e/offline.spec.ts e2e/sw.spec.ts`.

---

### Fase 6 — Consolidação dos Composition Roots, Limpeza de Shims e Blindagem de Lint

**Objetivo:** Finalizar a transição removendo camadas temporárias e travando as fronteiras arquiteturais no CI.

- **Ações:**
  1. Mover `App.tsx`, `App.test.tsx`, `main.tsx` para `app/src/apps/miniapp/` e `AdminApp.tsx`, `AdminApp.test.tsx`, `admin/main.tsx`, `admin.css` para `app/src/apps/admin/`.
  2. Atualizar `app/index.html` (`/src/apps/miniapp/main.tsx`), `app/admin.html` (`/src/apps/admin/main.tsx`) e `app/vite.config.ts` (`setupFiles: ['./src/shared/test/setup.ts']`).
  3. Remover todos os arquivos *shim* (re-exports temporários) e os antigos adaptadores monolíticos `src/dados/supabase.ts`, `src/dados/fixture.ts`, `src/admin/dados/supabase.ts`, `src/admin/dados/fixture.ts`.
  4. Promover as regras de fronteira no `app/eslint.config.js` de `warn` para **`error`**, garantindo que nenhuma regressão arquitetural passe no CI.
  5. Conferir `app/dist/precache-manifest.json` após `npm run build` para confirmar que nenhum chunk exclusivo de `apps/admin/` ou `modules/*/presentation/admin/` entrou no precache do Mini App.
  6. Atualizar `README.md`, `CLAUDE.md` e `tasks/todo.md` refletindo a nova estrutura.
- **Verificação final:** executar **todos** os 5 jobs espelhados de `.github/workflows/ci.yml` (App, E2E + Chromium, Python, Edge Functions Deno, Banco Postgres).

---

## 5. Resumo Visual do Cronograma de Migração

```mermaid
flowchart LR
    F0["Fase 0<br/>Aliases, Lint (warn)<br/>e Baseline TDD"]
    F1["Fase 1<br/>Raiz: DOCS */ -> obras/"]
    F2["Fase 2<br/>shared/kernel,<br/>shared/infra, shared/ui"]
    F3["Fase 3<br/>Segregacao de Portas<br/>+ Contract Tests"]
    F4["Fase 4 (Onda 1)<br/>ra -> modelos -> plantas"]
    F5["Fase 5 (Onda 2)<br/>acessos -> obras -> fiscalizacao<br/>-> relatorios/servidor -> operacao"]
    F6["Fase 6<br/>Composition Roots,<br/>Remover Shims, Lint (error)"]

    F0 --> F1 --> F2 --> F3 --> F4 --> F5 --> F6
```

---

## 6. Regras de Governança Contínua (Para Novas Features)

A partir da conclusão da Fase 0, toda nova funcionalidade já deve nascer na estrutura-alvo:

1. **Escolha o Contexto Delimitado** correto em `app/src/modules/<contexto>/` antes de criar qualquer arquivo.
2. **Comece pelo Domínio e pelos Testes (TDD):** modele tipos, invariantes e regras puras em `domain/` com testes unitários rápidos (`domain/*.test.ts`).
3. **Defina a Porta antes do Adaptador:** declare o contrato mínimo necessário em `application/ports/` e cubra com testes de contrato antes de escrever código Supabase ou Fixture.
4. **Mantenha a UI fina:** componentes em `presentation/` não contêm regras de negócio nem chamadas diretas ao SDK do Supabase; delegam a hooks/use-cases.
5. **Respeite a fronteira Mini App vs Admin:** código compartilhado vai em `domain/`, `application/` ou `shared/`; código exclusivo de tela vai em `presentation/miniapp/` ou `presentation/admin/`.
6. **Não duplique contratos:** toda mudança de contrato continua nascendo em `docs/contrato-*.md` e nas migrations/testes de banco (`tests/db/`).
