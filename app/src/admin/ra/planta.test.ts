import { describe, expect, it } from 'vitest'
import type { Ponto } from './geometria'
import { enquadrarPlanta, marcaNaPlanta, type PlantaAdmin } from './planta'

const planta: PlantaAdmin = {
  url: 'x',
  pagina_pt: [1000, 500],
  recorte_pt: [100, 50, 900, 450],
  largura: 800,
  altura: 400,
}
const quadrado: Ponto[] = [[0, 0], [4, 0], [4, 4], [0, 4]]
const pix: Ponto[] = [[0, 0], [400, 0], [400, 400], [0, 400]]

describe('enquadrarPlanta', () => {
  it('converte cantos da página em pixels do recorte', () => {
    const r = enquadrarPlanta(quadrado.slice(0, 2), [[0.1, 0.1], [0.9, 0.9]], planta)
    expect(r?.pontos[0][0]).toBeCloseTo(0)
    expect(r?.pontos[0][1]).toBeCloseTo(0)
    expect(r?.pontos[1][0]).toBeCloseTo(800)
    expect(r?.pontos[1][1]).toBeCloseTo(400)
  })
  it('devolve null com dado faltando ou tamanhos diferentes', () => {
    expect(enquadrarPlanta(quadrado, null, planta)).toBeNull()
    expect(enquadrarPlanta(quadrado, [[0.1, 0.1]], null)).toBeNull()
    expect(enquadrarPlanta(quadrado, [[0.1, 0.1]], planta)).toBeNull()
  })
})

describe('marcaNaPlanta', () => {
  it('posiciona centro e extremos ao longo da parede', () => {
    const m = marcaNaPlanta(quadrado, pix, { parede: 0, distancia_m: 1, lado_m: 0.5 })
    expect(m.centro).toEqual([100, 0])
    expect(m.a).toEqual([75, 0])
    expect(m.b).toEqual([125, 0])
  })
  it('parede de comprimento 0 não gera NaN', () => {
    const c: Ponto[] = [[0, 0], [0, 0], [4, 4]]
    const m = marcaNaPlanta(c, [[10, 20], [10, 20], [50, 50]], { parede: 0, distancia_m: 1, lado_m: 0.5 })
    expect(m.centro).toEqual([10, 20])
    expect([...m.a, ...m.b].some(Number.isNaN)).toBe(false)
  })
})
