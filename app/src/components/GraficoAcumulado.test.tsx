import { describe, expect, it } from 'vitest'
import { afastar, passoBonito } from './GraficoAcumulado.tsx'

describe('GraficoAcumulado: auxiliares', () => {
  it('passoBonito cobre o máximo com 3 passos inteiros', () => {
    for (const max of [0, 1, 4, 7, 23, 100, 480]) {
      const p = passoBonito(max)
      expect(Number.isInteger(p)).toBe(true)
      expect(p * 3).toBeGreaterThanOrEqual(max)
    }
    expect(passoBonito(0)).toBe(1)
    expect(passoBonito(100)).toBe(50)
  })

  it('afastar separa rótulos a menos de 12 px, sem trocar a ordem', () => {
    expect(afastar([50, 52, 100])).toEqual([50, 62, 100])
    expect(afastar([70, 30, 31])).toEqual([70, 30, 42])
  })
})
