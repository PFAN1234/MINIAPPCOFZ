import { describe, expect, it } from 'vitest'
import type { OrganizacaoAdminRepositorio } from './OrganizacaoAdminRepositorio.port.ts'

/** Comportamento que toda implementação de `OrganizacaoAdminRepositorio` deve cumprir (fixture). */
export function contratoOrganizacaoAdminRepositorio(nome: string, criar: () => OrganizacaoAdminRepositorio) {
  describe(`OrganizacaoAdminRepositorio (${nome})`, () => {
    it('obterOrganizacao traz nome, logo e cabeçalho', async () => {
      const o = await criar().obterOrganizacao()
      expect(o.nome).toBe('CO-FZ')
      expect(o.logo_path).toBeNull()
      expect(o.cabecalho.length).toBeGreaterThan(0)
    })

    it('salvarOrganizacao troca o nome, mantém o cabeçalho se ausente e limpa com lista vazia', async () => {
      const repo = criar()
      const antes = await repo.obterOrganizacao()
      const a = await repo.salvarOrganizacao({ nome: '  Nova OM ', logo_path: null })
      expect(a.nome).toBe('Nova OM')
      expect(a.cabecalho).toEqual(antes.cabecalho)
      expect((await repo.salvarOrganizacao({ nome: 'Nova OM', logo_path: null, cabecalho: [' Linha 1 '] })).cabecalho).toEqual(['Linha 1'])
      expect((await repo.salvarOrganizacao({ nome: 'Nova OM', logo_path: null, cabecalho: [] })).cabecalho).toEqual([])
    })

    it('recusa nome vazio e cabeçalho fora dos limites', async () => {
      const repo = criar()
      await expect(repo.salvarOrganizacao({ nome: ' ', logo_path: null })).rejects.toThrow('Informe o nome da OM')
      await expect(repo.salvarOrganizacao({ nome: 'OM', logo_path: null, cabecalho: ['1', '2', '3', '4', '5'] })).rejects.toThrow('até 4 linhas')
      await expect(repo.salvarOrganizacao({ nome: 'OM', logo_path: null, cabecalho: [''] })).rejects.toThrow('de 1 a 100')
    })

    it('enviarLogo valida o arquivo e o logo enviado pode ser usado; logo não enviado é recusado', async () => {
      const repo = criar()
      await expect(repo.enviarLogo(new Blob(['x'], { type: 'text/plain' }))).rejects.toThrow('PNG, JPEG ou WebP')
      await expect(repo.enviarLogo(new Blob([new Uint8Array(1024 * 1024 + 1)], { type: 'image/png' }))).rejects.toThrow('1 MB')
      await expect(repo.salvarOrganizacao({ nome: 'OM', logo_path: 'logo-0123456789abcdef.png' })).rejects.toThrow('Logo não encontrado')
      const caminho = await repo.enviarLogo(new Blob(['x'], { type: 'image/png' }))
      expect(caminho).toMatch(/^logo-[0-9a-f]{16}\.png$/)
      const o = await repo.salvarOrganizacao({ nome: 'OM', logo_path: caminho })
      expect(o.logo_path).toBe(caminho)
      expect(o.logo_url).not.toBeNull()
      expect((await repo.salvarOrganizacao({ nome: 'OM', logo_path: null })).logo_url).toBeNull()
    })
  })
}
