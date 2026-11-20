import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App.tsx'
import { RepositorioProvider } from '../dados/contexto.tsx'
import { criarRepositorioFixture } from '../dados/fixture.ts'
import type { Repositorio } from '../dados/repositorio.ts'

vi.mock('@modules/ra/presentation/miniapp/TelaRA.tsx', () => ({
  default: () => {
    throw new Error('Failed to fetch dynamically imported module')
  },
}))

describe('NovoRegistro: falha ao carregar TelaRA offline', () => {
  afterEach(() => vi.restoreAllMocks())

  it('exibe erro recuperável sem derrubar o formulário do Novo registro', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const usuario = userEvent.setup()
    const base = criarRepositorioFixture()
    const repo: Repositorio = {
      ...base,
      listarModelos: async () => [{ sigla: 'ARQ', revisao: 'R06', arquivo: 'ARQ.frag', bytes: 1, hash: 'h' }],
    }
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <RepositorioProvider repositorio={repo}>
          <MemoryRouter initialEntries={['/obras/hto/ambientes/terreo-apto-101/novo?ra=1']}>
            <App />
          </MemoryRouter>
        </RepositorioProvider>
      </QueryClientProvider>,
    )

    const dialogo = await screen.findByRole('alertdialog', { name: 'Comparar com o modelo' })
    expect(within(dialogo).getByText(/Não foi possível abrir a realidade aumentada/i)).toBeInTheDocument()
    await usuario.click(within(dialogo).getByRole('button', { name: 'Voltar' }))
    expect(screen.queryByRole('alertdialog', { name: 'Comparar com o modelo' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Novo registro' })).toBeInTheDocument()
  })
})
