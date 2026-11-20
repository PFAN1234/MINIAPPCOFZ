import { describe, expect, it } from 'vitest'
import type { ObrasRepositorio } from './ObrasRepositorio.port.ts'

export interface CenarioObras {
  repo: ObrasRepositorio
  /** Obra com pavimentos e ambientes. */
  slug: string
  obraId: string
  /** Ambiente dessa obra (código) e o pavimento a que pertence. */
  ambiente: string
  pavimento: string
}

/** Comportamento que toda implementação de `ObrasRepositorio` deve cumprir. */
export function contratoObrasRepositorio(nome: string, criar: () => CenarioObras) {
  describe(`ObrasRepositorio (${nome})`, () => {
    it('listarObras traz a etapa de cada obra', async () => {
      const c = criar()
      const obra = (await c.repo.listarObras()).find((o) => o.slug === c.slug)!
      expect(obra.id).toBe(c.obraId)
      expect(obra.etapa.id).toBeTruthy()
    })

    it('obterObra traz pavimentos e ambientes, com a contagem de pendências abertas', async () => {
      const c = criar()
      const d = await c.repo.obterObra(c.slug)
      expect(d.obra.id).toBe(c.obraId)
      expect(d.pavimentos.map((p) => p.codigo)).toContain(c.pavimento)
      const amb = d.ambientes.find((a) => a.codigo === c.ambiente)!
      expect(amb.pavimento_codigo).toBe(c.pavimento)
      expect(amb.pendencias_abertas).toBeGreaterThanOrEqual(0)
    })

    it('obterObra de slug inexistente falha', async () => {
      await expect(criar().repo.obterObra('nao-existe')).rejects.toThrow('Obra não encontrada')
    })

    it('obterAmbiente traz o pavimento do ambiente', async () => {
      const c = criar()
      const d = await c.repo.obterAmbiente(c.slug, c.ambiente)
      expect(d.obra.slug).toBe(c.slug)
      expect(d.ambiente.codigo).toBe(c.ambiente)
      expect(d.pavimento.codigo).toBe(c.pavimento)
    })

    it('obterAmbiente de código inexistente falha', async () => {
      const c = criar()
      await expect(c.repo.obterAmbiente(c.slug, 'nao-existe')).rejects.toThrow('Ambiente não encontrado')
    })

    it('resumoObras traz totais não negativos por obra', async () => {
      const c = criar()
      const resumo = (await c.repo.resumoObras()).find((r) => r.obra_id === c.obraId)!
      expect(resumo.servicos).toBeGreaterThanOrEqual(0)
      expect(resumo.abertas).toBeGreaterThanOrEqual(0)
      expect(resumo.resolvidas).toBeGreaterThanOrEqual(0)
    })
  })
}
