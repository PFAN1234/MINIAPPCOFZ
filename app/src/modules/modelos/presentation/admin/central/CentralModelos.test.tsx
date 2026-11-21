import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { RepositorioAdminProvider } from '../../../../../admin/dados/contexto.tsx'
import { criarRepositorioAdminFixture } from '../../../../../admin/dados/fixture.ts'
import CentralModelos from './CentralModelos.tsx'
import { OBRAS } from './obrasDeTeste.ts'

function renderizar() {
  const repo = { ...criarRepositorioAdminFixture(), listarObrasCentral: async () => OBRAS }
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <RepositorioAdminProvider repositorio={repo}>
        <MemoryRouter>
          <CentralModelos />
        </MemoryRouter>
      </RepositorioAdminProvider>
    </QueryClientProvider>,
  )
}

describe('CentralModelos', () => {
  it('lista as obras com totais e separa as sem arquivos', async () => {
    renderizar()
    const link = await screen.findByRole('link', { name: 'HTO' })
    expect(link).toHaveAttribute('href', '/modelos/hto')
    const card = link.closest('li')!
    expect(within(card).getByText('Disciplinas').nextSibling).toHaveTextContent('1')
    expect(within(card).getByText('Documentos').nextSibling).toHaveTextContent('2')
    expect(within(card).getByText('Issues abertas').nextSibling).toHaveTextContent('3')

    const grupo = screen.getByText(/Sem arquivos/).closest('details')!
    expect(within(grupo).getByText('COFZ')).toBeInTheDocument()
    expect(within(grupo).getByRole('link', { name: 'Enviar primeiro modelo' })).toHaveAttribute('href', '/modelos/cofz?painel=gestao')
  })

  it('busca pelo nome', async () => {
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByRole('link', { name: 'HTO' })
    await usuario.type(screen.getByLabelText('Buscar obra'), 'cof')
    expect(screen.queryByRole('link', { name: 'HTO' })).not.toBeInTheDocument()
    expect(screen.getByText('COFZ')).toBeInTheDocument()
    await usuario.clear(screen.getByLabelText('Buscar obra'))
    await usuario.type(screen.getByLabelText('Buscar obra'), 'zzz')
    expect(screen.getByText('Nenhuma obra encontrada.')).toBeInTheDocument()
  })
})
