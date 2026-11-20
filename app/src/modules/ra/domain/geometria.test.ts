import { describe, expect, it } from 'vitest'
import { areaComSinal, comprimentoParede, lerNumero, normalExterna, validarQr, type Ponto } from './geometria.ts'

const RETANGULO: Ponto[] = [
  [0, 0],
  [6.03, 0],
  [6.03, 3.96],
  [0, 3.96],
]

const campos = { parede: 0, distancia: '2,5', altura: '1,50', ladoCm: '18' }

describe('geometria', () => {
  it('comprimento das paredes, inclusive a que fecha o contorno', () => {
    expect(comprimentoParede(RETANGULO, 0)).toBeCloseTo(6.03)
    expect(comprimentoParede(RETANGULO, 3)).toBeCloseTo(3.96)
  })

  it('normal externa aponta para fora, qualquer que seja o sentido', () => {
    expect(areaComSinal(RETANGULO)).toBeGreaterThan(0)
    expect(normalExterna(RETANGULO, 0)).toEqual([0, -1])
    const inverso = [...RETANGULO].reverse()
    const i = inverso.findIndex((p, k) => p[1] === 0 && inverso[(k + 1) % 4][1] === 0)
    expect(normalExterna(inverso, i)[1]).toBe(-1)
  })

  it('lê números com vírgula ou ponto e recusa o resto', () => {
    expect(lerNumero('1,50')).toBe(1.5)
    expect(lerNumero(' 2.25 ')).toBe(2.25)
    expect(lerNumero('')).toBeNull()
    expect(lerNumero('abc')).toBeNull()
    expect(lerNumero('1,2,3')).toBeNull()
  })
})

describe('validarQr', () => {
  it('converte para metros', () => {
    const r = validarQr(RETANGULO, campos)
    expect(r.erros).toEqual({})
    expect(r.qr).toEqual({ parede: 0, distancia_m: 2.5, altura_m: 1.5, lado_m: 0.18 })
  })

  it('distância entre 0 e o comprimento da parede (inclusive nos extremos)', () => {
    expect(validarQr(RETANGULO, { ...campos, distancia: '0' }).qr).not.toBeNull()
    expect(validarQr(RETANGULO, { ...campos, distancia: '6,03' }).qr).not.toBeNull()
    expect(validarQr(RETANGULO, { ...campos, distancia: '6,04' }).erros.distancia).toMatch(/entre 0 e 6,03 m/)
    expect(validarQr(RETANGULO, { ...campos, distancia: '-1' }).qr).toBeNull()
    // Na parede 2 (3,96 m) o mesmo valor deixa de caber.
    expect(validarQr(RETANGULO, { ...campos, parede: 1, distancia: '5' }).erros.distancia).toBeDefined()
  })

  it('altura entre 0 e 5 m e lado entre 5 e 100 cm', () => {
    expect(validarQr(RETANGULO, { ...campos, altura: '5' }).qr).not.toBeNull()
    expect(validarQr(RETANGULO, { ...campos, altura: '5,1' }).erros.altura).toBeDefined()
    expect(validarQr(RETANGULO, { ...campos, ladoCm: '4,9' }).erros.lado).toBeDefined()
    expect(validarQr(RETANGULO, { ...campos, ladoCm: '5' }).qr?.lado_m).toBe(0.05)
    expect(validarQr(RETANGULO, { ...campos, ladoCm: '100' }).qr?.lado_m).toBe(1)
    expect(validarQr(RETANGULO, { ...campos, ladoCm: '101' }).erros.lado).toBeDefined()
    expect(validarQr(RETANGULO, { ...campos, ladoCm: 'x' }).qr).toBeNull()
  })
})
