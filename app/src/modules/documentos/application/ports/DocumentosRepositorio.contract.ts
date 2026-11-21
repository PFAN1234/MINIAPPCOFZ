import { describe, expect, it } from 'vitest'
import type { RegistroDocumento, VinculoDocumento } from '../../domain/documentos.ts'
import type { DocumentosRepositorio } from './DocumentosRepositorio.port.ts'

const SERIE = '11111111-1111-4111-8111-111111111111'
const SHA1 = 'a'.repeat(64)
const SHA2 = 'b'.repeat(64)

/** Instância para o contrato: o repositório e como "enviar" um arquivo ao bucket `documentos` antes de registrar. */
export interface AmbienteDocumentos {
  repo: DocumentosRepositorio
  depositar(caminho: string, conteudo: Uint8Array): void
  /** Id da obra `hto` neste adaptador (compõe o caminho do arquivo). */
  obraId: string
}

/** Comportamento que toda implementação de `DocumentosRepositorio` deve cumprir (a obra `hto` começa sem documentos). */
export function contratoDocumentosRepositorio(nome: string, criar: () => AmbienteDocumentos) {
  describe(`DocumentosRepositorio (${nome})`, () => {
    const caminho = (a: AmbienteDocumentos, sha: string, serie = SERIE) => `${a.obraId}/${serie}/${sha}.pdf`
    const registro = (a: AmbienteDocumentos, extra: Partial<RegistroDocumento> = {}): RegistroDocumento => ({
      serie: SERIE,
      codigo: 'CE01-14PE01-ARQ-PR-012',
      titulo: 'Planta baixa',
      tipo: 'prancha',
      disciplina: 'ARQ',
      revisao: 'R01',
      caminho: caminho(a, SHA1),
      arquivoNome: 'planta.pdf',
      mime: 'application/pdf',
      bytes: 3,
      sha256: SHA1,
      ...extra,
    })
    const conteudo = new Uint8Array([1, 2, 3])
    const segunda = (a: AmbienteDocumentos) =>
      registro(a, { revisao: 'R02', caminho: caminho(a, SHA2), sha256: SHA2, bytes: 4 })

    it('registrar uma série nova a põe na listagem', async () => {
      const a = criar()
      a.depositar(caminho(a, SHA1), conteudo)
      const d = await a.repo.registrarDocumento('hto', registro(a))
      expect(d).toMatchObject({ serie: SERIE, titulo: 'Planta baixa', revisao: 'R01', revisoes: 1, vinculos: [], bytes: 3 })
      const lista = await a.repo.listarDocumentos('hto')
      expect(lista).toHaveLength(1)
      expect(lista[0]).toMatchObject({ id: d.id, tipo: 'prancha', disciplina: 'ARQ', sha256: SHA1 })
    })

    it('nova revisão: a listagem mostra só a vigente e o histórico traz as duas', async () => {
      const a = criar()
      a.depositar(caminho(a, SHA1), conteudo)
      a.depositar(caminho(a, SHA2), new Uint8Array([1, 2, 3, 4]))
      await a.repo.registrarDocumento('hto', registro(a))
      await a.repo.registrarDocumento('hto', segunda(a))
      const lista = await a.repo.listarDocumentos('hto')
      expect(lista).toHaveLength(1)
      expect(lista[0]).toMatchObject({ revisao: 'R02', revisoes: 2 })
      const h = await a.repo.historicoDocumento(SERIE)
      expect(h.map((r) => r.revisao)).toEqual(['R02', 'R01'])
      expect(h.every((r) => r.retiradoEm === null)).toBe(true)
    })

    it('revisão repetida na série dá erro', async () => {
      const a = criar()
      a.depositar(caminho(a, SHA1), conteudo)
      await a.repo.registrarDocumento('hto', registro(a))
      await expect(a.repo.registrarDocumento('hto', registro(a))).rejects.toThrow(/revisão R01 já existe/)
    })

    it('registrar sem o arquivo no storage, ou com tamanho diferente, dá erro', async () => {
      const a = criar()
      await expect(a.repo.registrarDocumento('hto', registro(a))).rejects.toThrow(/não encontrado/)
      a.depositar(caminho(a, SHA1), new Uint8Array(5))
      await expect(a.repo.registrarDocumento('hto', registro(a))).rejects.toThrow(/5 bytes/)
    })

    it('registrar rejeita caminho que não confere', async () => {
      const a = criar()
      await expect(a.repo.registrarDocumento('hto', registro(a, { caminho: 'x/y/z.pdf' }))).rejects.toThrow(/Caminho/)
    })

    it('retirar tira da lista e mantém no histórico; retirar de novo falha', async () => {
      const a = criar()
      a.depositar(caminho(a, SHA1), conteudo)
      const d = await a.repo.registrarDocumento('hto', registro(a))
      await a.repo.retirarDocumento(d.id)
      expect(await a.repo.listarDocumentos('hto')).toEqual([])
      const h = await a.repo.historicoDocumento(SERIE)
      expect(h).toHaveLength(1)
      expect(h[0].retiradoEm).not.toBeNull()
      await expect(a.repo.retirarDocumento(d.id)).rejects.toThrow(/já foi retirado/)
      await expect(a.repo.retirarDocumento('00000000-0000-4000-8000-000000000000')).rejects.toThrow(/não encontrado/)
    })

    it('retirar a revisão vigente devolve a anterior à lista', async () => {
      const a = criar()
      a.depositar(caminho(a, SHA1), conteudo)
      a.depositar(caminho(a, SHA2), new Uint8Array([1, 2, 3, 4]))
      await a.repo.registrarDocumento('hto', registro(a))
      const r2 = await a.repo.registrarDocumento('hto', segunda(a))
      await a.repo.retirarDocumento(r2.id)
      expect(await a.repo.listarDocumentos('hto')).toMatchObject([{ revisao: 'R01', revisoes: 2 }])
    })

    it('histórico de série inexistente dá erro', async () => {
      await expect(criar().repo.historicoDocumento(SERIE)).rejects.toThrow(/não encontrado/)
    })

    it('vincular substitui os vínculos e ignora duplicados', async () => {
      const a = criar()
      a.depositar(caminho(a, SHA1), conteudo)
      const d = await a.repo.registrarDocumento('hto', registro(a))
      const v = (globalId: string, extra: Partial<VinculoDocumento> = {}): VinculoDocumento => ({
        tipo: 'elemento',
        sigla: 'ARQ',
        globalId,
        classe: 'IfcWall',
        nome: 'Parede',
        ...extra,
      })
      const primeiro = await a.repo.vincularDocumento(d.id, [v('g1'), v('g2'), v('g1')])
      expect(primeiro.map((x) => x.globalId)).toEqual(['g1', 'g2'])
      const segundo = await a.repo.vincularDocumento(d.id, [v('g3', { tipo: 'pavimento' })])
      expect(segundo).toHaveLength(1)
      expect((await a.repo.listarDocumentos('hto'))[0].vinculos).toMatchObject([{ tipo: 'pavimento', globalId: 'g3' }])
      expect(await a.repo.vincularDocumento(d.id, [])).toEqual([])
    })

    it('vincular rejeita sigla inválida e documento retirado', async () => {
      const a = criar()
      a.depositar(caminho(a, SHA1), conteudo)
      const d = await a.repo.registrarDocumento('hto', registro(a))
      await expect(a.repo.vincularDocumento(d.id, [{ tipo: 'elemento', sigla: 'arq', globalId: 'g' }])).rejects.toThrow(/Sigla/)
      await a.repo.retirarDocumento(d.id)
      await expect(a.repo.vincularDocumento(d.id, [])).rejects.toThrow(/retirado/)
    })

    it('baixar devolve o conteúdo', async () => {
      const a = criar()
      a.depositar(caminho(a, SHA1), conteudo)
      const d = await a.repo.registrarDocumento('hto', registro(a))
      const blob = await a.repo.baixarDocumento(d.caminho)
      expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([1, 2, 3])
    })

    it('o estado de uma instância não vaza para outra', async () => {
      const a = criar()
      a.depositar(caminho(a, SHA1), conteudo)
      await a.repo.registrarDocumento('hto', registro(a))
      expect(await criar().repo.listarDocumentos('hto')).toEqual([])
    })
  })
}
