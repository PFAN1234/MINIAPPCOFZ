# Diário da obra (app)

Telegram Mini App em React + Vite + TypeScript. Backend: Supabase. Hospedagem: Vercel (Root Directory = `app`).

## Como rodar

```bash
cd app
npm install
cp .env.example .env.local   # preencha com os valores do projeto Supabase
npm run dev
```

Funciona em navegador comum (sem Telegram): `src/telegram.ts` devolve valores neutros quando `window.Telegram` não existe.

## Variáveis (cliente)

| Variável | Descrição |
| --- | --- |
| `VITE_SUPABASE_URL` | URL do projeto Supabase |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Chave publicável (pública; o acesso é protegido por RLS) |

Os valores reais ficam em `.env.local` (ignorado pelo Git) e nas variáveis de ambiente da Vercel. Segredos do servidor (token do bot, chave secreta do Supabase) **não** entram aqui: ver `.env.example` na raiz.

## Scripts

- `npm run dev`: servidor de desenvolvimento
- `npm run typecheck`: verificação de tipos (`tsc -b`)
- `npm run lint`: ESLint
- `npm test`: Vitest (`vitest run`)
- `npm run build`: build de produção em `dist/`

Observação: o TypeScript está fixado em 6.0.x porque o `typescript-eslint` ainda não suporta a 7.x.
