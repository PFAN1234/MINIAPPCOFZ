import { describe, expect, it } from 'vitest'
import type { ModeloFrag } from '../../domain/modelos.ts'
import type { RegistroModelo } from '../../domain/tipos.ts'
import type { ModelosRepositorio } from './ModelosRepositorio.port.ts'

const HASH = '0123456789abcdef'

/** Instância para o contrato: o repositório e como "enviar" um arquivo ao bucket `modelos` antes de registrar. */
export interface AmbienteModelos {
  repo: ModelosRepositorio
  depositar(caminho: string, bytes: number): void
  /** Id da obra `hto` neste adaptador (compõe o caminho do arquivo). */
  obraId: string
}

/**
 * Comportamento que toda implementação de `ModelosRepositorio` deve cumprir. O adaptador precisa
 * servir, para a obra `hto`, um modelo `ARQ` listável e baixável (`manifestoArq`).
 */
export function contratoModelosRepositorio(nome: string, criar: () => AmbienteModelos, manifestoArq: ModeloFrag) {
  describe(`ModelosRepositorio (${nome})`, () => {
    const registro = (a: AmbienteModelos, extra: Partial<RegistroModelo> = {}): RegistroModelo => ({
      sigla: 'ARQ',
      revisao: 'R06',
      caminho: `${a.obraId}/ARQ/${HASH}.frag`,
      bytes: 10,
      hash: HASH,
      origem: 'frag',
      arquivo_nome: 'ARQ.frag',
      ...extra,
    })

    it('listarModelos devolve os modelos da obra e baixarModelo os bytes', async () => {
      const { repo } = criar()
      const lista = await repo.listarModelos('hto')
      expect(lista).toContainEqual(manifestoArq)
      expect((await repo.baixarModelo('hto', manifestoArq)).byteLength).toBeGreaterThan(0)
    })

    it('registrar publica o modelo e anota no histórico; a mesma sigla substitui', async () => {
      const a = criar()
      a.depositar(`${a.obraId}/ARQ/${HASH}.frag`, 10)
      const m = await a.repo.registrarModelo('hto', registro(a))
      expect(m).toMatchObject({ sigla: 'ARQ', revisao: 'R06', bytes: 10, hash: HASH })

      const outro = 'fedcba9876543210'
      a.depositar(`${a.obraId}/ARQ/${outro}.frag`, 20)
      await a.repo.registrarModelo('hto', registro(a, { revisao: 'R07', bytes: 20, hash: outro, caminho: `${a.obraId}/ARQ/${outro}.frag` }))

      const d = await a.repo.listarModelosAdmin('hto')
      expect(d.modelos).toHaveLength(1)
      expect(d.modelos[0]).toMatchObject({ revisao: 'R07', bytes: 20 })
      expect(d.historico.map((h) => [h.acao, h.revisao])).toEqual([
        ['publicado', 'R07'],
        ['publicado', 'R06'],
      ])
    })

    it('registrar rejeita sigla inválida, caminho errado, arquivo ausente e tamanho divergente', async () => {
      const a = criar()
      await expect(a.repo.registrarModelo('hto', registro(a, { sigla: 'arq' }))).rejects.toThrow(/Sigla inválida/)
      await expect(a.repo.registrarModelo('hto', registro(a, { caminho: 'x/ARQ/y.frag' }))).rejects.toThrow(/Caminho/)
      await expect(a.repo.registrarModelo('hto', registro(a))).rejects.toThrow(/não encontrado/)
      a.depositar(`${a.obraId}/ARQ/${HASH}.frag`, 11)
      await expect(a.repo.registrarModelo('hto', registro(a))).rejects.toThrow(/não 10/)
    })

    it('retirar tira do visualizador, guarda no histórico e falha se não houver', async () => {
      const a = criar()
      a.depositar(`${a.obraId}/ARQ/${HASH}.frag`, 10)
      await a.repo.registrarModelo('hto', registro(a))
      await a.repo.retirarModelo('hto', 'ARQ')
      const d = await a.repo.listarModelosAdmin('hto')
      expect(d.modelos).toEqual([])
      expect(d.historico[0]).toMatchObject({ acao: 'retirado', sigla: 'ARQ' })
      await expect(a.repo.retirarModelo('hto', 'ARQ')).rejects.toThrow(/Não há modelo publicado/)
    })

    it('listarObrasCentral traz todas as obras; a que publicou modelo conta a disciplina', async () => {
      const a = criar()
      const antes = await a.repo.listarObrasCentral()
      const hto = antes.find((o) => o.slug === 'hto')!
      expect(hto).toMatchObject({ disciplinas: 0, documentos: 0, issues_abertas: 0, atualizado_em: null })
      expect(antes.length).toBeGreaterThan(1)
      a.depositar(`${a.obraId}/ARQ/${HASH}.frag`, 10)
      await a.repo.registrarModelo('hto', registro(a))
      const depois = (await a.repo.listarObrasCentral()).find((o) => o.slug === 'hto')!
      expect(depois.disciplinas).toBe(1)
      expect(depois.atualizado_em).not.toBeNull()
      expect((await a.repo.listarObrasCentral()).filter((o) => o.disciplinas === 0).length).toBe(antes.length - 1)
    })

    it('o estado de uma instância não vaza para outra', async () => {
      const a = criar()
      a.depositar(`${a.obraId}/ARQ/${HASH}.frag`, 10)
      await a.repo.registrarModelo('hto', registro(a))
      expect((await criar().repo.listarModelosAdmin('hto')).modelos).toEqual([])
    })
  })
}
