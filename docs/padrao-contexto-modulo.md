# Padrão de contexto (módulo) validado no `ra`

Modelo da Fase 3 de `docs/plano-arquitetura-organizacao.md`, a replicar nas Fases 4 e 5. Referência viva: `app/src/modules/ra/`.

## Estrutura

```
app/src/modules/<contexto>/
  domain/         tipos puros e regras sem I/O (ra: tipos.ts, geometria.ts, planta.ts, qr.ts)
  application/
    ports/        portas segregadas + contract test (ra: RaRepositorio.port.ts, Camera.port.ts, LeitorQr.port.ts)
  infra/          adaptadores: RaSupabaseAdapter.ts, RaFixtureAdapter.ts, browser/, qr/, three/
  presentation/
    miniapp/      telas do campo (ra: TelaRA.tsx, DiagnosticoRA.tsx, ra.css)
    admin/        telas do site admin (ra: RaObra.tsx)
```

Importar sempre por alias (`@modules/ra/...`, `@shared/...`), sem shims nos caminhos antigos.

## Tipos puros

Ficam em `domain/` (ra: `domain/tipos.ts`). Quem precisa deles (`dados/tipos.ts`, `shared/`) importa de lá; o domínio não importa de volta. Regra duplicada entre miniapp e admin vira uma só em `domain/`.

## Porta segregada e contract test

- A porta tem só o que o contexto usa (`RaRepositorio.port.ts`), não o repositório inteiro.
- O comportamento é descrito uma vez, em `contratoX(nome, criar)` (ra: `RaRepositorio.contract.ts`, arquivo sem `.test`, sem teste próprio).
- Cada adaptador tem um arquivo `*.contract.test.ts` curto que chama `contratoX('nome', () => criarAdaptador())` (ra: `RaFixture.contract.test.ts`).
- Novo adaptador entra no contrato sem copiar casos.

## Adaptadores

`RaSupabaseAdapter.ts` e `RaFixtureAdapter.ts` implementam a mesma porta, cada um com estado próprio (a fixture guarda em memória, sem compartilhar entre instâncias). A criação é feita por `criarRaSupabase(...)` / `criarRaFixture()` e registrada nas fábricas existentes (`dados/supabase.ts`, `dados/fixture.ts`, `admin/dados/*`).

## Composição nas fachadas

`Repositorio` e `RepositorioAdmin` estendem `Pick<Porta, ...>` só com os métodos que cada app usa:
`Repositorio extends Pick<RaRepositorio, 'obterGeometria'>`, `RepositorioAdmin extends Pick<RaRepositorio, 'listarRA' | 'definirQr' | 'removerQr'>`. Os hooks e telas continuam usando a fachada.

## Fronteiras ESLint (`app/eslint.config.js`, `--max-warnings 0`)

| Camada | Não pode importar |
|---|---|
| `domain` | react, router, supabase, idb, three, pdfjs, application, infra, presentation |
| `application` | react, router, supabase, infra, presentation |
| `presentation` | adaptadores concretos de outros módulos (usa domain, application, infra do próprio módulo, `shared/` e a fachada de dados) |
| `shared/kernel` | react, supabase, idb, three, pdfjs |

Detalhes e lista completa: `CAMADAS_PROIBIDAS` no arquivo de configuração.

## `three` isolado

Todo uso de `three` fica em `modules/ra/infra/three/` (`motor.ts`, `malha.ts`, `pose.ts`, `geometria3d.ts`). As telas carregam o motor por `import()` dinâmico, mantendo o chunk `motor-3d` fora do bundle inicial. Ao mover telas, comparar os nomes em `dist/assets` antes e depois do build (devem ser os mesmos: `TelaRA`, `DiagnosticoRA`, `motor-3d`).

## Checklist para a Fase 4 e 5

1. Mover tipos e regras puras para `domain/`; testes junto (TDD: teste antes).
2. Escrever a porta segregada em `application/ports/` e o `contratoX`.
3. Fatiar o adaptador Supabase e a fixture em `infra/`, cada um com estado próprio e seu `*.contract.test.ts`.
4. Trocar as fachadas por `Pick<Porta, ...>` e ajustar fábricas e hooks.
5. Mover telas para `presentation/miniapp/` e `presentation/admin/` (`git mv`, imports por alias, sem shims); apagar pastas antigas vazias.
6. Procurar caminhos antigos em `vite.config.ts`, `e2e/`, `scripts/` e `docs/`.
7. Conferir: `npm run typecheck`, `npx eslint src --max-warnings 0`, suíte completa, `npm run build`, `npm run build:fixture`, e2e do contexto e chunks de `dist/assets`.

### Lições da Fase 4A (`modelos`)

- Use-case só quando há lógica real: `publicarModelo` recebe o `hash` injetado (o SHA-256 vem do navegador/teste), por isso é testável sem I/O; um repasse sem regra não ganha use-case.
- O contrato da porta, `contratoX`, recebe um `criar()` que devolve o adaptador e os helpers de teste (por exemplo, semear dados); fixture e Supabase rodam o mesmo contrato.
- O chunk herda o nome do arquivo-fonte, não da pasta: mover `VisualizadorModelo.tsx` não mudou o nome, então a regex do precache em `vite.config.ts` continuou valendo. Confira `dist/assets` e `precache-manifest.json` antes e depois de mover.

### Lições da Fase 4B (`plantas`)

- Teste de integração que cruza camadas (domínio + porta + adaptador) fica em `application/use-cases/`, não em `domain/`, que deve testar só regra pura.
- Constante compartilhada entre contextos vai para `shared/kernel` (como `REVISAO_VALIDA`), nunca importada de outro módulo.
- Use-case recebe as dependências injetadas (repositório, serviço de PDF), por isso roda com fixture/serviço falso, sem I/O.

### Lições da Fase 5A (`acessos`)

- Tela só do contexto sai de `telas/`, `components/` e `admin/telas/` junto com seu teste; `NomeExibicao.test.tsx` cruza contextos e fica onde está. Um script que reescreve imports relativos para alias (`@shared/`, `@modules/`) evita erro manual; imports de `dados/` e `admin/` seguem relativos até a Fase 5.

### Lições da Fase 5B parte 2 (`obras` admin)

- Fixture que divide estado com outro contexto (etapas, obras, boletins) recebe os arrays mutáveis por parâmetro e dependências cruzadas por callback (`removerObra`, `aoExcluirEtapa`), nunca por global; o contrato descreve a semente que espera.
- Tipos movidos por script que reescreve imports (aspas simples e duplas) e tipos de memória da fixture exportados do próprio adaptador.

### Lições da Fase 5B parte 3 (`obras` telas)

- Ao mover telas com `vi.mock` global (como `MapaEscolha.tsx` em `shared/test/setup.ts`), atualizar o caminho do mock para o alias `@modules/...` junto com a movimentação; caso contrário o jsdom tenta carregar a dependência real (Leaflet).
- Separar os hooks do contexto de `admin/dados/hooks.ts` para `modules/<ctx>/presentation/admin/hooks.ts` reduz o acoplamento das telas e mantém as chaves de cache do React Query idênticas.

### Lições da Fase 5C (`fiscalizacao`)

- Use-cases com orquestração real (`enviarRegistro`, `enviarEncerramento`) recebem apenas `Pick<Porta, ...>` em vez da fachada `Repositorio`, desacoplando `application/use-cases/` do restante do app.
- Adaptador fixture de registros expõe `todos()` para alimentar o cálculo de contagens em `ObrasFixtureAdapter` sem duplicar estado nem criar dependência cíclica.

### Lições da Fase 5D (`relatorios`)

- Helpers de calendário puros usados em múltiplos contextos (`dataValida`, `somarDias`, `limitesPeriodo`, `dentroDoPeriodo`) pertencem a `shared/kernel/periodo.ts`; regras puras do cadastro de etapa (`fixtureBoletim.ts`) pertencem a `modules/obras/infra/camposEtapa.ts`, eliminando dependência invertida entre `obras` e `relatorios`.
- Testes de fixture determinística (`painelFixture`) ficam nos arquivos de contrato/infra, mantendo `domain/*.test.ts` 100% puro.

### Lições da Fase 6 (fechamento)

- Ao mover `admin.css` para `apps/admin/`, atualizar também os `@import` CSS relativos (`../../shared/ui/estilo/...`).
- Subir `no-restricted-imports` de `warn` para `error` só depois de remover todos os shims e mover os Composition Roots garante que as fronteiras de camada e o isolamento `apps/miniapp` vs `apps/admin` sejam travados no CI sem falsos positivos.
