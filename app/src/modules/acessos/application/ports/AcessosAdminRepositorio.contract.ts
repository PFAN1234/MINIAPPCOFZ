import { describe, expect, it } from 'vitest'
import type { AcessosAdminRepositorio } from './AcessosAdminRepositorio.port.ts'

/** Comportamento que toda implementação de `AcessosAdminRepositorio` deve cumprir (fixture). */
export function contratoAcessosAdminRepositorio(nome: string, criar: () => AcessosAdminRepositorio) {
  describe(`AcessosAdminRepositorio (${nome})`, () => {
    it('incluirAdmin e removerAdmin alteram listarAdmins', async () => {
      const repo = criar()
      await repo.incluirAdmin('usuario-maria')
      expect((await repo.listarAdmins()).map((a) => a.usuario_id)).toContain('usuario-maria')
      await repo.removerAdmin('usuario-maria')
      expect((await repo.listarAdmins()).map((a) => a.usuario_id)).not.toContain('usuario-maria')
    })

    it('incluirAdmin de usuário inexistente falha', async () => {
      await expect(criar().incluirAdmin('ninguem')).rejects.toThrow('Usuário não encontrado')
    })

    it('não remove o último admin', async () => {
      const repo = criar()
      const [a, b] = await repo.listarAdmins()
      await repo.removerAdmin(a.usuario_id)
      await expect(repo.removerAdmin(b.usuario_id)).rejects.toThrow('último admin')
    })

    it('definirNomeExibicao normaliza em maiúsculas e limpa com vazio', async () => {
      const repo = criar()
      expect((await repo.definirNomeExibicao('usuario-maria', '  cp   maria ')).nome_exibicao).toBe('CP MARIA')
      expect((await repo.definirNomeExibicao('usuario-maria', ' ')).nome_exibicao).toBeNull()
      await expect(repo.definirNomeExibicao('usuario-maria', 'x'.repeat(61))).rejects.toThrow('60')
    })

    it('listarPessoas traz participações e matrizAcessos põe pedidos primeiro', async () => {
      const repo = criar()
      const pessoas = await repo.listarPessoas()
      expect(pessoas.find((p) => p.id === 'usuario-patricio')!.participacoes.length).toBeGreaterThan(0)
      expect((await repo.matrizAcessos()).pessoas[0].pedidos.length).toBeGreaterThan(0)
      expect((await repo.listarUsuarios()).length).toBe(pessoas.length)
    })
  })
}
