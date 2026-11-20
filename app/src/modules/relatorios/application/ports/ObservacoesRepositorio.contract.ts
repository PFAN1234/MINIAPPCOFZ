import { describe, expect, it } from 'vitest'
import type { ObservacoesRepositorio } from './ObservacoesRepositorio.port.ts'

export interface SementeObservacoes {
  repo: ObservacoesRepositorio
  obraId: string
}

/** Contrato reutilizável de `ObservacoesRepositorio`. */
export function contratoObservacoes(nome: string, criar: () => SementeObservacoes) {
  describe(`ObservacoesRepositorio (${nome})`, () => {
    it('lista observações do dia, cria, edita e exclui observação própria', async () => {
      const { repo, obraId } = criar()
      const inicial = await repo.observacoesDoDia(obraId)
      expect(inicial.fuso).toBeTruthy()

      const id = '99999999-9999-4999-8999-999999999999'
      const criada = await repo.salvarObservacao({
        id,
        obraId,
        texto: 'Observação de teste inicial',
        escritoEm: new Date().toISOString(),
      })
      expect(criada.id).toBe(id)
      expect(criada.minha).toBe(true)
      expect(criada.editado_em).toBeNull()

      const editada = await repo.salvarObservacao({
        id,
        obraId,
        texto: 'Observação de teste editada',
        escritoEm: new Date().toISOString(),
      })
      expect(editada.texto).toBe('Observação de teste editada')
      expect(editada.editado_em).not.toBeNull()

      await repo.excluirObservacao(id)
      const final = await repo.observacoesDoDia(obraId)
      expect(final.observacoes.some((o) => o.id === id)).toBe(false)
      // Excluir id inexistente não falha
      await expect(repo.excluirObservacao(id)).resolves.toBeUndefined()
    })
  })
}
