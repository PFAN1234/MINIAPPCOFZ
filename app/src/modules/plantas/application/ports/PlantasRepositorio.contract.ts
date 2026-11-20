import { describe, expect, it } from 'vitest'
import { caminhoOriginal, caminhosPlanta } from '../../domain/plantas.ts'
import type { PlantasRepositorio } from './PlantasRepositorio.port.ts'

const SHA = 'a'.repeat(64)
const WEBP = new Blob([new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])], { type: 'image/webp' })
const PDF = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3])], { type: 'application/pdf' })

/** Instância para o contrato: o repositório e a obra `hto` (slug, id e um pavimento com planta ativa). */
export interface AmbientePlantas {
  repo: PlantasRepositorio
  slug: string
  obraId: string
  pavimento: string
}

/** Comportamento que toda implementação de `PlantasRepositorio` deve cumprir. */
export function contratoPlantasRepositorio(nome: string, criar: () => AmbientePlantas) {
  describe(`PlantasRepositorio (${nome})`, () => {
    /** Envia o PDF e as imagens de um pavimento e devolve o payload mínimo para publicá-lo. */
    async function prepararPublicacao(a: AmbientePlantas, revisao: string) {
      const { repo, obraId, pavimento } = a
      const original = caminhoOriginal(obraId, revisao, pavimento, SHA)
      await repo.enviarArquivo('originais', original, PDF, 'application/pdf')
      const c = caminhosPlanta(obraId, revisao, pavimento)
      for (const caminho of [c.planta, c.hd, c.detalhe('novo-ambiente')]) {
        await repo.enviarArquivo('plantas', caminho, WEBP, 'image/webp')
      }
      return {
        pavimentos: [
          {
            codigo: pavimento,
            revisao,
            pdf: { path: original, sha256: SHA, nome: 'planta.pdf', pagina: 1 },
            pagina_pt: [1000, 800],
            recorte_pt: [10, 10, 900, 700],
            detalhes: { 'novo-ambiente': { recorte_pt: [0, 0, 10, 10], largura: 10, altura: 10 } },
            resumo: { diferencas: 0 },
          },
        ],
        ambientes: [
          {
            codigo: 'novo-ambiente',
            pavimento,
            nome_operacional: 'Novo ambiente',
            nome_planta: 'NOVO',
            categoria: 'area_comum',
            area_m2: 12.5,
            marcadores: [{ x: 0.5, y: 0.5 }],
          },
        ],
      }
    }

    it('obterEditorPlanta devolve a obra, os pavimentos com planta ativa e os ambientes', async () => {
      const a = criar()
      const d = await a.repo.obterEditorPlanta(a.slug)
      expect(d.obra.slug).toBe(a.slug)
      expect(d.ambientes.length).toBeGreaterThan(0)
      const pav = d.pavimentos.find((p) => p.codigo === a.pavimento)
      expect(pav?.planta).not.toBeNull()
      expect(pav?.ultimo_pdf).toBeNull()
      expect(await a.repo.listarPublicacoes(a.slug)).toEqual([])
    })

    it('enviarArquivo e baixarOriginal fazem ida e volta dos bytes do PDF', async () => {
      const a = criar()
      const caminho = caminhoOriginal(a.obraId, 'R99', a.pavimento, SHA)
      await a.repo.enviarArquivo('originais', caminho, PDF, 'application/pdf')
      expect([...(await a.repo.baixarOriginal(caminho))]).toEqual([0x25, 0x50, 0x44, 0x46, 1, 2, 3])
      await expect(a.repo.baixarOriginal(`${a.obraId}/R99/inexistente.pdf`)).rejects.toThrow()
    })

    it('enviarArquivo recusa a pasta de uma obra que não existe', async () => {
      const a = criar()
      await expect(a.repo.enviarArquivo('plantas', 'obra-fantasma/R01/x/planta.webp', WEBP, 'image/webp')).rejects.toThrow()
    })

    it('publicarRevisao grava planta e ambiente e listarPublicacoes mostra o histórico', async () => {
      const a = criar()
      const payload = await prepararPublicacao(a, 'R99')
      const r = await a.repo.publicarRevisao(a.slug, payload)
      expect(r.publicacoes).toHaveLength(1)
      expect(r.publicacoes[0]).toMatchObject({ pavimento: a.pavimento, revisao: 'R99' })

      const pubs = await a.repo.listarPublicacoes(a.slug)
      expect(pubs).toHaveLength(1)
      expect(pubs[0]).toMatchObject({ pavimento: a.pavimento, revisao: 'R99', pdf_sha256: SHA, pdf_nome: 'planta.pdf', pagina: 1 })

      const d = await a.repo.obterEditorPlanta(a.slug)
      const pav = d.pavimentos.find((p) => p.codigo === a.pavimento)
      expect(pav?.planta?.revisao).toBe('R99')
      expect(pav?.ultimo_pdf).toMatchObject({ path: caminhoOriginal(a.obraId, 'R99', a.pavimento, SHA), revisao: 'R99' })
      expect(d.ambientes.find((x) => x.codigo === 'novo-ambiente')).toMatchObject({ ativo: true, revisao_planta: 'R99' })
    })

    it('publicarRevisao exige o PDF e as imagens no Storage antes', async () => {
      const a = criar()
      const payload = await prepararPublicacao(a, 'R98')
      payload.pavimentos[0].pdf.path = `${a.obraId}/R98/${a.pavimento}/${'b'.repeat(64)}.pdf`
      await expect(a.repo.publicarRevisao(a.slug, payload)).rejects.toThrow(/PDF não encontrado/)
      expect(await a.repo.listarPublicacoes(a.slug)).toEqual([])
    })
  })
}
