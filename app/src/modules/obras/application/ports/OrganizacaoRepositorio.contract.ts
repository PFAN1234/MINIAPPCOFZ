import { describe, expect, it } from 'vitest'
import type { OrganizacaoRepositorio } from './OrganizacaoRepositorio.port.ts'

/** Comportamento que toda implementação de `OrganizacaoRepositorio` deve cumprir. */
export function contratoOrganizacaoRepositorio(nome: string, criar: () => OrganizacaoRepositorio) {
  describe(`OrganizacaoRepositorio (${nome})`, () => {
    it('organizacao traz nome e logo (ou null)', async () => {
      const o = await criar().organizacao()
      expect(typeof o.nome).toBe('string')
      expect(o.logo_url === null || typeof o.logo_url === 'string').toBe(true)
    })
  })
}
