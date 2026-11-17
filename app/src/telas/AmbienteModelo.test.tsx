import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { criarRepositorioFixture } from '../dados/fixture.ts'
import { renderizarApp } from '../test/renderApp.tsx'

// jsdom não tem WebGL: o visualizador real é testado no navegador (e2e).
vi.mock('../modelo/VisualizadorModelo.tsx', () => ({
  default: ({ ambiente }: { ambiente?: unknown }) => (
    <div data-testid="visualizador">ambiente: {ambiente ? 'sim' : 'não'}</div>
  ),
}))

const MODELOS = [{ sigla: 'ARQ', revisao: 'R06', arquivo: 'ARQ.frag', bytes: 1, hash: 'h' }]
const ROTA = '/obras/hto/ambientes/terreo-apto-101/modelo'

describe('AmbienteModelo', () => {
  it('com geometria e modelo, renderiza o visualizador com a prop ambiente', async () => {
    renderizarApp(ROTA, { ...criarRepositorioFixture(), listarModelos: async () => MODELOS })
    expect(await screen.findByTestId('visualizador')).toHaveTextContent('ambiente: sim')
  })

  it('sem geometria, avisa que não há modelo', async () => {
    renderizarApp(ROTA, {
      ...criarRepositorioFixture(),
      listarModelos: async () => MODELOS,
      obterGeometria: async () => null,
    })
    expect(await screen.findByText('Este ambiente não tem modelo 3D disponível.')).toBeInTheDocument()
    expect(screen.queryByTestId('visualizador')).not.toBeInTheDocument()
  })
})
