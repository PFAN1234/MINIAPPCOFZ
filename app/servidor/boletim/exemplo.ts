/**
 * PDF de exemplo, local: o snapshot de `__fixtures__/snapshot-exemplo.json`, fotos de teste
 * geradas na hora (sem Storage), o logo da prévia v2 e o clima copiado da página real do
 * Observatório (ou da cópia reduzida gravada, com `rede: false`). Grava o PDF e a imagem do clima
 * em `saida`. Uso: `npm run boletim:exemplo -- <pasta> [--sem-rede] [--previa]`.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { capturarClima } from './clima.js'
import { DEPENDENCIAS_PADRAO, montarBoletim, type Dependencias } from './gerador.js'
import { URL_OBSERVATORIO } from './estacoes.js'
import type { Snapshot } from './tipos.js'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
export const FIXTURES = path.join(AQUI, '__fixtures__')
const LOGO_PREVIA = path.join(AQUI, '../../../docs/mockups/reproduce/boletim/logo.png')

const TONS = [
  ['#b9b1a4', '#8f8577'],
  ['#a9b3b8', '#7b878e'],
  ['#c2b39a', '#97856b'],
  ['#b5b5ad', '#86867c'],
]

/** Foto de teste (JPEG 1600×1200) com um degradê e o nome do arquivo. */
export async function fotoDeTeste(caminho: string, indice: number): Promise<Uint8Array> {
  const [a, b] = TONS[indice % TONS.length]
  const nome = path.basename(caminho)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
<rect width="1600" height="1200" fill="url(#g)"/>
<rect x="420" y="380" width="760" height="440" rx="28" fill="none" stroke="rgba(255,255,255,.75)" stroke-width="10"/>
<text x="800" y="640" font-family="sans-serif" font-size="96" text-anchor="middle" fill="rgba(255,255,255,.9)">FOTO DE TESTE</text>
<text x="800" y="760" font-family="sans-serif" font-size="56" text-anchor="middle" fill="rgba(255,255,255,.85)">${nome}</text>
</svg>`
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer()
}

export async function lerSnapshotExemplo(): Promise<Snapshot> {
  return JSON.parse(await readFile(path.join(FIXTURES, 'snapshot-exemplo.json'), 'utf8')) as Snapshot
}

export interface OpcoesExemplo {
  saida: string
  /** false: clima da cópia reduzida da página (sem rede). */
  rede?: boolean
  previa?: boolean
  numero?: string
}

export async function gerarExemplo(o: OpcoesExemplo) {
  const snapshot = await lerSnapshotExemplo()
  const paths = new Map<string, number>()
  const fonte = {
    async baixar(bucket: string, caminho: string): Promise<Uint8Array> {
      if (bucket === 'organizacao') return readFile(LOGO_PREVIA)
      if (!paths.has(caminho)) paths.set(caminho, paths.size)
      return fotoDeTeste(caminho, paths.get(caminho)!)
    },
  }
  const copia = o.rede === false ? await readFile(path.join(FIXTURES, 'observatorio-reduzida.html'), 'utf8') : null
  let imagemClima: Buffer | null = null
  const deps: Dependencias = {
    ...DEPENDENCIAS_PADRAO,
    // O exemplo é do dia de hoje: a cópia da página vale para ele.
    agora: () => new Date(),
    async capturarClima(navegador, opcoes) {
      const r = await capturarClima(navegador, {
        ...opcoes,
        ...(copia
          ? {
              preparar: (ctx) =>
                ctx.route(URL_OBSERVATORIO, (rota) => rota.fulfill({ contentType: 'text/html; charset=utf-8', body: copia })),
            }
          : {}),
      })
      imagemClima = r.imagem
      return r
    },
  }
  // A data do exemplo vira a de hoje, para a regra "clima só do dia" valer.
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: snapshot.fuso }).format(new Date())
  const numero = o.previa ? null : (o.numero ?? `BA2/${hoje.slice(2, 4)}${hoje.slice(5, 7)}${hoje.slice(8, 10)}/COFZ`)
  const navegador = await deps.abrirNavegador()
  try {
    const m = await montarBoletim(fonte, navegador, { ...snapshot, data: hoje }, { numero, revisao: 0, deps })
    await mkdir(o.saida, { recursive: true })
    const nome = numero ? numero.replace(/\//g, '') : 'previa'
    const pdf = path.join(o.saida, `${nome}.pdf`)
    await writeFile(pdf, m.pdf)
    let clima: string | null = null
    if (imagemClima) {
      clima = path.join(o.saida, `${nome}-clima.png`)
      await writeFile(clima, imagemClima)
    }
    return { pdf, clima, snapshot: m.snapshot }
  } finally {
    await navegador.close()
  }
}
