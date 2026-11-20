import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { RepositorioAdminProvider } from '../../../../../admin/dados/contexto.tsx'
import { criarRepositorioAdminFixture } from '../../../../../admin/dados/fixture.ts'
import CentralObra from './CentralObra.tsx'
import { OBRAS } from './obrasDeTeste.ts'

afterEach(() => localStorage.clear())

function Url() {
  const l = useLocation()
  return <output data-testid="url">{l.pathname + l.search}</output>
}

function renderizar(rota: string) {
  const repo = { ...criarRepositorioAdminFixture(), listarObrasCentral: async () => OBRAS }
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <RepositorioAdminProvider repositorio={repo}>
        <MemoryRouter initialEntries={[rota]}>
          <Routes>
            <Route path="/modelos/:slug" element={<CentralObra />} />
          </Routes>
          <Url />
        </MemoryRouter>
      </RepositorioAdminProvider>
    </QueryClientProvider>,
  )
}

describe('CentralObra', () => {
  it('abre em Itens por padrão e mostra o nome da obra e o canvas', async () => {
    renderizar('/modelos/hto')
    expect(await screen.findByRole('tab', { name: 'Itens', selected: true })).toBeInTheDocument()
    expect(screen.getByText('Disponível na etapa 2')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'HTO' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Todas as obras' })).toHaveAttribute('href', '/modelos')
    expect(screen.getByTestId('canvas-central')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Medir' })).toBeDisabled()
  })

  it('a aba vem da query string e a troca atualiza a URL', async () => {
    const usuario = userEvent.setup()
    renderizar('/modelos/hto?painel=gestao')
    expect(await screen.findByRole('tab', { name: 'Gestão', selected: true })).toBeInTheDocument()
    expect(screen.getByText('Disponível na etapa 5')).toBeInTheDocument()
    await usuario.click(screen.getByRole('tab', { name: 'Issues' }))
    expect(screen.getByTestId('url')).toHaveTextContent('/modelos/hto?painel=issues')
    expect(screen.getByRole('tab', { name: 'Issues', selected: true })).toBeInTheDocument()
    expect(screen.getByText('Disponível na etapa 7')).toBeInTheDocument()
  })

  it('alternar o tema persiste a preferência', async () => {
    const usuario = userEvent.setup()
    renderizar('/modelos/hto')
    const raiz = (await screen.findByTestId('canvas-central')).closest('.central')!
    expect(raiz).toHaveAttribute('data-tema', 'escuro')
    await usuario.click(screen.getByRole('button', { name: /Configurações/ }))
    expect(raiz).toHaveAttribute('data-tema', 'claro')
    expect(localStorage.getItem('central.tema')).toBe('claro')
  })

  it('recolhe e reabre o painel', async () => {
    const usuario = userEvent.setup()
    renderizar('/modelos/hto')
    await usuario.click(await screen.findByRole('button', { name: 'Recolher painel' }))
    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument()
    await usuario.click(screen.getByRole('button', { name: 'Abrir painel' }))
    expect(screen.getByRole('tabpanel')).toBeInTheDocument()
  })

  it('redimensiona pelo teclado dentro dos limites', async () => {
    const usuario = userEvent.setup()
    renderizar('/modelos/hto')
    const borda = await screen.findByRole('separator')
    borda.focus()
    for (let i = 0; i < 40; i++) await usuario.keyboard('{ArrowRight}')
    expect(borda).toHaveAttribute('aria-valuenow', '520')
    for (let i = 0; i < 40; i++) await usuario.keyboard('{ArrowLeft}')
    expect(borda).toHaveAttribute('aria-valuenow', '240')
  })

  it('obra desconhecida', async () => {
    renderizar('/modelos/nada')
    expect(await screen.findByText('Obra não encontrada.')).toBeInTheDocument()
  })
})
