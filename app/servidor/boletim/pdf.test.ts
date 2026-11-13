// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { chromiumDisponivel } from './__fixtures__/navegador.js'
import { gerarExemplo } from './exemplo.js'
import { ehServerless } from './pdf.js'

describe('Chromium', () => {
  it('usa o @sparticuz/chromium só em ambiente serverless', () => {
    expect(ehServerless({ VERCEL: '1' })).toBe(true)
    expect(ehServerless({ AWS_LAMBDA_FUNCTION_NAME: 'f' })).toBe(true)
    expect(ehServerless({})).toBe(false)
  })
})

describe.skipIf(!chromiumDisponivel())('PDF de exemplo (snapshot de teste e cópia gravada da página)', () => {
  it('gera um A4 de várias páginas com as fontes embutidas e a imagem do clima', { timeout: 60_000 }, async () => {
    const pasta = await mkdtemp(path.join(tmpdir(), 'boletim-'))
    try {
      const r = await gerarExemplo({ saida: pasta, rede: false })
      const pdf = await readFile(r.pdf)
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
      const texto = pdf.toString('latin1')
      const paginas = texto.match(/\/Type\s*\/Page\b/g) ?? []
      expect(paginas.length).toBeGreaterThanOrEqual(3)
      // A4: 595 × 842 pt (o Chromium grava 594,96 × 841,92)
      const caixa = /\/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]/.exec(texto)
      expect(Math.round(Number(caixa?.[1]))).toBe(595)
      expect(Math.round(Number(caixa?.[2]))).toBe(842)
      expect(texto.includes('Tinos')).toBe(true)
      expect(r.clima).not.toBeNull()
      expect(r.snapshot.clima).toMatchObject({ estacao: { codigo: '8836', nome: 'Montese' } })
    } finally {
      await rm(pasta, { recursive: true, force: true })
    }
  })
})
