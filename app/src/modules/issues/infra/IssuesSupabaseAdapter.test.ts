import { describe, expect, it, vi } from 'vitest'
import type { Armazenamento } from '@modules/armazenamento/application/ports/Armazenamento.port.ts'
import type { Vista } from '../../modelos/domain/central.ts'
import { criarIssuesSupabase } from './IssuesSupabaseAdapter.ts'

const VISTA: Vista = { camera: { posicao: [0, 0, 1], alvo: [0, 0, 0], projecao: 'perspectiva' }, cortes: [], selecionados: [], ocultos: [], isolados: null }

function montar(resposta: unknown = null, urls = new Map<string, string>()) {
  const rpc = vi.fn(async () => resposta)
  const armazenamento = { urls: vi.fn(async () => urls) } as unknown as Armazenamento
  return { rpc, repo: criarIssuesSupabase(armazenamento, rpc as never), armazenamento }
}

describe('IssuesSupabaseAdapter', () => {
  it('listarIssues converte as linhas da RPC', async () => {
    const { repo, rpc } = montar([
      {
        id: 'i1', numero: 3, guid: 'g', titulo: 'T', descricao: null, tipo: 'conflito', prioridade: 'alta', status: 'aberta',
        responsavel_id: 'u1', responsavel_nome: 'Ana', prazo: '2026-12-01', criado_por: 'u2', criado_por_nome: 'Bia',
        criado_em: 'c', atualizado_em: 'a',
        vistas: [{ id: 'v1', guid: 'vg', vista: VISTA, imagem_path: 'o/i1/v1.png', criado_em: 'c' }],
        comentarios: [{ id: 'c1', guid: 'cg', autor_id: null, autor_nome: null, texto: 'oi', vista_id: 'v1', criado_em: 'c' }],
      },
    ])
    const [i] = await repo.listarIssues('obra-1')
    expect(rpc).toHaveBeenCalledWith('admin_listar_issues', { p_obra: 'obra-1' })
    expect(i).toMatchObject({ numero: 3, responsavelNome: 'Ana', prazo: '2026-12-01', criadoPorNome: 'Bia' })
    expect(i.vistas[0]).toMatchObject({ imagemPath: 'o/i1/v1.png', vista: VISTA })
    expect(i.comentarios[0]).toMatchObject({ autorId: null, vistaId: 'v1' })
  })

  it('listar sem resultado devolve lista vazia', async () => {
    expect(await montar(null).repo.listarIssues('o')).toEqual([])
  })

  it('salvarIssue: criar leva obra_id; atualizar só as chaves presentes', async () => {
    const { repo, rpc } = montar({ id: 'i1', numero: 1 })
    await repo.salvarIssue('o1', { titulo: ' T ', prazo: '2026-12-01' })
    expect(rpc).toHaveBeenLastCalledWith('admin_salvar_issue', { p: { obra_id: 'o1', titulo: 'T', prazo: '2026-12-01' } })
    await repo.salvarIssue('o1', { status: 'resolvida', descricao: null, responsavelId: null }, 'i1')
    expect(rpc).toHaveBeenLastCalledWith('admin_salvar_issue', { p: { id: 'i1', status: 'resolvida', descricao: null, responsavel_id: null } })
  })

  it('comentar e salvar vista chamam as RPCs com os parâmetros certos', async () => {
    const { repo, rpc } = montar('novo-id')
    expect(await repo.comentarIssue('i1', ' oi ', 'v1')).toBe('novo-id')
    expect(rpc).toHaveBeenLastCalledWith('admin_comentar_issue', { p_issue: 'i1', p_texto: 'oi', p_vista: 'v1' })
    await repo.salvarVistaIssue('i1', 'v1', VISTA, 'o/i1/v1.png')
    expect(rpc).toHaveBeenLastCalledWith('admin_salvar_vista_issue', { p_issue: 'i1', p_id: 'v1', p_vista: VISTA, p_imagem_path: 'o/i1/v1.png' })
  })

  it('urlImagemVista usa o bucket issues e devolve null se não houver', async () => {
    const m = montar(null, new Map([['o/i/v.png', 'https://r2/x']]))
    expect(await m.repo.urlImagemVista('o/i/v.png')).toBe('https://r2/x')
    expect(m.armazenamento.urls).toHaveBeenCalledWith('issues', ['o/i/v.png'])
    expect(await m.repo.urlImagemVista('outro')).toBeNull()
  })

  it('importarBcf converte o tópico para o JSON da RPC', async () => {
    const { repo, rpc } = montar({ criadas: 1, atualizadas: 0 })
    const r = await repo.importarBcf('o1', [
      { guid: 'g', titulo: 'T', criadoEm: '2026-01-01T00:00:00Z', vistas: [{ guid: 'vg', vista: VISTA }], comentarios: [{ guid: 'cg', texto: 'x', vistaGuid: 'vg' }] },
    ])
    expect(r).toEqual({ criadas: 1, atualizadas: 0 })
    expect(rpc).toHaveBeenCalledWith('admin_importar_bcf', {
      p_obra: 'o1',
      p_topicos: [
        { guid: 'g', titulo: 'T', criado_em: '2026-01-01T00:00:00Z', vistas: [{ guid: 'vg', vista: VISTA }], comentarios: [{ guid: 'cg', texto: 'x', vista_guid: 'vg' }] },
      ],
    })
  })
})
