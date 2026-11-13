import { describe, expect, it } from 'vitest'
import type { GeometriaAmbiente } from './geometria.ts'
import { gradeDeProcura, malhaDoAmbiente } from './malha.ts'

const base = {
  yPiso: 1,
  yTeto: 3.8,
  qr: null,
  referencial: null,
  matrizes: {},
}
const retangulo: GeometriaAmbiente = {
  ...base,
  contorno: [
    [0, 0],
    [4, 0],
    [4, 3],
    [0, 3],
  ],
}
const emL: GeometriaAmbiente = {
  ...base,
  contorno: [
    [0, 0],
    [4, 0],
    [4, 1.5],
    [1.5, 1.5],
    [1.5, 4],
    [0, 4],
  ],
}

type Seg = [number, number, number, number, number, number]
function segmentos(v: number[]): Seg[] {
  const r: Seg[] = []
  for (let i = 0; i < v.length; i += 6) r.push(v.slice(i, i + 6) as Seg)
  return r
}

function dentroOuBorda(poli: [number, number][], x: number, z: number): boolean {
  let dentro = false
  for (let i = 0; i < poli.length; i++) {
    const [x0, z0] = poli[i]
    const [x1, z1] = poli[(i + 1) % poli.length]
    const cruz = (x1 - x0) * (z - z0) - (z1 - z0) * (x - x0)
    const sobre =
      Math.abs(cruz) / Math.hypot(x1 - x0, z1 - z0) < 1e-6 &&
      x >= Math.min(x0, x1) - 1e-6 &&
      x <= Math.max(x0, x1) + 1e-6 &&
      z >= Math.min(z0, z1) - 1e-6 &&
      z <= Math.max(z0, z1) + 1e-6
    if (sobre) return true
    if (z0 > z !== z1 > z && x < ((x1 - x0) * (z - z0)) / (z1 - z0) + x0) dentro = !dentro
  }
  return dentro
}

function semRepetidos(v: number[]): boolean {
  const k = (a: number[]) => a.map((n) => Math.round(n * 1e4)).join(',')
  const vistos = new Set<string>()
  for (const s of segmentos(v)) {
    const a = k(s.slice(0, 3))
    const b = k(s.slice(3))
    const chave = a < b ? `${a}|${b}` : `${b}|${a}`
    if (vistos.has(chave)) return false
    vistos.add(chave)
  }
  return true
}

describe.each([
  ['retangular 4 x 3', retangulo],
  ['em L', emL],
])('malha do ambiente %s', (_nome, g) => {
  for (const passo of [0.5, 1]) {
    it(`respeita o passo ${passo} e não repete segmentos`, () => {
      const m = malhaDoAmbiente(g, passo)
      for (const v of [m.piso, m.paredes, m.teto]) {
        expect(v.length).toBeGreaterThan(0)
        expect(v.length % 6).toBe(0)
        expect(semRepetidos(v)).toBe(true)
        for (const s of segmentos(v)) {
          expect(Math.hypot(s[0] - s[3], s[1] - s[4], s[2] - s[5])).toBeLessThanOrEqual(passo + 1e-6)
        }
      }
    })
  }

  it('piso e teto ficam dentro do polígono, na altura certa', () => {
    const m = malhaDoAmbiente(g)
    for (const s of segmentos(m.piso)) {
      expect(s[1]).toBe(g.yPiso)
      expect(s[4]).toBe(g.yPiso)
      expect(dentroOuBorda(g.contorno, s[0], s[2])).toBe(true)
      expect(dentroOuBorda(g.contorno, s[3], s[5])).toBe(true)
    }
    for (const s of segmentos(m.teto)) {
      expect(s[1]).toBe(g.yTeto)
      expect(s[4]).toBe(g.yTeto)
    }
  })

  it('paredes ficam entre o piso e o teto, sobre o contorno', () => {
    for (const s of segmentos(malhaDoAmbiente(g).paredes)) {
      for (const y of [s[1], s[4]]) {
        expect(y).toBeGreaterThanOrEqual(g.yPiso - 1e-9)
        expect(y).toBeLessThanOrEqual(g.yTeto + 1e-9)
      }
      expect(dentroOuBorda(g.contorno, s[0], s[2])).toBe(true)
      expect(dentroOuBorda(g.contorno, s[3], s[5])).toBe(true)
    }
  })
})

describe('grade de procura', () => {
  it('fica dentro do raio, no plano y = 0, sem repetir segmentos', () => {
    const v = gradeDeProcura(3, 0.5)
    expect(v.length).toBeGreaterThan(0)
    expect(semRepetidos(v)).toBe(true)
    for (const s of segmentos(v)) {
      expect(s[1]).toBe(0)
      expect(s[4]).toBe(0)
      expect(Math.hypot(s[0], s[2])).toBeLessThanOrEqual(3 + 1e-6)
      expect(Math.hypot(s[3], s[5])).toBeLessThanOrEqual(3 + 1e-6)
      expect(Math.hypot(s[0] - s[3], s[2] - s[5])).toBeCloseTo(0.5, 6)
    }
  })
})
