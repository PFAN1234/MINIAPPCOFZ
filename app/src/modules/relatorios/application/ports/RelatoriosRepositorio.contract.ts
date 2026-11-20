import { describe, expect, it } from 'vitest'
import type { RelatoriosRepositorio } from './RelatoriosRepositorio.port.ts'

export interface SementeRelatorios {
  repo: RelatoriosRepositorio
  etapaId: string
  etapaSlug: string
}

/** Contrato reutilizável de `RelatoriosRepositorio` (espera usuário admin para emissão/exclusão). */
export function contratoRelatorios(nome: string, criar: () => SementeRelatorios) {
  describe(`RelatoriosRepositorio (${nome})`, () => {
    it('lista etapas e boletins emitidos na aba Relatórios', async () => {
      const { repo } = criar()
      const dados = await repo.relatorios()
      expect(dados.etapas.length).toBeGreaterThan(0)
      expect(dados.boletins.length).toBeGreaterThan(0)
    })

    it('carrega o painel de movimento da etapa', async () => {
      const { repo, etapaId } = criar()
      const painel = await repo.painelRelatorios(etapaId)
      expect(painel.etapa.id).toBe(etapaId)
      expect(painel.obras.length).toBeGreaterThan(0)
      expect(painel.dias.length).toBeGreaterThan(0)
    })

    it('emite e exclui boletim do dia', async () => {
      const { repo, etapaSlug } = criar()
      const antes = await repo.relatorios()
      const hoje = antes.etapas.find((e) => e.slug === etapaSlug)!.hoje

      await repo.emitirBoletim(etapaSlug, hoje)
      const depoisEmissao = await repo.relatorios()
      const emitido = depoisEmissao.boletins.find((b) => b.etapa_slug === etapaSlug && b.data === hoje)
      expect(emitido).toBeDefined()

      const res = await repo.excluirBoletim(emitido!.id)
      expect(res.data).toBe(hoje)
      expect(res.revisoes).toBeGreaterThanOrEqual(1)

      const depoisExclusao = await repo.relatorios()
      expect(depoisExclusao.boletins.some((b) => b.etapa_slug === etapaSlug && b.data === hoje)).toBe(false)
    })

    it('devolve URL assinada para PDF de boletim e exportação de pendências', async () => {
      const { repo, etapaId } = criar()
      const urlPdf = await repo.urlPdfBoletim('etapa/2026-11-10-0.pdf')
      expect(urlPdf).toContain('http')
      const urlExp = await repo.exportarPendencias(etapaId, null)
      expect(urlExp).toContain('http')
    })
  })
}
