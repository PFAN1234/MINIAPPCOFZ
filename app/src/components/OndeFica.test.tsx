import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RepositorioProvider } from '../dados/contexto.tsx'
import { criarRepositorioFixture } from '../dados/fixture.ts'
import { OndeFica } from './OndeFica.tsx'

const repo = criarRepositorioFixture()

function montar(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <RepositorioProvider repositorio={repo}>{ui}</RepositorioProvider>
    </QueryClientProvider>,
  )
}

describe('OndeFica', () => {
  it('abre a planta ao tocar no cartão', async () => {
    const detalhe = await repo.obterAmbiente('hto', 'terreo-apto-101')
    const onAbrirPlanta = vi.fn()
    montar(<OndeFica detalhe={detalhe} onAbrirPlanta={onAbrirPlanta} />)
    expect(screen.getByText('Onde fica')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button'))
    expect(onAbrirPlanta).toHaveBeenCalledTimes(1)
  })

  it('não renderiza sem detalhe', async () => {
    const detalhe = await repo.obterAmbiente('hto', 'terreo-apto-101')
    const { container } = montar(<OndeFica detalhe={{ ...detalhe, detalhe: null }} onAbrirPlanta={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })
})
