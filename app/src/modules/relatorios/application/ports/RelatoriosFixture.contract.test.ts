import { describe, expect, it } from 'vitest'
import { serieAcumulada, totaisPorObra } from '@modules/relatorios/domain/painel.ts'
import { painelFixture } from '@modules/relatorios/infra/RelatoriosFixtureAdapter.ts'
import { criarRepositorioFixture, ETAPA_2 } from '../../../../dados/fixture.ts'
import { contratoObservacoes } from './ObservacoesRepositorio.contract.ts'
import { contratoRelatorios } from './RelatoriosRepositorio.contract.ts'

const ID_HTO = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4e01'

contratoRelatorios('fixture', () => ({
  repo: criarRepositorioFixture({ admin: true }),
  etapaId: ETAPA_2.id,
  etapaSlug: ETAPA_2.slug,
}))

contratoObservacoes('fixture', () => ({
  repo: criarRepositorioFixture(),
  obraId: ID_HTO,
}))

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
