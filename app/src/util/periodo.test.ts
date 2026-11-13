import { describe, expect, it } from 'vitest'
import { dentroDoPeriodo, diaSeguinte, limitesPeriodo } from './periodo.ts'

describe('periodo', () => {
  it('dia seguinte vira mês e ano', () => {
    expect(diaSeguinte('2026-11-30')).toBe('2026-12-01')
    expect(diaSeguinte('2026-12-31')).toBe('2027-01-01')
    expect(diaSeguinte('2028-02-28')).toBe('2028-02-29')
  })
  it('limites com -03:00 e só um lado', () => {
    expect(limitesPeriodo('2026-11-05', '2026-11-30')).toEqual({
      desde: '2026-11-05T00:00:00-03:00',
      antes: '2026-12-01T00:00:00-03:00',
    })
    expect(limitesPeriodo(undefined, 'lixo')).toEqual({ desde: undefined, antes: undefined })
  })
  it('compara no fuso de Fortaleza', () => {
    expect(dentroDoPeriodo('2026-11-06T02:59:00Z', '2026-11-05', '2026-11-05')).toBe(true)
    expect(dentroDoPeriodo('2026-11-06T03:00:00Z', '2026-11-05', '2026-11-05')).toBe(false)
    expect(dentroDoPeriodo('2026-11-05T02:59:00Z', '2026-11-05')).toBe(false)
  })
})
