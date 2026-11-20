import { describe, expect, it } from 'vitest'
import { LADO_MAX_A4_CM, LADO_PADRAO_CM } from '../../domain/geometria.ts'
import { textoQr } from '../../domain/qr.ts'
import { gerarQr } from './gerarQr.ts'

describe('gerarQr', () => {
  const texto = textoQr('bot_teste', 'fiscalcofz', 'hto', 'terreo-administracao')
  const qr = gerarQr(texto)

  it('gera matriz quadrada de versão válida (21 + 4·(v-1) módulos)', () => {
    expect(qr.modulos).toHaveLength(qr.tamanho)
    expect(qr.modulos.every((l) => l.length === qr.tamanho)).toBe(true)
    expect((qr.tamanho - 21) % 4).toBe(0)
    expect(qr.tamanho).toBeGreaterThanOrEqual(25)
  })

  it('tem os três localizadores nos cantos e o caminho cobre só módulos escuros', () => {
    const n = qr.tamanho
    for (const [l, c] of [
      [0, 0],
      [0, n - 7],
      [n - 7, 0],
    ]) {
      expect(qr.modulos[l][c]).toBe(true)
      expect(qr.modulos[l + 3][c + 3]).toBe(true)
      expect(qr.modulos[l + 1][c + 1]).toBe(false)
    }
    const escuros = qr.modulos.flat().filter(Boolean).length
    expect(qr.caminho.match(/M/g)).toHaveLength(escuros)
    expect(qr.caminho).toMatch(/^M\d+ \d+h1v1h-1z/)
  })

  it('é determinístico e muda com o texto', () => {
    expect(gerarQr(texto).caminho).toBe(qr.caminho)
    expect(gerarQr(texto + 'x').caminho).not.toBe(qr.caminho)
  })

  it('o lado padrão e o limite A4 com margem branca de 4 módulos cabem na largura útil do A4 (194 mm)', () => {
    const curto = gerarQr(textoQr('b', 'fiscalcofz', 'hto', 'a1'))
    const longo = gerarQr(textoQr('diarioobra_cofz_bot', 'fiscalcofz', 'hto', 'terreo-administracao'))
    for (const q of [curto, longo]) {
      for (const cm of [LADO_PADRAO_CM, LADO_MAX_A4_CM]) {
        const ladoMm = cm * 10
        const totalMm = ladoMm * (1 + 8 / q.tamanho)
        expect(totalMm).toBeLessThanOrEqual(194)
      }
    }
  })
})
