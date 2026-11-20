/**
 * pdf.js no navegador do admin: o worker, as fontes padrão e os WASM são servidos pelo
 * próprio site (arquivos do pacote `pdfjs-dist` emitidos pelo Vite), nunca de CDN. Este
 * módulo só é importado pelo editor de planta (chunk do site de administração).
 */
import * as pdfjs from 'pdfjs-dist'
import urlWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

const fontes = import.meta.glob('../../../node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>
const wasm = import.meta.glob('../../../node_modules/pdfjs-dist/wasm/{openjpeg,qcms_bg,jbig2}*.{wasm,js}', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>

function porNome(mapa: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(mapa).map(([caminho, url]) => [caminho.split('/').pop()!, url]))
}

const URLS = {
  standardFontDataUrl: porNome(fontes),
  wasmUrl: porNome(wasm),
}

/** Fornece fontes padrão e WASM ao pdf.js a partir dos arquivos locais. */
class DadosLocais {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const url = (URLS as Record<string, Map<string, string> | undefined>)[kind]?.get(filename)
    if (!url) throw new Error(`Arquivo do pdf.js indisponível: ${kind}/${filename}`)
    const r = await fetch(url)
    if (!r.ok) throw new Error(`Falha ao carregar ${url}`)
    return new Uint8Array(await r.arrayBuffer())
  }
}

pdfjs.GlobalWorkerOptions.workerSrc = urlWorker

export const OPCOES_PDFJS = {
  BinaryDataFactory: DadosLocais,
  useWorkerFetch: false,
  // Os valores só precisam existir: quem busca os arquivos é a `DadosLocais`.
  standardFontDataUrl: '/pdfjs/standard_fonts/',
  wasmUrl: '/pdfjs/wasm/',
}

export { pdfjs }
