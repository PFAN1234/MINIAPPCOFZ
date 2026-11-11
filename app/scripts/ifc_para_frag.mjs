// Converte IFC em .frag (That Open Fragments) e atualiza o manifesto da obra.
// Uso: npm run modelos -- --obra hto [--ifc ../public/ifc/CE01-14PE01-ARQ-R06.ifc]
// Sem --ifc, converte todos os .ifc de ../public/ifc/. Sigla = 3º trecho do nome (CE01-14PE01-ARQ-R06 -> ARQ).
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { createHash as hash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { IfcImporter } from '@thatopen/fragments'

const raiz = fileURLToPath(new URL('../..', import.meta.url))
const wasmDir = fileURLToPath(new URL('../node_modules/web-ifc/', import.meta.url))

function argumento(nome) {
  const i = process.argv.indexOf(`--${nome}`)
  return i > 0 ? process.argv[i + 1] : undefined
}

const obra = argumento('obra')
if (!obra || !/^[a-z0-9-]+$/.test(obra)) {
  console.error('Uso: npm run modelos -- --obra <slug> [--ifc <arquivo.ifc>]')
  process.exit(1)
}
const arquivoIfc = argumento('ifc')
const pastaIfc = path.join(raiz, 'public', 'ifc')
const entradas = arquivoIfc
  ? [path.resolve(arquivoIfc)]
  : existsSync(pastaIfc)
    ? readdirSync(pastaIfc).filter((n) => n.toLowerCase().endsWith('.ifc')).sort().map((n) => path.join(pastaIfc, n))
    : []
if (!entradas.length) {
  console.error(`Nenhum .ifc encontrado em ${pastaIfc}`)
  process.exit(1)
}

const saida = path.join(raiz, 'app', 'public', 'modelos', obra)
mkdirSync(saida, { recursive: true })
const arqManifesto = path.join(saida, 'manifesto.json')
const manifesto = existsSync(arqManifesto) ? JSON.parse(readFileSync(arqManifesto, 'utf8')) : { modelos: [] }

for (const ifc of entradas) {
  const base = path.basename(ifc, path.extname(ifc))
  const partes = base.split('-')
  const sigla = partes[2]?.toUpperCase()
  const revisao = partes[3]?.toUpperCase() ?? null
  if (!sigla || !/^[A-Z]{2,4}$/.test(sigla)) {
    console.error(`Nome fora do padrão <obra>-<projeto>-<SIGLA>-<REV>.ifc: ${base}`)
    process.exit(1)
  }
  console.log(`\n${base}: ${(statSync(ifc).size / 1e6).toFixed(1)} MB -> ${sigla}.frag`)
  const inicio = Date.now()

  const fd = openSync(ifc, 'r')
  const bloco = new Uint8Array(1024 * 1024)
  const importer = new IfcImporter()
  importer.wasm = { path: wasmDir, absolute: true }
  let frag
  try {
    frag = await importer.process({
      readFromCallback: true,
      readCallback: (offset) => bloco.slice(0, readSync(fd, bloco, 0, bloco.length, offset)),
      progressCallback: (p, d) => {
        if (d.state !== 'inProgress') console.log(`  ${d.process}: ${d.state}`)
      },
    })
  } finally {
    closeSync(fd)
  }

  const arquivo = `${sigla}.frag`
  writeFileSync(path.join(saida, arquivo), frag)
  const registro = {
    sigla,
    revisao,
    arquivo,
    bytes: frag.byteLength,
    hash: hash('sha256').update(frag).digest('hex').slice(0, 16),
  }
  manifesto.modelos = [...manifesto.modelos.filter((m) => m.sigla !== sigla), registro].sort((a, b) => a.sigla.localeCompare(b.sigla))
  writeFileSync(arqManifesto, JSON.stringify(manifesto, null, 2) + '\n')
  console.log(`  ok em ${((Date.now() - inicio) / 1000).toFixed(0)} s: ${(frag.byteLength / 1e6).toFixed(1)} MB`)
}
