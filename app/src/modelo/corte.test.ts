import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { caixaBox3, planosDeCorte, posicaoInterna } from './corte.ts'

const caixa = [0, 0, 0, 4, 3, 5]

describe('corte', () => {
  it('ponto dentro tem distância >= 0 nos 6 planos', () => {
    const p = planosDeCorte(caixa)
    expect(p).toHaveLength(6)
    for (const pl of p) expect(pl.distanceToPoint(new THREE.Vector3(2, 1, 2))).toBeGreaterThanOrEqual(0)
  })
  it('ponto fora tem distância negativa em algum plano', () => {
    const d = planosDeCorte(caixa).map((pl) => pl.distanceToPoint(new THREE.Vector3(5, 1, 2)))
    expect(d.some((v) => v < 0)).toBe(true)
  })
  it('caixaBox3 reflete min e max', () => {
    const b = caixaBox3(caixa)
    expect(b.min.toArray()).toEqual([0, 0, 0])
    expect(b.max.toArray()).toEqual([4, 3, 5])
  })
  it('posicaoInterna fica no centroide a 1,5 m do piso', () => {
    const p = posicaoInterna({ contorno: [[0, 0], [4, 0], [4, 2], [0, 2]], yPiso: 10, yTeto: 13 })
    expect(p.toArray()).toEqual([2, 11.5, 1])
  })
  it('posicaoInterna não passa do teto baixo', () => {
    const p = posicaoInterna({ contorno: [[0, 0], [2, 0], [2, 2]], yPiso: 0, yTeto: 1.4 })
    expect(p.y).toBeCloseTo(1.2)
  })
})
