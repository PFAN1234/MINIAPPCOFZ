import { describe, expect, it } from 'vitest'
import type { AcessosRepositorio } from './AcessosRepositorio.port.ts'

const HTO = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4e01'
const DEMONSTRACAO = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4e03'
const ID_VOCE = 'usuario-teste'

/** Comportamento que toda implementação de `AcessosRepositorio` deve cumprir (dados da fixture). */
export function contratoAcessosRepositorio(nome: string, criar: () => AcessosRepositorio) {
  describe(`AcessosRepositorio (${nome})`, () => {
    it('solicitarAcesso marca a obra como pendente em obrasDisponiveis', async () => {
      const repo = criar()
      expect((await repo.obrasDisponiveis())[0].solicitacao).toBeNull()
      await repo.solicitarAcesso(DEMONSTRACAO)
      expect((await repo.obrasDisponiveis())[0].solicitacao).toBe('pendente')
    })

    it('decidirSolicitacao aprova o pedido e ele sai da lista', async () => {
      const repo = criar()
      const [pedido] = await repo.listarSolicitacoes(HTO)
      await repo.decidirSolicitacao(pedido.id, true)
      expect(await repo.listarSolicitacoes(HTO)).toEqual([])
      await expect(repo.decidirSolicitacao(pedido.id, false)).rejects.toMatchObject({ tipo: 'conflito' })
    })

    it('listarParticipantes põe gestores primeiro', async () => {
      const lista = await criar().listarParticipantes(HTO)
      expect(lista[0].papel).toBe('gestor')
    })

    it('o último gestor não pode virar equipe nem ser removido', async () => {
      const repo = criar()
      await expect(repo.definirPapel(HTO, ID_VOCE, 'equipe')).rejects.toMatchObject({ tipo: 'validacao' })
      await expect(repo.removerParticipante(HTO, ID_VOCE)).rejects.toMatchObject({ tipo: 'validacao' })
    })

    it('removerParticipante tira a pessoa da lista', async () => {
      const repo = criar()
      const [, alvo] = await repo.listarParticipantes(HTO)
      await repo.removerParticipante(HTO, alvo.usuario_id)
      const ids = (await repo.listarParticipantes(HTO)).map((p) => p.usuario_id)
      expect(ids).not.toContain(alvo.usuario_id)
    })

    it('definirAcesso concede acesso e matrizAcessos reflete', async () => {
      const repo = criar()
      const obra = (await repo.matrizAcessos()).obras.find((o) => o.slug === 'aurora')!
      await repo.definirAcesso(obra.id, ID_VOCE, 'equipe')
      const voce = (await repo.matrizAcessos()).pessoas.find((p) => p.id === ID_VOCE)!
      expect(voce.acessos[obra.id]).toBe('equipe')
    })

    it('definirAcesso rejeita papel inválido', async () => {
      await expect(criar().definirAcesso(HTO, ID_VOCE, 'dono' as never)).rejects.toMatchObject({ tipo: 'validacao' })
    })
  })
}
