# Plano — Visualizador do modelo federado (That Open Company)

Branch: `feature/visualizador-modelo-federado`. Substitui o item "Visualizador Three.js" da fase 9 de `tasks/plano-app.md`: o visualizador usa a That Open Engine (antigo IFC.js) e modelos `.frag`.

## Decisões (2026-11-11)

- Bibliotecas: `@thatopen/components` 3.6, `@thatopen/fragments` 3.6, `three` 0.187 e `web-ifc` 0.0.79 (peer). `@thatopen/components-front` só se a v2 precisar de seleção/realce.
- Origem dos `.frag`: banco de dados, inicialmente Supabase Storage. No teste local, arquivos em disco.
- Conversão IFC → `.frag`: script Node offline (`scripts/ifc_para_frag.mjs`), não no navegador. O app só carrega `.frag`.
- Pastas do teste: IFC em `public/ifc/` (raiz, fora do Git); `.frag` em `app/public/modelos/<obra>/` (o Vite serve em `/modelos/<obra>/<arquivo>.frag`; fora do Git e do precache do service worker).
- Escopo v1: carregar, orbitar/zoom/pan com toque, ligar/desligar cada disciplina, enquadrar a câmera. Sem seleção de elementos nem ligação ambiente → IfcSpace (v2/v3).
- Primeiro modelo do teste: ARQ direto (~208 MB). Medir tempo e memória cedo; plano B abaixo.

## Arquitetura

```text
public/ifc/*.ifc ──► scripts/ifc_para_frag.mjs ──► app/public/modelos/<obra>/<SIGLA>.frag
                                                   (+ manifesto.json)
                                                        │
Supabase Storage (bucket `modelos`, privado) ◄── publicar_modelos.mjs (fase B)
                                                        │
App: Modelo.tsx ► useModeloFederado ► FragmentsManager ► Three.js (canvas)
```

- Manifesto por obra: `manifesto.json` com `[{ sigla, arquivo, bytes, hash }]`. É ele que diz ao app quais chips existem e de onde baixar. Em fixture/teste vem de `/modelos/<obra>/manifesto.json`; no Supabase, de uma RPC/tabela `modelo` (fase B).
- Repositório de dados: nova função `listarModelos(slug)` e `urlModelo(modelo)` no `Repositorio` (fixture e Supabase), no padrão de `urlLocalDaImagem`.
- Chunk próprio: `Modelo.tsx` carrega o visualizador com `React.lazy` + `import()`; Three, That Open e o worker não entram no bundle inicial.
- `web-ifc` só no script de conversão (devDependency); o app usa só o worker de fragments (`worker.mjs` copiado/servido pelo Vite).

## Fases

### A — Conversão e visualizador local (esta branch)

1. Dependências: `app`: `three`, `@thatopen/components`, `@thatopen/fragments`, `@types/three`. Raiz/scripts: `web-ifc`, `@thatopen/fragments` (importador). Verificar compatibilidade com Node 24 e Vite 8.
2. `.gitignore`: `/public/ifc/`, `/app/public/modelos/`. Garantir que o `montarManifesto` do precache não inclua `/modelos/`.
3. `scripts/ifc_para_frag.mjs --obra hto [--ifc <arquivo>]`: lê `public/ifc/*.ifc`, usa `IfcImporter` (`@thatopen/fragments`) com WASM do `web-ifc`, grava `<SIGLA>.frag` e atualiza `manifesto.json`. Sigla vem do nome do arquivo (`CE01-14PE01-ARQ-R05` → `ARQ`). Roda com `--max-old-space-size` alto; imprime tempo, tamanho do `.ifc` e do `.frag`. Teste com IFC pequeno (fixture mínimo) e verificação de saída.
4. `Modelo.tsx` + `VisualizadorModelo.tsx` (lazy): `Components` → `Worlds` (cena, câmera, renderer) → `FragmentsManager` com worker. Carrega cada `.frag`, adiciona à cena, enquadra (`fitToSphere`/bounding box). Estados: carregando com progresso, erro, vazio (sem modelos), sem WebGL.
5. Chips de disciplina viram toggles reais (`aria-pressed`); chips sem `.frag` ficam desabilitados como hoje.
6. Toque: orbitar 1 dedo, pan/zoom 2 dedos (CameraControls já cobre). Botão "Enquadrar". Respeitar `useVoltar`/BackButton do Telegram e liberar GPU ao desmontar (`dispose` de world, fragments, worker).
7. Testes: unitário do manifesto/hook com doubles (jsdom não tem WebGL); e2e Playwright com `VITE_DADOS=fixture` valida estado de carga/erro e toggle de chips com visualizador simulado. Validação visual real no Chromium com WebGL + no Telegram Desktop/Android.

Critério de pronto da A: o ARQ converte, abre no navegador local e no Telegram Web, toggles funcionam, `npm run typecheck`, `lint` e `test` passam, bundle inicial sem Three.

### B — Supabase

1. Migração: bucket privado `modelos` (`<obra_id>/<sigla>-<revisao>.frag`, mime `application/octet-stream`, limite de tamanho alto), tabela `modelo (obra_id, sigla, revisao, caminho, bytes, hash)`, RLS por participante da obra, RPC `listar_modelos(obra)`.
2. `scripts/publicar_modelos.mjs` (padrão de `publicar_plantas.py`): envia `.frag` com chave de serviço local, nunca no app.
3. App: `Repositorio.listarModelos`/URL assinada; download com progresso; cache HTTP/IndexedDB por `hash` para reabrir sem baixar de novo (offline fica fora da v1).

### C — Evolução (fora desta branch)

Seleção e propriedades; focar no ambiente (IfcSpace ↔ `ambientes.json`); cortes/isolamento por pavimento; modelos ELT/HID/ESG/DRE/PCI/VES quando existirem.

## Riscos

| Risco | Plano B |
| --- | --- |
| ARQ de ~208 MB gera `.frag` grande demais para o WebView do Telegram (memória do celular). | Medir. Se estourar: dividir o ARQ por pavimento em vários `.frag`; carregar sob demanda; reduzir geometria/instâncias na conversão; ou limitar o ARQ a desktop. |
| Conversão estoura a memória do Node. | `--max-old-space-size=8192`; converter em máquina com mais RAM; processar em lotes. |
| API do v3 mudou (IfcImporter, worker, `fitToSphere`). | Consultar a documentação atual (Context7) antes de implementar; travar versões exatas. |
| WebGL indisponível em alguns WebViews. | Estado de erro claro com ação de voltar. |
| IFC (confidencial) vazar para o Git/Vercel. | `.gitignore` + `vercel.json` sem a pasta; `.frag` só pelo Storage privado. |
| Georreferenciamento: modelos ARQ/ANT/TLD com origens diferentes. | Já validado em `docs/validacao-hto.md` (matriz GLB); aplicar a mesma transformação no `.frag` se o federado desalinhar. |

## Ordem de execução sugerida

1. Você coloca `.ifc` em `public/ifc/`.
2. Passos A.1–A.3 (dependências, ignore, script) → conversão do ARQ e medição.
3. A.4–A.6 (visualizador) → validar com o `.frag` real.
4. A.7 (testes) → revisão → PR.
5. Fase B.

## Andamento (2026-11-11)

- [x] A.1 Dependências em `app/` (versões exatas).
- [x] A.2 `.gitignore`; precache sem chunk/worker 3D; build não copia `app/public/modelos/`.
- [x] A.3 `app/scripts/ifc_para_frag.mjs` (`npm run modelos -- --obra hto`; ficou em `app/scripts/` para achar os `node_modules`). ARQ-R06: 206 MB IFC → 12,4 MB `.frag` em 14 s. Risco de tamanho do ARQ resolvido.
- [x] A.4–A.6 `Modelo.tsx` + `modelo/VisualizadorModelo.tsx` (lazy), `modelo/modelos.ts`; toggle por disciplina e botão Enquadrar. Verificado no Chromium com WebGL.
- [x] A.7 e2e Playwright (`app/e2e/modelo.spec.ts`). Falta a validação no Telegram (Desktop/Android).
- Chunk do visualizador ~2,4 MB + worker ~1,3 MB (carregados só nesta tela). A marca "That Open Company" aparece no canto do canvas (vem da biblioteca).

### Fase B — Supabase (2026-11-11, testada no Supabase local)

- [x] Migration `20261111150000_fase9_modelos.sql`: tabela `modelo` (`obra_id`, `sigla`, `revisao`, `caminho`, `bytes`, `hash`; única por obra+sigla), RLS de leitura para participantes, bucket privado `modelos` (200 MB, `application/octet-stream`) com política de leitura por participante. Sem RPC: o app lê a tabela direto, como faz com `planta`.
- [x] Grants mínimos ao `service_role` (só `select` em `obra` e CRUD em `modelo`): o papel não tem grants nas tabelas do app, então o publicador não funcionava sem eles.
- [x] `Repositorio.listarModelos`/`baixarModelo` (fixture lê `/modelos/`, Supabase lê a tabela e baixa do bucket com a sessão do usuário; sem URL assinada, a RLS do Storage já protege).
- [x] Cache no aparelho por hash (`modelo/cacheModelo.ts`, Cache API `modelos-v1`); `sw.js` não apaga esse cache.
- [x] `npm run publicar:modelos -- --obra <slug>` (`SUPABASE_URL` e `SUPABASE_SECRET_KEY`); upsert idempotente.
- [x] `npm run testar:modelos -- --obra <slug>`: publica no Supabase local e confere RLS (participante lê e baixa; estranho e anônimo não; ninguém do cliente grava). Exige `supabase start` e Docker.
- Não coberto: abrir o app inteiro contra o Supabase local (o login passa pela Edge Function do Telegram). O caminho do app é coberto por testes com cliente simulado e o do banco pelo script acima.
- Para a nuvem: aplicar a migration (`supabase db push`) e rodar `publicar:modelos` de uma máquina de confiança com a chave secreta. Alternativa futura: Edge Function de URL assinada, como `assinar-envio-plantas`.
