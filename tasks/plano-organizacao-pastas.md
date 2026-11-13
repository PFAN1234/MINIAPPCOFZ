# Plano: organização de pastas e consolidação do repositório

Decisões de 2026-11-12. Checklist em `tasks/todo.md` (seção "Organização de pastas") e marco registrado em `docs/ROADMAP.md`.

## Objetivo

Reduzir o ruído na raiz do repositório, eliminar nomes de diretórios com espaços e maiúsculas (`DOCS COFZ/`, `DOCS HTO/`), atualizar o `README.md` para refletir o estado real do projeto (Mini App + `/admin/` + Supabase + pipeline) e tornar explícita a fronteira interna de `app/src/` — tudo isso de forma incremental e sem quebrar o deploy na Vercel (`app/`), o CI (`.github/workflows/ci.yml`), os scripts Python nem os testes.

## Decisões

| Tema | Decisão |
| --- | --- |
| Monorepo (`apps/` / `packages/`) | **Não fazer.** `app/` já é o `Root Directory` da Vercel, `app/vite.config.ts` já separa os bundles (`index.html` e `admin.html`) e exclui o admin do `precache-manifest.json`. |
| `supabase/`, `data/`, `tests/` | **Manter onde estão.** Possuem acoplamento testado com `app/vite.config.ts`, `paridade.node.test.ts`, `tests/test_*.py` e `.github/workflows/ci.yml`. |
| Capturas na raiz | Mover `Screenshot 2026-11-06 *.png` para `docs/mockups/referencias/`. |
| Pastas de PDFs/IFCs originais | Unificar `DOCS COFZ/` e `DOCS HTO/` (e o diretório local ignorado `public/ifc/`) em `obras/<slug>/` (`obras/cofz/pdf/`, `obras/hto/pdf/`, `obras/hto/ifc/`). |
| `tasks/` | **Manter na raiz** (referenciado por `CLAUDE.md`, `dashboard/collect.py`, `supabase/migrations/*.sql` e `tests/db/test_admin*.py`), atualizando o `README.md`. |
| `app/src/` | Separar gradualmente o que é exclusivo do Mini App (`miniapp/`) e o que é compartilhado (`shared/`), mantendo `admin/` isolado. |

## Fases

### Fase 1 — Limpeza da raiz (risco zero)

1. [ ] Mover as 4 capturas da raiz (`Screenshot 2026-11-06 061618.png`, `061729.png`, `063757.png`, `072441.png`) para `docs/mockups/referencias/`.
2. [ ] Atualizar as referências em `README.md` e `docs/mockups/README.md`.
3. [ ] Conferir que não restaram links quebrados nos arquivos Markdown alterados.

### Fase 2 — Padronização de `DOCS COFZ/` e `DOCS HTO/` → `obras/<slug>/`

1. [ ] Mover `DOCS COFZ/PDF/` → `obras/cofz/pdf/` e `DOCS COFZ/README.md` → `obras/cofz/README.md`.
2. [ ] Mover `DOCS HTO/PDF/` → `obras/hto/pdf/` e `DOCS HTO/README.md` → `obras/hto/README.md`.
3. [ ] Mover o diretório local ignorado `public/ifc/` → `obras/hto/ifc/`.
4. [ ] Atualizar `.gitignore`: trocar `/DOCS */IFC/*.ifc` e `/public/ifc/` por `/obras/*/ifc/*.ifc`.
5. [ ] Atualizar `"pasta_pdf"` em `data/hto/obra.json` (`"obras/hto/pdf"`) e `data/cofz/obra.json` (`"obras/cofz/pdf"`).
6. [ ] Re-executar o pipeline Python para manter paridade dos JSONs e seeds:
   ```bash
   python3 scripts/extrair_ambientes.py --obra hto
   python3 scripts/gerar_plantas.py --obra hto
   python3 scripts/gerar_seed.py --obra hto

   python3 scripts/extrair_ambientes.py --obra cofz
   python3 scripts/gerar_plantas.py --obra cofz
   python3 scripts/gerar_seed.py --obra cofz

   python3 scripts/importar_config_obras.py
   ```
7. [ ] Atualizar caminhos diretos em:
   - `app/e2e/planta.spec.ts` (`PDF_COFZ` → `../../obras/cofz/pdf/CE01-01PE02-ARQ-DE009-R06.pdf`)
   - `artifacts/validation/pdf/reproduce/inspect_pdfs.py` (`DOCS HTO/PDF` → `obras/hto/pdf`)
   - `dashboard/index.html`, `scripts/README.md`, `docs/validacao-hto.md`, `CLAUDE.md`, `README.md`, `docs/ROADMAP.md`
8. [ ] Verificação da fase:
   - `python3 scripts/importar_config_obras.py --verificar`
   - `pytest -q --ignore=tests/db`
   - `cd app && npm test && npm run test:e2e -- e2e/planta.spec.ts`

### Fase 3 — Atualização da documentação raiz

1. [ ] Reescrever `README.md` para refletir a arquitetura atual (`app/` com Mini App e `/admin/`, `supabase/`, `scripts/`, `data/`, `obras/`, `tasks/`, `docs/`, `tests/`), mantendo os mockups como seção histórica/referência.
2. [ ] Conferir se `dashboard/serve.py` e `dashboard/collect.py` carregam sem erros.

### Fase 4 — Organização interna de `app/src/` *(após estabilização das entregas de UI em curso)*

1. [ ] Separar código exclusivo do Mini App em `app/src/miniapp/` (`telas/`, `offline/`, `modelo/`, `App.tsx`, `App.test.tsx`, `main.tsx`, `registrarSw.ts`).
2. [ ] Agrupar código compartilhado entre Mini App e `/admin/` em `app/src/shared/` (`components/` comuns, `estilo/`, `util/`, `dados/tipos.ts`, `telegram*.ts`), mantendo `app/src/admin/` intacto.
3. [ ] Atualizar `app/index.html` (`/src/miniapp/main.tsx`), imports relativos, `app/vite.config.ts` (`setupFiles`), `app/tsconfig.app.json` e `app/tsconfig.testes-node.json`.
4. [ ] Conferir `app/dist/precache-manifest.json` após `npm run build` para garantir que `arquivosSoDoAdmin` continua excluindo todos os chunks exclusivos do `/admin/`.

## Verificação final (espelhando `.github/workflows/ci.yml`)

| Camada | Comando |
| --- | --- |
| **App (TS + Vite + Vitest)** | `cd app && npm run typecheck && npm run lint && npm test && npm run build && npm run build:fixture` |
| **App (E2E Playwright)** | `cd app && npm run test:e2e` |
| **Python + Seeds** | `pytest -q --ignore=tests/db && python3 scripts/importar_config_obras.py --verificar` |
| **Banco (Postgres)** | `pytest -q tests/db` |
| **Edge Functions (Deno)** | `cd supabase/functions && deno fmt --check && deno lint && deno check */*.ts && deno test` |
