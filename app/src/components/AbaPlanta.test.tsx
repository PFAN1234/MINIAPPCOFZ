import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RepositorioProvider } from '../dados/contexto.tsx'
import { criarRepositorioFixture } from '../dados/fixture.ts'
import { AbaPlanta } from './AbaPlanta.tsx'

const repo = criarRepositorioFixture()

function montar(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <RepositorioProvider repositorio={repo}>{ui}</RepositorioProvider>
    </QueryClientProvider>,
  )
}

describe('AbaPlanta', () => {
  it('mostra o aviso com a revisão e a busca chama onFocoChange', async () => {
    const obra = await repo.obterObra('hto')
    const onFocoChange = vi.fn()
    montar(
      <AbaPlanta
        obra={obra}
        pavimentoCodigo="terreo"
        focoCodigo={null}
        onFocoChange={onFocoChange}
        onSelecionarAmbiente={() => {}}
      />,
    )
    expect(screen.getByText('Planta de arquitetura R05 · posição indicativa')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Buscar ambiente na planta'), { target: { value: '101' } })
    fireEvent.click(within(screen.getByRole('list')).getByRole('button', { name: 'Apto. 101' }))
    expect(onFocoChange).toHaveBeenCalledWith('terreo-apto-101')
  })

  it('ambiente inativo fica fora dos pinos e da busca', async () => {
    const obra = await repo.obterObra('hto')
    const comInativo = {
      ...obra,
      ambientes: obra.ambientes.map((a) =>
        a.codigo === 'terreo-apto-101' ? { ...a, ativo: false } : a,
      ),
    }
    montar(
      <AbaPlanta
        obra={comInativo}
        pavimentoCodigo="terreo"
        focoCodigo={null}
        onFocoChange={() => {}}
        onSelecionarAmbiente={() => {}}
      />,
    )
    expect(await screen.findByRole('button', { name: 'Apto. 102' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Apto. 101' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Buscar ambiente na planta'), { target: { value: 'apto. 101' } })
    expect(screen.getByText('Nenhum ambiente encontrado')).toBeInTheDocument()
  })

  it('pavimento sem planta mostra estado vazio', async () => {
    const obra = await repo.obterObra('hto')
    const semPlanta = {
      ...obra,
      pavimentos: obra.pavimentos.map((p) => ({ ...p, planta: null })),
    }
    montar(
      <AbaPlanta
        obra={semPlanta}
        pavimentoCodigo="terreo"
        focoCodigo={null}
        onFocoChange={() => {}}
        onSelecionarAmbiente={() => {}}
      />,
    )
    expect(screen.getByText('Planta ainda não publicada')).toBeInTheDocument()
  })
})
