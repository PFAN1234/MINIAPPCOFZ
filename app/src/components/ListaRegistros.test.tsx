import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { RepositorioProvider } from '../dados/contexto.tsx'
import { criarRepositorioFixture } from '../dados/fixture.ts'
import type { RegistroResumo } from '../dados/tipos.ts'
import type { ItemFila } from '../offline/fila.ts'
import { OfflineProvider } from '../offline/contexto.tsx'
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

  it('mostra o selo RA tanto em registro do servidor quanto em registro na fila local', async () => {
    const [base] = await carregar()
    const servidor: RegistroResumo = {
      ...base,
      id: 'srv-ra',
      fotos: [{ ...base.fotos[0], origem: 'ra_modelo' }],
    }
    const local: ItemFila = {
      estado: 'aguardando',
      progresso: null,
      registro: {
        id: 'loc-ra',
        usuarioId: 'u1',
        tipo: 'servico',
        legenda: 'Conferência local',
        capturadoEm: '2026-11-17T10:00:00.000Z',
        criadoEm: '2026-11-17T10:00:00.000Z',
        obra: { id: 'o1', slug: 'hto', nome: 'HTO' },
        ambiente: { id: 'a1', codigo: 'terreo-apto-101', nome: 'Apto. 101' },
        fotos: [
          { id: 'f1', largura: 1200, altura: 900, bytes: 100, origem: 'ra_limpa' },
          { id: 'f2', largura: 1200, altura: 900, bytes: 100, origem: 'ra_modelo' },
        ],
        erro: null,
      },
    }
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <RepositorioProvider repositorio={criarRepositorioFixture()}>
          <OfflineProvider>
            <MemoryRouter>
              <ListaRegistros registros={[servidor]} locais={[local]} vazio="Nada" />
            </MemoryRouter>
          </OfflineProvider>
        </RepositorioProvider>
      </QueryClientProvider>,
    )
    expect(await screen.findAllByText('RA')).toHaveLength(2)
  })
})
