import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { describe, expect, it } from 'vitest'
import { RepositorioProvider } from '../dados/contexto.tsx'
import { criarRepositorioFixture } from '../dados/fixture.ts'
import type { Repositorio } from '../dados/repositorio.ts'
import { OfflineProvider, useFila } from './contexto.tsx'

function Sonda() {
  const { estado } = useFila()
  return <p>fila {estado.carregada ? 'carregada' : 'carregando'}</p>
}

function renderizar(repo: Repositorio, estrito = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const arvore = (
    <QueryClientProvider client={qc}>
      <RepositorioProvider repositorio={repo}>
        <OfflineProvider>
          <Sonda />
        </OfflineProvider>
      </RepositorioProvider>
    </QueryClientProvider>
  )
  return render(estrito ? <StrictMode>{arvore}</StrictMode> : arvore)
}

describe('OfflineProvider', () => {
  it('prepara a fila (também em StrictMode) e desmonta sem erro', async () => {
    const { unmount } = renderizar(criarRepositorioFixture())
    expect(screen.getByText('Carregando…')).toBeInTheDocument()
    expect(await screen.findByText('fila carregada')).toBeInTheDocument()
    unmount()
  })

  it('desmontar antes de terminar a preparação não quebra', () => {
    const { unmount } = renderizar(criarRepositorioFixture())
    unmount()
  })

  it('sem usuário mostra erro', async () => {
    const repo: Repositorio = { ...criarRepositorioFixture(), idUsuario: async () => null }
    renderizar(repo, false)
    expect(await screen.findByRole('alert')).toHaveTextContent('identificar o usuário')
  })
})
