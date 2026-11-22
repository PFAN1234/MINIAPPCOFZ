import { describe, expect, it, vi } from 'vitest'
import type { Vista } from '../../../modelos/domain/central.ts'
import { adicionarVista, criarIssueComVista, ErroImagemVista, type DepsIssueComVista } from './criarIssueComVista.ts'

const VISTA: Vista = {
  camera: { posicao: [0, 0, 1], alvo: [0, 0, 0], projecao: 'ortografica' },
  cortes: [],
  selecionados: [],
  ocultos: [],
  isolados: null,
}
const PNG = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })
const VID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function deps(extra: Partial<DepsIssueComVista> = {}) {
  const ordem: string[] = []
  const d = {
    enviarArquivo: vi.fn(async () => void ordem.push('enviar')),
    salvarIssue: vi.fn(async () => (ordem.push('issue'), { id: 'i1', numero: 7 })),
    salvarVistaIssue: vi.fn(async (_i: string, v: string) => (ordem.push('vista'), v)),
    novoId: () => VID,
    ...extra,
  } satisfies DepsIssueComVista
  return { d, ordem }
}

describe('criarIssueComVista', () => {
  it('salva a issue, envia a imagem e salva a vista, nessa ordem', async () => {
    const { d, ordem } = deps()
    const r = await criarIssueComVista({ deps: d, obraId: 'o1', dados: { titulo: 'T' }, vista: VISTA, imagem: PNG })
    expect(r).toEqual({ id: 'i1', numero: 7, vistaId: VID })
    expect(ordem).toEqual(['issue', 'enviar', 'vista'])
    expect(d.enviarArquivo).toHaveBeenCalledWith('issues', `o1/i1/${VID}.png`, PNG, 'image/png')
    expect(d.salvarVistaIssue).toHaveBeenCalledWith('i1', VID, VISTA, `o1/i1/${VID}.png`)
  })

  it('sem vista, só cria a issue', async () => {
    const { d } = deps()
    expect(await criarIssueComVista({ deps: d, obraId: 'o1', dados: { titulo: 'T' } })).toEqual({ id: 'i1', numero: 7, vistaId: null })
    expect(d.salvarVistaIssue).not.toHaveBeenCalled()
  })

  it('vista sem imagem salva sem caminho', async () => {
    const { d } = deps()
    await criarIssueComVista({ deps: d, obraId: 'o1', dados: { titulo: 'T' }, vista: VISTA })
    expect(d.enviarArquivo).not.toHaveBeenCalled()
    expect(d.salvarVistaIssue).toHaveBeenCalledWith('i1', VID, VISTA, null)
  })

  it('se a imagem falhar, a issue fica criada, a vista não e o erro diz o número', async () => {
    const { d } = deps({ enviarArquivo: vi.fn().mockRejectedValue(new Error('rede')) })
    const e = await criarIssueComVista({ deps: d, obraId: 'o1', dados: { titulo: 'T' }, vista: VISTA, imagem: PNG }).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(ErroImagemVista)
    expect((e as ErroImagemVista).message).toContain('#7')
    expect((e as ErroImagemVista).issue).toEqual({ id: 'i1', numero: 7 })
    expect(d.salvarIssue).toHaveBeenCalledTimes(1)
    expect(d.salvarVistaIssue).not.toHaveBeenCalled()
  })

  it('confere título e imagem antes de salvar qualquer coisa', async () => {
    const { d } = deps()
    await expect(criarIssueComVista({ deps: d, obraId: 'o1', dados: { titulo: ' ' } })).rejects.toThrow(/título/i)
    await expect(
      criarIssueComVista({ deps: d, obraId: 'o1', dados: { titulo: 'T' }, vista: VISTA, imagem: new Blob(['x'], { type: 'image/jpeg' }) }),
    ).rejects.toThrow(/PNG/)
    expect(d.salvarIssue).not.toHaveBeenCalled()
  })
})

describe('adicionarVista', () => {
  it('reaproveita o fluxo numa issue existente', async () => {
    const { d, ordem } = deps()
    expect(await adicionarVista({ deps: d, obraId: 'o1', issue: { id: 'i9' }, vista: VISTA, imagem: PNG })).toEqual({ vistaId: VID })
    expect(ordem).toEqual(['enviar', 'vista'])
    expect(d.salvarVistaIssue).toHaveBeenCalledWith('i9', VID, VISTA, `o1/i9/${VID}.png`)
    expect(d.salvarIssue).not.toHaveBeenCalled()
  })

  it('falha no envio não salva a vista', async () => {
    const { d } = deps({ enviarArquivo: vi.fn().mockRejectedValue(new Error('x')) })
    await expect(adicionarVista({ deps: d, obraId: 'o1', issue: { id: 'i9' }, vista: VISTA, imagem: PNG })).rejects.toBeInstanceOf(ErroImagemVista)
    expect(d.salvarVistaIssue).not.toHaveBeenCalled()
  })
})
