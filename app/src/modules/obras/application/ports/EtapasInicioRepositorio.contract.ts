import { describe, expect, it } from 'vitest'
import type { EtapasInicioRepositorio } from './EtapasInicioRepositorio.port.ts'

/** Comportamento que toda implementação de `EtapasInicioRepositorio` deve cumprir. */
export function contratoEtapasInicioRepositorio(nome: string, criar: () => EtapasInicioRepositorio) {
  describe(`EtapasInicioRepositorio (${nome})`, () => {
    it('etapasInicio traz as etapas com a participação do usuário', async () => {
      const etapas = await criar().etapasInicio()
      expect(etapas.length).toBeGreaterThan(0)
      for (const e of etapas) {
        expect(e.id).toBeTruthy()
        expect(typeof e.participa).toBe('boolean')
      }
    })
  })
}
