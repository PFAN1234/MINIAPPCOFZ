import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { RepositorioProvider } from '../dados/contexto.tsx'
import { criarRepositorioFixture } from '../dados/fixture.ts'
import type { RegistroResumo } from '../dados/tipos.ts'
import { ListaRegistros } from './ListaRegistros.tsx'

async function carregar(): Promise<RegistroResumo[]> {
  return criarRepositorioFixture().listarRegistros({})
}

function renderizar(registros: RegistroResumo[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <RepositorioProvider repositorio={criarRepositorioFixture()}>
        <MemoryRouter>
          <ListaRegistros registros={registros} vazio="Nada" />
        </MemoryRouter>
      </RepositorioProvider>
    </QueryClientProvider>,
  )
}

describe('ListaRegistros', () => {
  it('mostra miniatura com "+N", estado de publicação e abre o visualizador', async () => {
    const usuario = userEvent.setup()
    const todos = await carregar()
    const base = todos.find((r) => r.fotos.length >= 2)
    expect(base, 'a fixture deve ter um registro com 2+ fotos').toBeDefined()
    const registro: RegistroResumo = { ...base!, publicacao: 'incerto' }
    renderizar([registro])

    const item = screen.getByRole('listitem')
    expect(within(item).getByText(`+${registro.fotos.length - 1}`)).toBeInTheDocument()
    expect(within(item).getByText('Publicação com problema')).toBeInTheDocument()

    await usuario.click(within(item).getByRole('button', { name: /^Abrir \d+ fotos do registro$/ }))
    const dialogo = await screen.findByRole('dialog')
    expect(within(dialogo).getByText(`Foto 1 de ${registro.fotos.length}`)).toBeInTheDocument()
    await usuario.click(within(dialogo).getByRole('button', { name: 'Próxima foto' }))
    expect(within(dialogo).getByText(`Foto 2 de ${registro.fotos.length}`)).toBeInTheDocument()
    await usuario.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('textos de publicação por estado', async () => {
    const [base] = await carregar()
    renderizar(
      (['pendente', 'enviando', 'publicado', 'falhou'] as const).map((p, i) => ({
        ...base,
        id: `r${i}`,
        publicacao: p,
      })),
    )
    expect(screen.getAllByText('Salvo no servidor · aguardando publicação')).toHaveLength(2)
    expect(screen.getByText('Publicado no tópico')).toBeInTheDocument()
    expect(screen.getByText('Publicação com problema')).toBeInTheDocument()
  })
})
