import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { RepositorioProvider } from '../dados/contexto.tsx'
import { criarRepositorioFixture } from '../dados/fixture.ts'
import { FILTRO_PENDENCIAS_ABERTAS } from '../dados/hooks.ts'
import { BarraInferior } from './BarraInferior.tsx'

function renderizar(rota: string, qc = new QueryClient(), repo = criarRepositorioFixture()) {
  return render(
    <QueryClientProvider client={qc}>
      <RepositorioProvider repositorio={repo}>
        <MemoryRouter initialEntries={[rota]}>
          <BarraInferior />
        </MemoryRouter>
      </RepositorioProvider>
    </QueryClientProvider>,
  )
}

describe('BarraInferior', () => {
  it('marca o item da tela atual com aria-current="page"', () => {
    renderizar('/registros')
    expect(screen.getByRole('link', { name: 'Registros' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Início' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('link', { name: /^Pendências/ })).not.toHaveAttribute('aria-current')
  })

  it('o Início só fica ativo na raiz', () => {
    renderizar('/obras/hto')
    for (const link of screen.getAllByRole('link')) expect(link).not.toHaveAttribute('aria-current')
  })

  it('sem as pendências do Início no aparelho, fica sem número e não busca nada', () => {
    const repo = criarRepositorioFixture()
    const listar = vi.spyOn(repo, 'listarRegistros')
    renderizar('/', new QueryClient(), repo)
    expect(screen.getByRole('link', { name: 'Pendências' })).toBeInTheDocument()
    expect(listar).not.toHaveBeenCalled()
  })

  it('com as pendências do Início já carregadas, mostra a contagem no rótulo', async () => {
    const repo = criarRepositorioFixture()
    const qc = new QueryClient()
    qc.setQueryData(['registros', FILTRO_PENDENCIAS_ABERTAS], await repo.listarRegistros(FILTRO_PENDENCIAS_ABERTAS))
    renderizar('/pendencias', qc, repo)
    const item = screen.getByRole('link', { name: 'Pendências · 3 abertas' })
    expect(item).toHaveTextContent('Pendências · 3')
    expect(item).toHaveAttribute('aria-current', 'page')
  })
})
