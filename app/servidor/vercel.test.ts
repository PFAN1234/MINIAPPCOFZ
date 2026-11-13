// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

interface Reescrita {
  source: string
  destination: string
}
const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
  functions: Record<string, { memory?: number; maxDuration?: number; includeFiles?: string }>
  rewrites: Reescrita[]
}

/** Destino da primeira reescrita que casa (os `source` daqui são expressões regulares simples). */
function destino(caminho: string): string | null {
  const r = config.rewrites.find((x) => new RegExp(`^${x.source}$`).test(caminho))
  return r ? r.destination : null
}

describe('vercel.json', () => {
  it('as rotas /api/* não caem nas reescritas do SPA', () => {
    expect(destino('/api/gerar-boletim')).toBeNull()
    expect(destino('/api/previa-boletim')).toBeNull()
    expect(destino('/admin/etapas/2a-etapa')).toBe('/admin.html')
    expect(destino('/obras/hto')).toBe('/index.html')
    expect(destino('/')).toBe('/index.html')
  })

  it('as funções do boletim têm memória e tempo para o Chromium e levam o binário dele', () => {
    for (const nome of ['api/gerar-boletim.ts', 'api/previa-boletim.ts']) {
      const f = config.functions[nome]
      expect(f.memory).toBeGreaterThanOrEqual(2048)
      expect(f.maxDuration).toBeGreaterThanOrEqual(60)
      expect(f.includeFiles).toContain('@sparticuz/chromium/bin')
    }
    expect(config.functions['api/gerar-boletim.ts'].maxDuration).toBe(300)
  })
})

describe('lista de estações', () => {
  it('a do gerador é a mesma do site de administração', async () => {
    const { ESTACOES } = await import('./boletim/estacoes.js')
    // O site fica fora deste tsconfig: lê a lista do código-fonte.
    const fonte = readFileSync(new URL('../src/admin/dados/tipos.ts', import.meta.url), 'utf8')
    const inicio = fonte.indexOf('export const ESTACOES_OBSERVATORIO')
    const bloco = fonte.slice(inicio, fonte.indexOf('\n]', inicio))
    const doSite = [...bloco.matchAll(/codigo: '(\d+)', nome: '([^']+)'/g)].map((m) => [m[1], m[2]])
    expect(doSite).toHaveLength(11)
    expect(Object.entries(ESTACOES)).toEqual(doSite)
  })
})
