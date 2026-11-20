import { describe, expect, it } from 'vitest'
import type { PublicacoesRepositorio } from './PublicacoesRepositorio.port.ts'

export interface SementePublicacoes {
  repo: PublicacoesRepositorio
  obraId: string
  publicacaoFalhouId: number
  publicacaoIncertoId: number
}

/** Contrato reutilizável de `PublicacoesRepositorio`. */
export function contratoPublicacoes(nome: string, criar: () => SementePublicacoes) {
  describe(`PublicacoesRepositorio (${nome})`, () => {
    it('lista publicações com problema em ordem decrescente de atualização', async () => {
      const { repo, obraId } = criar()
      const lista = await repo.listarPublicacoesProblema(obraId)
      expect(lista.length).toBeGreaterThanOrEqual(2)
      for (let i = 1; i < lista.length; i++) {
        expect(lista[i - 1].atualizado_em >= lista[i].atualizado_em).toBe(true)
      }
    })

    it('republicar remove a publicação da lista de problemas', async () => {
      const { repo, obraId, publicacaoFalhouId } = criar()
      await repo.republicar(publicacaoFalhouId)
      const depois = await repo.listarPublicacoesProblema(obraId)
      expect(depois.some((p) => p.id === publicacaoFalhouId)).toBe(false)
    })

    it('marcarPublicada remove a publicação da lista de problemas', async () => {
      const { repo, obraId, publicacaoIncertoId } = criar()
      await repo.marcarPublicada(publicacaoIncertoId)
      const depois = await repo.listarPublicacoesProblema(obraId)
      expect(depois.some((p) => p.id === publicacaoIncertoId)).toBe(false)
    })
  })
}
