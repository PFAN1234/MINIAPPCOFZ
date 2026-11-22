import { describe, expect, it } from 'vitest'
import type { Vista } from '../../../modelos/domain/central.ts'
import type { IssuesRepositorio } from './IssuesRepositorio.port.ts'

const VISTA: Vista = {
  camera: { posicao: [1, 2, 3], alvo: [0, 0, 0], projecao: 'perspectiva' },
  cortes: [],
  selecionados: [{ sigla: 'ARQ', globalId: '0abc' }],
  ocultos: [],
  isolados: null,
}
const VISTA_ID = '22222222-2222-4222-8222-222222222222'

/** Instância para o contrato: o repositório e como "enviar" a imagem ao bucket `issues` antes de salvar a vista. */
export interface AmbienteIssues {
  repo: IssuesRepositorio
  depositar(caminho: string): void
  /** Obra sem issues no início. */
  obraId: string
}

/** Comportamento que toda implementação de `IssuesRepositorio` deve cumprir. */
export function contratoIssuesRepositorio(nome: string, criar: () => AmbienteIssues) {
  describe(`IssuesRepositorio (${nome})`, () => {
    it('criar numera em sequência e lista da mais nova para a mais antiga', async () => {
      const { repo, obraId } = criar()
      const a = await repo.salvarIssue(obraId, { titulo: 'Primeira' })
      const b = await repo.salvarIssue(obraId, { titulo: '  Segunda  ', tipo: 'conflito', prioridade: 'alta', prazo: '2026-12-01' })
      expect(b.numero).toBe(a.numero + 1)
      const lista = await repo.listarIssues(obraId)
      expect(lista.map((i) => i.id)).toEqual([b.id, a.id])
      expect(lista[0]).toMatchObject({ titulo: 'Segunda', tipo: 'conflito', prioridade: 'alta', status: 'aberta', prazo: '2026-12-01' })
      expect(lista[1]).toMatchObject({ tipo: 'problema', prioridade: 'normal', descricao: null, prazo: null, responsavelId: null })
      expect(lista[0].vistas).toEqual([])
      expect(lista[0].comentarios).toEqual([])
    })

    it('criar exige título', async () => {
      const { repo, obraId } = criar()
      await expect(repo.salvarIssue(obraId, { titulo: '   ' })).rejects.toThrow()
      await expect(repo.salvarIssue(obraId, {})).rejects.toThrow()
    })

    it('atualizar muda só as chaves presentes e null limpa', async () => {
      const { repo, obraId } = criar()
      const { id } = await repo.salvarIssue(obraId, { titulo: 'X', descricao: 'd', prazo: '2026-12-01' })
      await repo.salvarIssue(obraId, { status: 'em_andamento' }, id)
      let i = (await repo.listarIssues(obraId))[0]
      expect(i).toMatchObject({ titulo: 'X', descricao: 'd', prazo: '2026-12-01', status: 'em_andamento' })
      await repo.salvarIssue(obraId, { descricao: null, prazo: null, titulo: 'Y' }, id)
      i = (await repo.listarIssues(obraId))[0]
      expect(i).toMatchObject({ titulo: 'Y', descricao: null, prazo: null, status: 'em_andamento' })
    })

    it('comentar acrescenta ao fim e recusa texto vazio', async () => {
      const { repo, obraId } = criar()
      const { id } = await repo.salvarIssue(obraId, { titulo: 'X' })
      const c = await repo.comentarIssue(id, '  Olhei no local  ')
      const [i] = await repo.listarIssues(obraId)
      expect(i.comentarios).toHaveLength(1)
      expect(i.comentarios[0]).toMatchObject({ id: c, texto: 'Olhei no local', vistaId: null })
      await expect(repo.comentarIssue(id, '  ')).rejects.toThrow()
    })

    it('salvar vista com imagem confirmada; sem imagem enviada, recusa', async () => {
      const a = criar()
      const { id } = await a.repo.salvarIssue(a.obraId, { titulo: 'X' })
      const caminho = `${a.obraId}/${id}/${VISTA_ID}.png`
      await expect(a.repo.salvarVistaIssue(id, VISTA_ID, VISTA, caminho)).rejects.toThrow()
      a.depositar(caminho)
      expect(await a.repo.salvarVistaIssue(id, VISTA_ID, VISTA, caminho)).toBe(VISTA_ID)
      const [i] = await a.repo.listarIssues(a.obraId)
      expect(i.vistas).toHaveLength(1)
      expect(i.vistas[0]).toMatchObject({ id: VISTA_ID, imagemPath: caminho, vista: VISTA })
      const c = await a.repo.comentarIssue(id, 'Na vista', VISTA_ID)
      expect((await a.repo.listarIssues(a.obraId))[0].comentarios.find((x) => x.id === c)?.vistaId).toBe(VISTA_ID)
    })

    it('salvar vista sem imagem é aceito', async () => {
      const { repo, obraId } = criar()
      const { id } = await repo.salvarIssue(obraId, { titulo: 'X' })
      await repo.salvarVistaIssue(id, VISTA_ID, VISTA)
      expect((await repo.listarIssues(obraId))[0].vistas[0].imagemPath).toBeNull()
    })

    it('importar BCF cria e depois atualiza pelo guid', async () => {
      const { repo, obraId } = criar()
      const guid = '33333333-3333-4333-8333-333333333333'
      expect(await repo.importarBcf(obraId, [{ guid, titulo: 'Do BCF', status: 'resolvida' }])).toEqual({ criadas: 1, atualizadas: 0 })
      expect(await repo.importarBcf(obraId, [{ guid, titulo: 'Do BCF 2' }])).toEqual({ criadas: 0, atualizadas: 1 })
      const lista = await repo.listarIssues(obraId)
      expect(lista).toHaveLength(1)
      expect(lista[0]).toMatchObject({ guid, titulo: 'Do BCF 2', status: 'resolvida' })
    })
  })
}
