import { describe, expect, it } from 'vitest'
import { painelFixture } from '../dados/fixture.ts'
import type { PainelRelatorios } from '../dados/tipos.ts'
import { serieAcumulada, totaisPorObra } from './painel.ts'

const painel: PainelRelatorios = {
  etapa: { id: 'e', slug: 'e', nome: 'E', hoje: '2026-11-13' },
  obras: [
    { id: 'a', slug: 'a', nome: 'A' },
    { id: 'b', slug: 'b', nome: 'B' },
  ],
  dias: [
    { obra_id: 'a', dia: '2026-11-10', servicos: 2, pendencias: 1, resolvidas: 0 },
    { obra_id: 'b', dia: '2026-11-10', servicos: 1, pendencias: 2, resolvidas: 0 },
    { obra_id: 'a', dia: '2026-11-12', servicos: 1, pendencias: 0, resolvidas: 1 },
  ],
}

describe('serieAcumulada', () => {
  it('acumula, preenche dias sem movimento e vai até hoje', () => {
    expect(serieAcumulada(painel, null)).toEqual([
      { dia: '2026-11-10', servicos: 3, pendencias: 3, resolvidas: 0 },
      { dia: '2026-11-11', servicos: 3, pendencias: 3, resolvidas: 0 },
      { dia: '2026-11-12', servicos: 4, pendencias: 3, resolvidas: 1 },
      { dia: '2026-11-13', servicos: 4, pendencias: 3, resolvidas: 1 },
    ])
  })

  it('filtra por obra', () => {
    const s = serieAcumulada(painel, 'b')
    expect(s).toHaveLength(4)
    expect(s[3]).toEqual({ dia: '2026-11-13', servicos: 1, pendencias: 2, resolvidas: 0 })
  })

  it('painel vazio ou obra sem movimento → []', () => {
    expect(serieAcumulada({ ...painel, dias: [] }, null)).toEqual([])
    expect(serieAcumulada(painel, 'inexistente')).toEqual([])
  })

  it('atravessa a virada de mês', () => {
    const p = {
      ...painel,
      etapa: { ...painel.etapa, hoje: '2026-12-02' },
      dias: [{ obra_id: 'a', dia: '2026-11-29', servicos: 1, pendencias: 0, resolvidas: 0 }],
    }
    expect(serieAcumulada(p, null).map((x) => x.dia)).toEqual(['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02'])
  })
})

describe('totaisPorObra', () => {
  it('soma por obra, com abertas = pendências - resolvidas', () => {
    expect(totaisPorObra(painel)).toEqual([
      { obra: painel.obras[0], servicos: 3, abertas: 0, resolvidas: 1 },
      { obra: painel.obras[1], servicos: 1, abertas: 2, resolvidas: 0 },
    ])
  })

  it('sem obras → []', () => {
    expect(totaisPorObra({ ...painel, obras: [], dias: [] })).toEqual([])
  })
})

describe('painelFixture', () => {
  it('é determinístico, cobre ~5 semanas e não resolve mais do que abriu', () => {
    const p = painelFixture('2026-11-13')
    expect(painelFixture('2026-11-13')).toEqual(p)
    const serie = serieAcumulada(p, null)
    expect(serie.length).toBeGreaterThanOrEqual(30)
    const fim = serie.at(-1)!
    expect(fim.pendencias).toBeGreaterThanOrEqual(12)
    expect(fim.resolvidas).toBeGreaterThan(0)
    expect(fim.resolvidas).toBeLessThan(fim.pendencias)
    expect(totaisPorObra(p).every((t) => t.abertas >= 0)).toBe(true)
  })
})
