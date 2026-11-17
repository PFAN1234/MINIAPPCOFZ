# Planta baixa no ajuste do QR (admin RA) — Plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans. Passos com checkbox (`- [ ]`).

**Objetivo:** na tela `/admin/obras/<slug>/ra`, com o ambiente aberto, mostrar a planta baixa real do pavimento enquadrada no cômodo, com cantos numerados e a marca do QR; sem dados, manter o desenho esquemático.

**Arquitetura:** a RPC `admin_listar_ra` passa a devolver `contorno_pagina` e a planta ativa do pavimento. O repositório admin assina a imagem. Uma função pura em `admin/ra/planta.ts` converte cantos da página em pixels e calcula a marca do QR por interpolação ao longo da parede (sem mapeamento global metros → página). `Desenho` (`RaObra.tsx`) escolhe planta real ou esquema.

**Stack:** React 19 + Vite + vitest + Testing Library, Supabase (SQL/RPC), texto em pt-BR.

**Spec:** `docs/superpowers/specs/2026-11-17-ra-admin-planta-baixa-design.md`

## Restrições globais
- Textos, commits e documentação em português do Brasil; commits terminam com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- `TelaRA.tsx` e o app do campo não mudam. O admin não importa código fora de `app/src/admin/` (exceto o que já importa).
- A migration só é aplicada em produção/dev depois de revisada e com o ok do usuário (`scripts/supabase_api.py`, nunca token no chat).
- Rodar testes em modo silencioso (`npx vitest run <arquivo> --reporter=dot`); suíte completa uma vez antes do PR.
- O admin lê o bucket `plantas` pela política `plantas_admin_select`.

## Foco de revisão
- `contorno_pagina` com tamanho diferente de `contorno` → desenho esquemático (nunca polígono torto).
- Falha ao assinar a URL (`url` nula) → desenho esquemático, sem erro na tela.
- Ambiente sem QR gravado nem válido (`qr` nulo) → planta sem marca.
- Parede de comprimento zero em metros → sem divisão por zero (marca no canto, sem `NaN`).
- Planta HD ausente → usa a imagem normal.

---

### Task 1: Migration da RPC

**Arquivos:**
- Criar: `supabase/migrations/20261122090000_ra_admin_planta.sql`

**Interfaces:**
- Produz: `admin_listar_ra(p_obra uuid) returns jsonb`; cada item ganha `contorno_pagina` (`[[x,y],...]` ou `null`) e `planta` (`null` ou `{imagem_path, pagina_pt:[w,h], recorte_pt:[x0,y0,x1,y1], largura, altura}`), da planta `ativa` do pavimento, usando `imagem_hd_path/largura/altura` quando `imagem_hd_path` não for nulo.

- [ ] **Passo 1:** `create or replace function public.admin_listar_ra(p_obra uuid)` com a mesma assinatura, `security definer`, `set search_path = ''` e `privado.exigir_admin()` de `20261113090000_ra.sql:236`, acrescentando `left join public.planta p on p.pavimento_id = pv.id and p.ativa` e os dois campos. Manter o `order by`, o `grant`/`revoke` de `20261113090000_ra.sql:351-355` (reaplicar, pois `create or replace` preserva, mas confirmar).
- [ ] **Passo 2:** conferir a sintaxe sem aplicar: `grep -c "contorno_pagina" supabase/migrations/20261122090000_ra_admin_planta.sql` ≥ 1 e revisar o SQL contra a migration original.
- [ ] **Passo 3:** commit `feat(ra): admin_listar_ra devolve contorno_pagina e a planta do pavimento`.

### Task 2: Cálculo da planta (função pura)

**Arquivos:**
- Criar: `app/src/admin/ra/planta.ts`, `app/src/admin/ra/planta.test.ts`

**Interfaces:**
- Consome: `Ponto`, `comprimentoParede` de `app/src/admin/ra/geometria.ts`.
- Produz (em `planta.ts`):
  - `interface PlantaAdmin { url: string; pagina_pt: [number, number]; recorte_pt: [number, number, number, number]; largura: number; altura: number }`
  - `interface PlantaEnquadrada { pontos: Ponto[]; viewBox: string; raio: number }`
  - `function enquadrarPlanta(contorno: Ponto[], contornoPagina: Ponto[] | null, planta: PlantaAdmin | null): PlantaEnquadrada | null` — `null` se faltar dado ou `contornoPagina.length !== contorno.length`; pixel = `((x·pagina_pt[0] − x0)·largura)/(x1−x0)`, `((y·pagina_pt[1] − y0)·altura)/(y1−y0)`; viewBox com margem 30% do maior lado do cômodo, `raio` = 3,5% do maior lado do viewBox (mesma fórmula do app em `TelaRA.tsx:696-722`).
  - `function marcaNaPlanta(contorno: Ponto[], pontos: Ponto[], qr: { parede: number; distancia_m: number; lado_m: number }): { a: Ponto; b: Ponto; centro: Ponto }` — com `c = comprimentoParede(contorno, parede)`, `f = distancia_m / c` (0 se `c` for 0), `centro = canto_i + f·(canto_{i+1} − canto_i)` nos pixels, `a`/`b` ao longo da parede a `±(lado_m/2)/c` do vetor da parede.

- [ ] **Passo 1: testes** (`planta.test.ts`), com a planta `{pagina_pt:[1000,500], recorte_pt:[100,50,900,450], largura:800, altura:400}`:
  - `enquadrarPlanta` com canto `[0.1, 0.1]` → pixel `[0, 0]`; com `[0.9, 0.9]` → `[800, 400]`.
  - retorna `null` com `contornoPagina` nulo, com `planta` nula e com tamanhos diferentes (foco 1).
  - `marcaNaPlanta`, contorno quadrado de 4 m, `pontos` `[[0,0],[400,0],[400,400],[0,400]]`, parede 0, `distancia_m: 1`, `lado_m: 0.5` → `centro [100,0]`, `a [75,0]`, `b [125,0]`.
  - parede de comprimento 0: `centro` igual ao canto, sem `NaN` (foco 4).
- [ ] **Passo 2:** `cd app && npx vitest run src/admin/ra/planta.test.ts --reporter=dot` → FALHA (módulo ausente).
- [ ] **Passo 3:** implementar as duas funções e as interfaces acima.
- [ ] **Passo 4:** mesmo comando → PASSA.
- [ ] **Passo 5:** commit `feat(ra): cálculo da planta e da marca do QR no admin`.

### Task 3: Dados do admin (tipos, repositório, fixture)

**Arquivos:**
- Modificar: `app/src/admin/dados/tipos.ts:760`, `app/src/admin/dados/supabase.ts:826`, `app/src/admin/dados/fixture.ts:246`
- Teste: `app/src/admin/dados/fixture.test.ts` (ou o teste existente do repositório fixture; seguir o padrão do arquivo)

**Interfaces:**
- Consome: `PlantaAdmin` de `admin/ra/planta.ts`.
- Produz: `AmbienteRA` ganha `contorno_pagina: [number, number][] | null` e `planta: PlantaAdmin | null`. `listarRA` do Supabase assina `planta.imagem_path` em lote (`cliente.storage.from('plantas').createSignedUrls`, 3600 s, como `urlsFotos` em `supabase.ts:575`) e entrega `planta` com `url`; se a assinatura falhar ou o caminho não vier, `planta` vira `null` (sem lançar). Converte números com `Number(...)`, como o `listarRA` atual.

- [ ] **Passo 1: teste** — `listarRA` da fixture devolve `terreo-administracao` com `contorno_pagina` de 4 pontos e `planta` não nula, e `terreo-alojamento` com os dois `null`.
- [ ] **Passo 2:** rodar o teste → FALHA.
- [ ] **Passo 3:** estender `AmbienteRA`; na fixture, dar à Administração `contorno_pagina` (4 pontos de um retângulo normalizado dentro do recorte) e `planta` com `url` de imagem inline pequena (data URI SVG/WebP), `pagina_pt`/`recorte_pt`/`largura`/`altura` coerentes; os demais ambientes `null`. No Supabase, mapear o retorno da RPC e assinar a URL conforme Interfaces.
- [ ] **Passo 4:** teste PASSA e `cd app && npx tsc -b` sem erros.
- [ ] **Passo 5:** commit `feat(ra): admin recebe contorno_pagina e a planta do pavimento`.

### Task 4: Tela

**Arquivos:**
- Modificar: `app/src/admin/telas/ra/RaObra.tsx` (componentes `Ambiente` na linha 146 e `Desenho` na linha 325), `app/src/admin/admin.css` (após `.ra-desenho`, linha ~814)
- Teste: `app/src/admin/telas/ra/RaObra.test.tsx`

**Interfaces:**
- Consome: `AmbienteRA` (Tarefa 3), `enquadrarPlanta` e `marcaNaPlanta` (Tarefa 2).
- Produz: `Desenho` passa a receber `ambiente: AmbienteRA` além de `qr`; usa `enquadrarPlanta(ambiente.contorno, ambiente.contorno_pagina, ambiente.planta)`. Com planta: `<image href={planta.url}>` nas dimensões `largura × altura`, polígono do cômodo (classe `ra-planta-comodo`), círculo e número em cada canto (mesmos números das paredes), marca do QR (`data-testid="ra-marca"`, mesmas classes `ra-qr`/`ra-qr-centro`) calculada por `marcaNaPlanta`; o `<svg>` ganha `data-testid="ra-desenho"` e `data-modo="planta"`. Sem planta: o desenho atual, com `data-modo="esquema"`.

- [ ] **Passo 1: testes** em `RaObra.test.tsx`:
  - Abrir "Administração": `getByTestId('ra-desenho')` tem `data-modo="planta"` e contém um `<image>` com o `href` da fixture; `ra-marca` presente.
  - Trocar a distância para outro valor muda a posição de `ra-marca` (comparar `cx` do círculo antes e depois).
  - Abrir "Alojamento" (fixture sem planta): `data-modo="esquema"` e nenhum `<image>` (foco 1 e 2).
  - Ambiente sem QR gravado, campos inválidos (distância vazia): planta sem `ra-marca` (foco 3).
- [ ] **Passo 2:** `cd app && npx vitest run src/admin/telas/ra --reporter=dot` → os novos FALHAM, os antigos passam.
- [ ] **Passo 3:** implementar. Em `Ambiente`, trocar `<Desenho contorno=… qr=…/>` por `<Desenho ambiente={ambiente} qr={qr} />`; manter o ramo esquemático intacto. CSS: `.ra-desenho image` sem preenchimento, `.ra-planta-comodo` com `fill` translúcido e traço usando as variáveis `--adm-*` já existentes.
- [ ] **Passo 4:** testes da pasta PASSAM; `npx tsc -b` e `npx eslint src/admin` sem erros.
- [ ] **Passo 5:** commit `feat(ra): planta baixa no ajuste do QR do admin`.

### Task 5: Fechamento

**Arquivos:**
- Modificar: `tasks/todo.md`, `docs/admin.md` ou `docs/ra.md` (uma linha, na seção do cadastro do QR)

- [ ] **Passo 1:** registrar em `tasks/todo.md` e na doc; suíte completa `cd app && npx vitest run --reporter=dot | tail` sem falhas, `npx tsc -b`, `npx eslint .`.
- [ ] **Passo 2:** pedir ao usuário o ok para aplicar a migration (dev, depois produção) com `scripts/supabase_api.py` e conferir `admin_listar_ra` no banco.
- [ ] **Passo 3:** commit, push e PR em português.
