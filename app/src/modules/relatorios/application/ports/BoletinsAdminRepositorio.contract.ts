import { describe, expect, it } from 'vitest'
import type { BoletinsAdminRepositorio } from './BoletinsAdminRepositorio.port.ts'

export interface SementeBoletinsAdmin {
  repo: BoletinsAdminRepositorio
  etapaSlug: string
  dataSemPedido: string
}

/** Contrato reutilizável de `BoletinsAdminRepositorio`. */
export function contratoBoletinsAdmin(nome: string, criar: () => SementeBoletinsAdmin) {
  describe(`BoletinsAdminRepositorio (${nome})`, () => {
    it('lista boletins da etapa e todos os boletins com filtros', async () => {
      const { repo, etapaSlug } = criar()
      const daEtapa = await repo.listarBoletins(etapaSlug)
      expect(daEtapa.boletins.length).toBeGreaterThan(0)

      const todos = await repo.listarTodosBoletins({ etapa: etapaSlug })
      expect(todos.boletins.every((b) => b.etapa_slug === etapaSlug)).toBe(true)
    })

    it('pede emissão e gera prévia em PDF', async () => {
      const { repo, etapaSlug, dataSemPedido } = criar()
      const pedido = await repo.pedirEmissao(etapaSlug, dataSemPedido)
      expect(pedido.estado).toBe('pendente')
      expect(pedido.data).toBe(dataSemPedido)

      const previa = await repo.previaBoletim(etapaSlug, dataSemPedido)
      expect(previa.size).toBeGreaterThan(0)
    })

    it('obtém detalhe, salva/limpa rascunho, gera prévia editada e retifica', async () => {
      const { repo, etapaSlug } = criar()
      const { boletins } = await repo.listarBoletins(etapaSlug)
      const alvo = boletins[0]
      const detalhe = await repo.boletim(alvo.id)
      expect(detalhe.id).toBe(alvo.id)
      expect(detalhe.ultima_revisao).toBe(true)

      const salvo = await repo.salvarRascunhoBoletim(alvo.id, { ocultos: ['servico:x'] })
      expect(salvo?.atualizado_em).toBeTruthy()
      expect(await repo.salvarRascunhoBoletim(alvo.id, {})).toBeNull()

      const previa = await repo.previaBoletimEditado(alvo.id, { ocultos: ['servico:x'] })
      expect(previa.size).toBeGreaterThan(0)

      const ret = await repo.retificarBoletim(alvo.id, { ocultos: ['servico:x'] })
      expect(ret.estado).toBe('pendente')
      expect(ret.revisao).toBe(alvo.revisao + 1)
    })

    it('exclui o dia inteiro do boletim e devolve URLs de fotos', async () => {
      const { repo, etapaSlug } = criar()
      const { boletins } = await repo.listarBoletins(etapaSlug)
      const alvo = boletins[boletins.length - 1]
      const res = await repo.excluirBoletim(etapaSlug, alvo.id)
      expect(res.data).toBe(alvo.data)
      expect(res.revisoes).toBeGreaterThanOrEqual(1)

      const urls = await repo.urlsFotos(['etapa/fotos/a.jpg'])
      expect(typeof urls['etapa/fotos/a.jpg']).toBe('string')
    })
  })
}
