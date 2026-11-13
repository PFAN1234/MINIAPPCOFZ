/**
 * Fontes do boletim embutidas no HTML (o Chromium da Vercel não tem fontes do sistema):
 * Tinos (métrica igual à Liberation Serif / Times New Roman) e Arimo (igual à Liberation Sans /
 * Arial), dos pacotes @fontsource. Lidas uma vez por instância da função.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const exigir = createRequire(import.meta.url)

const ARQUIVOS: { familia: string; arquivo: string; peso: number; estilo: 'normal' | 'italic' }[] = [
  { familia: 'Boletim Serif', arquivo: '@fontsource/tinos/files/tinos-latin-400-normal.woff2', peso: 400, estilo: 'normal' },
  { familia: 'Boletim Serif', arquivo: '@fontsource/tinos/files/tinos-latin-700-normal.woff2', peso: 700, estilo: 'normal' },
  { familia: 'Boletim Serif', arquivo: '@fontsource/tinos/files/tinos-latin-400-italic.woff2', peso: 400, estilo: 'italic' },
  { familia: 'Boletim Sans', arquivo: '@fontsource/arimo/files/arimo-latin-400-normal.woff2', peso: 400, estilo: 'normal' },
  { familia: 'Boletim Sans', arquivo: '@fontsource/arimo/files/arimo-latin-700-normal.woff2', peso: 700, estilo: 'normal' },
]

const cache = new Map<string, string>()

function fontFace(f: (typeof ARQUIVOS)[number]): string {
  let css = cache.get(f.arquivo)
  if (css === undefined) {
    const base64 = readFileSync(exigir.resolve(f.arquivo)).toString('base64')
    css = `@font-face { font-family: "${f.familia}"; font-weight: ${f.peso}; font-style: ${f.estilo}; font-display: block; src: url(data:font/woff2;base64,${base64}) format("woff2"); }`
    cache.set(f.arquivo, css)
  }
  return css
}

/** `@font-face` com as fontes em data URL. */
export function cssFontes(): string {
  return ARQUIVOS.map(fontFace).join('\n')
}

/** Só a serifada regular, para o rodapé (o `footerTemplate` não herda as fontes da página). */
export function cssFonteRodape(): string {
  return fontFace(ARQUIVOS[0])
}
