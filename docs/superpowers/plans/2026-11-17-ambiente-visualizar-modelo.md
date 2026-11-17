# Visualizar modelo 3D a partir do ambiente — Plano

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: superpowers:subagent-driven-development. Passos com checkbox.

**Objetivo:** botão "Visualizar modelo" na tela do ambiente abre o modelo 3D com corte e câmera no ambiente, com chip "Só este ambiente".

**Arquitetura:** `VisualizadorModelo` ganha prop opcional `ambiente`; função pura `planosDeCorte`; nova tela/rota `AmbienteModelo`; botão em `Ambiente.tsx`.

**Stack:** React 19, Vite, vitest, Three.js, That Open (`@thatopen/components`, `@thatopen/fragments`), pt-BR.

**Spec:** `docs/superpowers/specs/2026-11-17-ambiente-visualizar-modelo-design.md`

## Restrições globais
- Textos, commits e docs em pt-BR; commits terminam com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Imports com extensão (`'./x.ts'`).
- Sem a prop `ambiente`, `VisualizadorModelo` e as telas `Modelo`/`Obra` se comportam como hoje.
- Não alterar o alinhamento da RA: o `MotorRA` só troca a construção dos planos pela função nova.
- Testes silenciosos (`npx vitest run <arquivo> --reporter=dot`); suíte completa uma vez antes do PR.

## Foco de revisão
- Ambiente sem geometria ou obra sem modelo → botão não aparece.
- Ambiente inativo → botão não aparece (mesma regra da RA).
- Rota com código inexistente ou sem geometria → mensagem, sem tela quebrada.
- Dispositivo sem WebGL → mesmo aviso do visualizador atual.
- Corte desligado → enquadra todos os modelos ativos, como hoje.

---

### Task 1: Planos de corte (função pura)

**Arquivos:**
- Criar: `app/src/modelo/corte.ts`, `app/src/modelo/corte.test.ts`
- Modificar: `app/src/ra/motor.ts:57-65` (usar a função)

**Interfaces:**
- Consome: `caixaDeCorte(g: GeometriaAmbiente)` de `app/src/ra/geometria.ts:89` → `[xmin,ymin,zmin,xmax,ymax,zmax]`.
- Produz: `planosDeCorte(caixa: readonly number[]): THREE.Plane[]` (6 planos, mesma ordem e sinais de `motor.ts:58-63`: `Plane(Vector3(1,0,0), -x0)`, `(-1,0,0), x1`, `(0,1,0), -y0`, `(0,-1,0), y1`, `(0,0,1), -z0`, `(0,0,-1), z1`) e `caixaBox3(caixa: readonly number[]): THREE.Box3`.

- [ ] **Passo 1: testes** — caixa `[0,0,0,4,3,5]`: ponto `(2,1,2)` tem `distanceToPoint >= 0` nos 6 planos; ponto `(5,1,2)` tem distância negativa em ao menos um; `caixaBox3` tem `min (0,0,0)` e `max (4,3,5)`.
- [ ] **Passo 2:** `cd app && npx vitest run src/modelo/corte.test.ts --reporter=dot` → FALHA.
- [ ] **Passo 3:** implementar as duas funções; em `motor.ts` trocar a construção inline por `planosDeCorte(caixaDeCorte(geometria))` mantendo `this.planos` e `renderer.clippingPlanes`.
- [ ] **Passo 4:** `npx vitest run src/modelo src/ra --reporter=dot` verde; `npx tsc -b` limpo.
- [ ] **Passo 5:** commit `feat(modelo): planos de corte em função pura`.

### Task 2: Visualizador com ambiente

**Arquivos:**
- Modificar: `app/src/modelo/VisualizadorModelo.tsx`, `app/src/index.css` (chip, perto de `.visualizador-enquadrar`)

**Interfaces:**
- Consome: `planosDeCorte`, `caixaBox3` (Task 1); `GeometriaAmbiente` (`ra/geometria.ts:16`).
- Produz: `Props.ambiente?: GeometriaAmbiente`. Com ela: (a) antes do primeiro `load`, `fragments.core.baseCoordinates = [...referencial.coordenadas]` se houver referencial; (b) matriz de correção por modelo = `ambiente.matrizes[m.sigla] ?? m.matriz`; (c) `load(buffer, { modelId, clippingPlanes: planos })` com `planos = planosDeCorte(caixaDeCorte(ambiente))` guardado em ref, e `world.renderer.three.clippingPlanes = planos`; (d) estado `soAmbiente` (inicia `true`): ao desligar, `planos.length = 0`; ao ligar, `planos.push(...planosDeCorte(...))`; ambos seguidos de `fragments.core.update(true)`; (e) `enquadrar` usa `caixaBox3(caixaDeCorte(ambiente))` quando `soAmbiente`, senão o enquadramento atual; (f) botão chip `aria-pressed={soAmbiente}` com texto "Só este ambiente" ao lado de "Enquadrar", só quando há `ambiente`. Sem `ambiente`: comportamento idêntico ao atual.

- [ ] **Passo 1:** implementar conforme Interfaces; o efeito principal não deve recriar o motor ao alternar `soAmbiente` (usar ref + efeito separado, como `ativos`).
- [ ] **Passo 2:** `npx tsc -b` e `npx eslint src/modelo` limpos; `npx vitest run src/telas/ObraModelo.test.tsx src/telas --reporter=dot` sem regressão.
- [ ] **Passo 3:** commit `feat(modelo): visualizador com corte e câmera no ambiente`.
- Nota: WebGL não roda no jsdom; sem teste unitário do componente (a lógica testável está na Task 1).

### Task 3: Tela, rota e botão

**Arquivos:**
- Criar: `app/src/telas/AmbienteModelo.tsx`, `app/src/telas/AmbienteModelo.test.tsx`
- Modificar: `app/src/App.tsx:43` (rota `obras/:slug/ambientes/:codigo/modelo`), `app/src/telas/Ambiente.tsx:~75` (botão), `app/src/telas/Ambiente.test.tsx`

**Interfaces:**
- Consome: `VisualizadorModelo` com `ambiente` (Task 2), `useGeometria`, `useModelos`, `useAmbiente`/detalhe do ambiente como `Ambiente.tsx` e `NovoRegistro.tsx:44-60` fazem, `modeloComCache` como `telas/Modelo.tsx`.
- Produz: tela `AmbienteModelo` (lazy do visualizador, `Suspense`), título = nome do ambiente, subtítulo com link para o ambiente; sem geometria/modelo: `cartao-info` com texto "Este ambiente não tem modelo 3D disponível." No botão, `navigate(`/obras/${obra.slug}/ambientes/${ambiente.codigo}/modelo`)`, classes `botao botao-secundario botao-bloco`, texto "Visualizar modelo", renderizado só com `temRA`, **entre** "Novo registro" e "Comparar com o modelo (RA)".

- [ ] **Passo 1: testes** — em `Ambiente.test.tsx`, seguindo o padrão do teste de RA (linha ~52): com geometria e modelo na fixture, o botão "Visualizar modelo" existe e vem antes de "Comparar com o modelo (RA)" na ordem do DOM; ambiente inativo ou obra sem modelo → ausente. Em `AmbienteModelo.test.tsx`: rota com código sem geometria mostra a mensagem. Mocke o visualizador lazy (`vi.mock('../modelo/VisualizadorModelo.tsx', ...)`) como `ObraModelo.test.tsx` faz.
- [ ] **Passo 2:** rodar os testes → novos FALHAM.
- [ ] **Passo 3:** implementar tela, rota e botão.
- [ ] **Passo 4:** `npx vitest run src/telas --reporter=dot`, `npx tsc -b`, `npx eslint src` limpos.
- [ ] **Passo 5:** commit `feat: botão Visualizar modelo no ambiente`.

### Task 4: Fechamento

- [ ] Registrar em `tasks/todo.md` e uma seção em `docs/ra.md` ou `docs/ROADMAP.md` (onde couber); suíte completa `cd app && npx vitest run --reporter=dot | tail`, `npx tsc -b`, `npx eslint .`; commit.
- [ ] Informar ao usuário que corte e enquadramento precisam ser conferidos com o `.frag` real num navegador com WebGL.
