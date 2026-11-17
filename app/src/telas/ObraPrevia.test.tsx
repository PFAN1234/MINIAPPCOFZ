import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { criarRepositorioFixture } from '../dados/fixture.ts'
import type { ModeloFrag } from '../modelo/modelos.ts'
import { renderizarApp } from '../test/renderApp.tsx'

const ARQ: ModeloFrag = { sigla: 'ARQ', revisao: 'R06', arquivo: 'ARQ.frag', bytes: 1, hash: 'abc' }
const ELT: ModeloFrag = { sigla: 'ELT', revisao: 'R01', arquivo: 'ELT.frag', bytes: 1, hash: 'def' }

function repoComModelos(modelos: ModeloFrag[] | Error) {
  return {
    ...criarRepositorioFixture(),
    listarModelos: async () => {
      if (modelos instanceof Error) throw modelos
      return modelos
    },
  }
}

vi.mock('../modelo/VisualizadorModelo.tsx', () => ({
  default: ({
    modelos,
    ativos,
    previa,
  }: {
    modelos: ModeloFrag[]
    ativos: ReadonlySet<string>
    previa?: boolean
  }) => (
    <div data-testid="visualizador" data-previa={String(!!previa)}>
      {modelos.map((m) => m.sigla).join(',')}|{[...ativos].join(',')}
    </div>
  ),
}))

describe('Obra: topo e ordem da tela', () => {
  it('os pavimentos e o atalho Pendências ficam na base do topo, no cabeçalho do nome da obra', async () => {
    renderizarApp('/obras/hto')
    const titulo = await screen.findByRole('heading', { level: 1, name: 'HTO' })
    const pendencias = await screen.findByRole('link', { name: 'Pendências 3' })
    const pavimentos = screen.getByRole('tablist', { name: 'Pavimento' })
    expect(pendencias.parentElement).toHaveClass('topo-base')
    expect(pavimentos.parentElement).toBe(pendencias.parentElement)
    expect(titulo.closest('header')).toContainElement(pendencias)
  })

  it('ordem: topo, prévia, Ambientes e, por último, Observações do dia', async () => {
    renderizarApp('/obras/hto', repoComModelos([ARQ]))
    const previa = await screen.findByRole('link', { name: 'Abrir modelo federado' })
    const ambientes = screen.getByRole('heading', { level: 3, name: 'Ambientes' })
    const observacoes = await screen.findByText(/Observações do dia/)
    const antes = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(antes(previa, ambientes)).toBe(true)
    expect(antes(ambientes, observacoes)).toBe(true)
    const secao = ambientes.parentElement as HTMLElement
    expect(secao.lastElementChild).toContainElement(observacoes)
  })
})

describe('Obra: prévia do modelo', () => {
  it('com ARQ, mostra o quadro 3D só com a ARQ, em modo prévia, e leva ao modelo', async () => {
    renderizarApp('/obras/hto', repoComModelos([ARQ, ELT]))
    const link = await screen.findByRole('link', { name: 'Abrir modelo federado' })
    expect(link).toHaveAttribute('href', '/obras/hto/modelo')
    expect(link).toHaveTextContent('Modelo federado ›')
    const v = await screen.findByTestId('visualizador')
    expect(v).toHaveTextContent('ARQ|ARQ')
    expect(v).not.toHaveTextContent('ELT')
    expect(v).toHaveAttribute('data-previa', 'true')
    expect(screen.queryByRole('link', { name: /Visualizar modelo federado/ })).not.toBeInTheDocument()
  })

  it.each([
    ['sem modelo ARQ', [ELT]],
    ['sem nenhum modelo', []],
    ['com erro', new Error('x')],
  ])('%s: cai no cartão antigo', async (_nome, modelos) => {
    renderizarApp('/obras/hto', repoComModelos(modelos as ModeloFrag[] | Error))
    expect(await screen.findByRole('link', { name: /Visualizar modelo federado/ })).toHaveAttribute(
      'href',
      '/obras/hto/modelo',
    )
    expect(screen.queryByTestId('visualizador')).not.toBeInTheDocument()
  })
})
