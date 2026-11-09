import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import App from './App.tsx'
import { RepositorioProvider } from './dados/contexto.tsx'
import { criarRepositorioFixture } from './dados/fixture.ts'
import type { Repositorio } from './dados/repositorio.ts'
import { recursos } from './recursos.ts'

function renderizar(rota = '/', repositorio: Repositorio = criarRepositorioFixture()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <RepositorioProvider repositorio={repositorio}>
        <MemoryRouter initialEntries={[rota]}>
          <App />
        </MemoryRouter>
      </RepositorioProvider>
    </QueryClientProvider>,
  )
}

describe('navegação com a fixture', () => {
  it('Obras → HTO → Apto. 101', async () => {
    const usuario = userEvent.setup()
    renderizar()
    expect(await screen.findByRole('heading', { level: 2, name: 'Obras' })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: /Residencial Aurora/ })).toBeInTheDocument()

    await usuario.click(await screen.findByRole('link', { name: /^HTO$/ }))
    expect(await screen.findByRole('heading', { level: 2, name: 'HTO' })).toBeInTheDocument()

    await usuario.click(await screen.findByRole('link', { name: /Apto\. 101/ }))
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Apto. 101' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Térreo/)).toBeInTheDocument()
  })

  it('a barra inferior leva às Pendências abertas', async () => {
    const usuario = userEvent.setup()
    renderizar()
    await usuario.click(await screen.findByRole('link', { name: 'Pendências' }))
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Pendências abertas' }),
    ).toBeInTheDocument()
    expect(await screen.findAllByRole('link', { name: /Pendência aberta/ })).toHaveLength(3)
  })

  it('mostra erro com "Tentar de novo"', async () => {
    const quebrado: Repositorio = {
      ...criarRepositorioFixture(),
      listarObras: () => Promise.reject(new Error('falhou')),
    }
    renderizar('/', quebrado)
    expect(await screen.findByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument()
  })
})

describe('sessão e recursos', () => {
  it('sem sessão no modo Supabase pede para abrir pelo Telegram', async () => {
    renderizar('/', { ...criarRepositorioFixture(), temSessao: async () => false })
    expect(
      await screen.findByText('Abra o Diário da obra pelo Telegram'),
    ).toBeInTheDocument()
  })

  it('flags de fases futuras começam desligadas', () => {
    expect(recursos.modeloFederado).toBe(false)
    expect(recursos.novoRegistro).toBe(false)
  })
})
