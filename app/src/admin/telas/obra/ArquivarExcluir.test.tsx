import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import AdminApp from '../../AdminApp.tsx'
import { RepositorioAdminProvider } from '../../dados/contexto.tsx'
import { criarRepositorioAdminFixture } from '../../dados/fixture.ts'
import type { RepositorioAdmin } from '../../dados/repositorio.ts'
import { criarEntrada } from '../../entrada.ts'

function renderizar(rota: string, repo: RepositorioAdmin = criarRepositorioAdminFixture()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <RepositorioAdminProvider repositorio={repo}>
        <MemoryRouter initialEntries={[rota]}>
          <AdminApp entrada={criarEntrada(null)} />
        </MemoryRouter>
      </RepositorioAdminProvider>
    </QueryClientProvider>,
  )
  return repo
}

describe('arquivar e excluir obra (fixture)', () => {
  it('arquivar pede confirmação, mostra o aviso e vai para "Arquivadas"; desarquivar volta', async () => {
    const user = userEvent.setup()
    const repo = renderizar('/obras/cofz')
    await user.click(await screen.findByRole('button', { name: 'Arquivar obra' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar: arquivar COFZ' }))
    expect(await screen.findByText(/Obra arquivada em/)).toBeInTheDocument()
    expect((await repo.obterObra('cofz')).obra.arquivada_em).not.toBeNull()

    await user.click(screen.getByRole('link', { name: '← Etapas' }))
    const arquivadas = await screen.findByRole('table', { name: 'Obras arquivadas' })
    expect(within(arquivadas).getByRole('link', { name: 'COFZ' })).toBeInTheDocument()
    expect(within(arquivadas).getByRole('link', { name: '2ª ETAPA' })).toBeInTheDocument()
    expect(within(arquivadas).getByText('Arquivada')).toBeInTheDocument()
    expect(within(screen.getByRole('table', { name: 'Obras de 2ª ETAPA' })).queryByText('COFZ')).not.toBeInTheDocument()

    await user.click(within(arquivadas).getByRole('link', { name: 'COFZ' }))
    await user.click(await screen.findByRole('button', { name: 'Desarquivar obra' }))
    expect(await screen.findByRole('button', { name: 'Arquivar obra' })).toBeInTheDocument()
    expect(screen.queryByText(/Obra arquivada em/)).not.toBeInTheDocument()
  })

  it('excluir mostra o que será apagado, exige o nome exato e volta à lista com o aviso', async () => {
    const user = userEvent.setup()
    const repo = renderizar('/obras/hto')
    const obra = (await repo.obterObra('hto')).obra
    await repo.enviarArquivo('originais', `${obra.id}/R05/terreo/${'a'.repeat(64)}.pdf`, new Blob(['%PDF']), 'application/pdf')

    await user.click(await screen.findByRole('button', { name: 'Excluir obra…' }))
    const resumo = await screen.findByRole('list', { name: 'O que será apagado' })
    expect(resumo).toHaveTextContent('87 ambientes')
    expect(resumo).toHaveTextContent('1 arquivo no Storage')
    const botao = screen.getByRole('button', { name: 'Excluir HTO definitivamente' })
    const campo = screen.getByLabelText(/digite o nome da obra/)
    await user.type(campo, 'hto')
    expect(botao).toBeDisabled()
    await user.clear(campo)
    await user.type(campo, 'HTO')
    await user.click(botao)

    expect(await screen.findByText('Obra HTO excluída, com todos os dados e arquivos.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'HTO' })).not.toBeInTheDocument()
    const excluidas = await screen.findByRole('region', { name: 'Obras excluídas' })
    expect(within(excluidas).getByText(/1 removido/)).toBeInTheDocument()
    await expect(repo.obterObra('hto')).rejects.toThrow('Obra não encontrada')
  })

  it('a confirmação errada é recusada também pelo repositório', async () => {
    const repo = criarRepositorioAdminFixture()
    await expect(repo.excluirObra('cofz', 'cofz')).rejects.toThrow('digite exatamente o nome da obra: COFZ')
    expect((await repo.listarObras()).map((o) => o.slug)).toContain('cofz')
  })
})
