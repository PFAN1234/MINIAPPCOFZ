// PDF de exemplo do boletim (local): `npm run boletim:exemplo -- <pasta> [--sem-rede] [--previa]`.
// Carrega app/servidor/boletim/exemplo.ts pelo módulo do Vite (TypeScript com imports `.js`).
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runnerImport } from 'vite'

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const args = process.argv.slice(2)
const saida = path.resolve(args.find((a) => !a.startsWith('--')) ?? path.join(raiz, 'boletim-exemplo'))
const { module } = await runnerImport(path.join(raiz, 'servidor/boletim/exemplo.ts'), {
  configFile: false,
  root: raiz,
  ssr: { external: true },
})
const r = await module.gerarExemplo({ saida, rede: !args.includes('--sem-rede'), previa: args.includes('--previa') })
console.log(`PDF: ${r.pdf}`)
console.log(r.clima ? `Clima: ${r.clima}` : `Clima indisponível: ${r.snapshot.clima?.motivo}`)
