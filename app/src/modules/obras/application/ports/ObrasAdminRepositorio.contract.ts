import { describe, expect, it } from 'vitest'
import type { ObrasAdminRepositorio } from './ObrasAdminRepositorio.port.ts'

/**
 * Comportamento que toda implementação de `ObrasAdminRepositorio` deve cumprir (fixture).
 * Semente esperada: obra `hto` (nome `HTO`, id `obra-hto`) na etapa `etapa-2a`, com o pavimento `terreo`
 * (com ambientes) e sem configuração; existe também a etapa `etapa-3a`.
 */
export function contratoObrasAdminRepositorio(nome: string, criar: () => ObrasAdminRepositorio) {
  describe(`ObrasAdminRepositorio (${nome})`, () => {
    it('cria obra (exige etapa e slug livre), edita pelo id e não deixa trocar o slug', async () => {
      const repo = criar()
      const n = await repo.salvarObra({ slug: 'nova', nome: ' Obra Nova ', ordem: 5, etapa_id: 'etapa-2a' })
      expect(n).toMatchObject({ slug: 'nova', nome: 'Obra Nova' })
      expect((await repo.listarObras()).map((o) => o.slug)).toContain('nova')
      await expect(repo.salvarObra({ slug: 'nova', nome: 'X', ordem: 1, etapa_id: 'etapa-2a' })).rejects.toThrow('Já existe uma obra com o slug nova')
      await expect(repo.salvarObra({ slug: 'sem-etapa', nome: 'X', ordem: 1 })).rejects.toThrow('Escolha a etapa')
      await expect(repo.salvarObra({ id: n.id, slug: 'outro', nome: 'X', ordem: 1 })).rejects.toThrow('slug não pode ser alterado')
      const e = await repo.salvarObra({ id: n.id, nome: 'Renomeada', ordem: 6, etapa_id: 'etapa-3a' })
      expect(e.nome).toBe('Renomeada')
      expect((await repo.obterObra('nova')).obra.etapa?.id).toBe('etapa-3a')
      await expect(repo.obterObra('nao-existe')).rejects.toThrow('Obra não encontrada')
    })

    it('salvarPavimentos inclui e edita, mas não apaga pavimento com ambientes', async () => {
      const repo = criar()
      const lista = await repo.salvarPavimentos('hto', [
        { codigo: 'terreo', nome: 'Térreo', ordem: 1 },
        { codigo: 'cobertura', nome: 'Cobertura', ordem: 2 },
      ])
      expect(lista.map((p) => p.codigo)).toEqual(['terreo', 'cobertura'])
      await expect(repo.salvarPavimentos('hto', [{ codigo: 'cobertura', nome: 'Cobertura', ordem: 2 }])).rejects.toThrow('Não é possível apagar pavimento com ambientes')
      await expect(repo.salvarPavimentos('hto', [{ codigo: 'A B', nome: 'x', ordem: 1 }])).rejects.toThrow('Código de pavimento inválido')
      await expect(
        repo.salvarPavimentos('hto', [
          { codigo: 'terreo', nome: 'Térreo', ordem: 1 },
          { codigo: 'terreo', nome: 'Outro', ordem: 2 },
        ]),
      ).rejects.toThrow('repetido')
    })

    it('salvarConfig grava a configuração (status válido) e exportarObra a devolve', async () => {
      const repo = criar()
      await repo.salvarConfig('hto', { status: 'revisado' } as never)
      expect((await repo.obterObra('hto')).config).toMatchObject({ status: 'revisado' })
      await expect(repo.salvarConfig('hto', { status: 'xis' } as never)).rejects.toThrow('Status inválido')
      expect(await repo.exportarObra('hto')).toMatchObject({ formato: 'miniappcofz-obra', obra: { slug: 'hto' } })
    })

    it('arquivarObra arquiva e desarquiva', async () => {
      const repo = criar()
      expect(await repo.arquivarObra('hto', true)).not.toBeNull()
      expect(await repo.arquivarObra('hto', false)).toBeNull()
    })

    it('excluirObra exige o nome exato, registra a exclusão e limparExclusao a conclui', async () => {
      const repo = criar()
      expect((await repo.resumoObra('hto')).pavimentos).toBeGreaterThan(0)
      await expect(repo.excluirObra('hto', 'errado')).rejects.toThrow('digite exatamente o nome da obra')
      const r = await repo.excluirObra('hto', 'HTO')
      expect(r.pendente).toBe(false)
      expect((await repo.listarObras()).map((o) => o.slug)).not.toContain('hto')
      const ex = await repo.listarExclusoes()
      expect(ex[0]).toMatchObject({ slug: 'hto', obra_id: 'obra-hto' })
      expect((await repo.limparExclusao(ex[0].id)).exclusao_id).toBe(ex[0].id)
      await expect(repo.limparExclusao('nao-existe')).rejects.toThrow('Exclusão não encontrada')
    })
  })
}
