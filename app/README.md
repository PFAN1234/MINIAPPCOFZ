# Diário da obra (app)

Telegram Mini App em React + Vite + TypeScript. Backend: Supabase. Hospedagem: Vercel (Root Directory = `app`).

## Como rodar

```bash
cd app
npm install
cp .env.example .env.local   # preencha com os valores do projeto Supabase
npm run dev
```

Para navegar sem Supabase, com os dados de teste da HTO (`data/hto/*.json`) e as plantas servidas de `data/hto/plantas/`:

```bash
VITE_DADOS=fixture npm run dev     # ou: VITE_DADOS=fixture npm run build && npm run preview
```

O modo fixture inclui a HTO, uma segunda obra vazia e alguns registros de exemplo. As imagens saem de `/__plantas/<revisao>/<pavimento>/...`, servidas por um plugin do Vite (`vite.config.ts`) em dev e preview. Sem `VITE_DADOS=fixture` o build de produção **não** contém a fixture nem os JSON de teste.

Funciona em navegador comum (sem Telegram): `src/telegram.ts` devolve valores neutros quando `window.Telegram` não existe.

## Variáveis (cliente)

| Variável | Descrição |
| --- | --- |
| `VITE_SUPABASE_URL` | URL do projeto Supabase |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Chave publicável (pública; o acesso é protegido por RLS) |
| `VITE_DADOS` | Opcional. `fixture` usa dados de teste em vez do Supabase |

Em modo Supabase, sem sessão (o login pelo Telegram chega na fase 6), o app mostra "Abra o Diário da obra pelo Telegram".

## Estrutura

- `src/dados/`: tipos, interface `Repositorio`, implementações `supabase.ts` e `fixture.ts`, contexto e hooks (react-query).
- `src/telas/`: telas das rotas; `src/components/`: layout, barra inferior, estados de carregamento/erro/vazio.
- `src/util/`: ordenação natural, busca sem acento e conversão de coordenadas dos marcadores.
- `src/recursos.ts`: feature flags (`modeloFederado`, `novoRegistro`), desligadas até as fases 9 e 4.
- Telas que precisam esconder a barra inferior (planta em tela cheia) chamam `useTelaCheia(true)` de `components/telaCheia.ts`.

Os valores reais ficam em `.env.local` (ignorado pelo Git) e nas variáveis de ambiente da Vercel. Segredos do servidor (token do bot, chave secreta do Supabase) **não** entram aqui: ver `.env.example` na raiz.

## Scripts

- `npm run dev`: servidor de desenvolvimento
- `npm run typecheck`: verificação de tipos (`tsc -b`)
- `npm run lint`: ESLint
- `npm test`: Vitest (`vitest run`)
- `npm run build`: build de produção em `dist/`
- `npm run test:e2e`: testes ponta a ponta (Playwright)

## Testes de ponta a ponta

Os testes ficam em `e2e/` e rodam num viewport móvel (390×844) com a fixture HTO. O Playwright sobe sozinho o servidor: `npm run build:fixture` gera `dist-fixture/` e o `vite preview` serve na porta 4174.

```bash
cd app
npx playwright install chromium   # uma vez; no CI o job `e2e` faz isso
npx playwright test               # ou: npm run test:e2e
```

Se o Chromium já estiver instalado em outro caminho, aponte `PW_CHROMIUM` para o executável (ex.: `PW_CHROMIUM=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome npx playwright test`).

O Telegram é simulado com `window.Telegram.WebApp` falso (`addInitScript`), e o `telegram-web-app.js` da internet é interceptado, para o teste não depender de rede.

Observação: o TypeScript está fixado em 6.0.x porque o `typescript-eslint` ainda não suporta a 7.x.
