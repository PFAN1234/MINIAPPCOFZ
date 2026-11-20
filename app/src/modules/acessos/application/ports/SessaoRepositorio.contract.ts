import { describe, expect, it } from 'vitest'
import type { SessaoRepositorio } from './SessaoRepositorio.port.ts'

/** `criar(admin)`: repositório com o usuário de teste admin ou não. */
export function contratoSessaoRepositorio(nome: string, criar: (admin: boolean) => SessaoRepositorio) {
  describe(`SessaoRepositorio (${nome})`, () => {
    it('idUsuario devolve o usuário de teste', async () => {
      expect(await criar(false).idUsuario()).toBe('usuario-teste')
    })

    it('souAdmin segue a opção; criarLinkAdmin só para admin', async () => {
      expect(await criar(true).souAdmin()).toBe(true)
      expect(await criar(false).souAdmin()).toBe(false)
      expect((await criar(true).criarLinkAdmin()).url).toContain('/admin/#entrar=')
      await expect(criar(false).criarLinkAdmin()).rejects.toMatchObject({ tipo: 'permissao' })
    })
  })
}
