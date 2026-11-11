import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { criarRepositorioFixture } from '../dados/fixture.ts'
import type { ModeloFrag } from '../modelo/modelos.ts'
import { renderizarApp } from '../test/renderApp.tsx'

function repoComModelos(modelos: ModeloFrag[] | Error) {
  return {
    ...criarRepositorioFixture(),
    listarModelos: async () => {
      if (modelos instanceof Error) throw modelos
      return modelos
    },
  }
}

// jsdom não tem WebGL: o visualizador real é testado no navegador (e2e).
vi.mock('../modelo/VisualizadorModelo.tsx', () => ({
  default: ({ ativos }: { ativos: ReadonlySet<string> }) => (
    <div data-testid="visualizador">ativos: {[...ativos].join(',')}</div>
  ),
}))

describe('Obra: cartão do modelo e atalhos', () => {
  it('mostra "← Obras", o cartão do modelo federado e os atalhos (gestor)', async () => {
    renderizarApp('/obras/hto')
    expect(await screen.findByRole('link', { name: '← Obras' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: /Visualizar modelo federado/ })).toHaveAttribute(
      'href',
      '/obras/hto/modelo',
    )
    expect(await screen.findByRole('link', { name: 'Pendências 3' })).toHaveAttribute(
      'href',
      '/obras/hto/pendencias',
    )
    expect(await screen.findByRole('link', { name: 'Gestão 3' })).toHaveAttribute('href', '/obras/hto/gestao')
    expect(screen.getByRole('heading', { level: 3, name: 'Ambientes' })).toBeInTheDocument()
  })

  it('equipe não vê o atalho da Gestão', async () => {
    const base = criarRepositorioFixture()
    renderizarApp('/obras/hto', {
      ...base,
      obterObra: async (slug) => ({ ...(await base.obterObra(slug)), papel: 'equipe' }),
    })
    await screen.findByRole('link', { name: 'Pendências 3' })
    expect(screen.queryByRole('link', { name: /Gestão/ })).not.toBeInTheDocument()
  })

  it('o cartão leva à tela do modelo; sem .frag publicado, avisa e deixa os chips desabilitados', async () => {
    const usuario = userEvent.setup()
    renderizarApp('/obras/hto', repoComModelos([]))
    await usuario.click(await screen.findByRole('link', { name: /Visualizar modelo federado/ }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Modelo federado' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '← HTO' })).toHaveAttribute('href', '/obras/hto')
    expect(await screen.findByText('Esta obra ainda não tem modelos 3D publicados.')).toBeInTheDocument()
    const chips = within(screen.getByRole('list', { name: 'Modelos' })).getAllByRole('button')
    expect(chips.map((c) => c.textContent)).toEqual(['ARQ', 'ELT', 'HID', 'ESG', 'DRE', 'PCI', 'VES', 'TLD', 'ANT'])
    for (const chip of chips) expect(chip).toBeDisabled()
  })

  it('com .frag publicado, abre o visualizador e o chip liga e desliga a disciplina', async () => {
    const usuario = userEvent.setup()
    renderizarApp(
      '/obras/hto/modelo',
      repoComModelos([{ sigla: 'ARQ', revisao: 'R06', arquivo: 'ARQ.frag', bytes: 1, hash: 'abc' }]),
    )
    expect(await screen.findByTestId('visualizador')).toHaveTextContent('ativos: ARQ')
    const arq = screen.getByRole('button', { name: 'ARQ' })
    expect(arq).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'ELT' })).toBeDisabled()
    await usuario.click(arq)
    expect(arq).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('visualizador')).toHaveTextContent('ativos:')
    expect(screen.getByTestId('visualizador')).not.toHaveTextContent('ARQ')
  })

  it('erro ao listar os modelos mostra mensagem', async () => {
    renderizarApp('/obras/hto/modelo', repoComModelos(new Error('x')))
    expect(await screen.findByText('Não foi possível carregar os modelos desta obra.')).toBeInTheDocument()
  })
})
