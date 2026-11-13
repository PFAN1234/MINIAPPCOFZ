import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import AdminApp from '../AdminApp.tsx'
import { RepositorioAdminProvider } from '../dados/contexto.tsx'
import { criarRepositorioAdminFixture } from '../dados/fixture.ts'
import type { RepositorioAdmin } from '../dados/repositorio.ts'
import { criarEntrada } from '../entrada.ts'

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

describe('pessoas (fixture)', () => {
  it('o item "Pessoas" fica entre Etapas e Organização e abre a tabela', async () => {
    const user = userEvent.setup()
    renderizar('/')
    const nav = await screen.findByRole('navigation', { name: 'Principal' })
    expect(within(nav).getAllByRole('link').map((l) => l.textContent)).toEqual(['Etapas', 'Relatórios', 'Pessoas', 'Organização', 'Admins'])
    await user.click(within(nav).getByRole('link', { name: 'Pessoas' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Pessoas' })).toBeInTheDocument()
    expect(await screen.findByRole('table', { name: 'Pessoas' })).toBeInTheDocument()
  })

  it('mostra nome de exibição, nome do Telegram, @username, obras e papéis e o selo admin', async () => {
    renderizar('/pessoas')
    const tabela = await screen.findByRole('table', { name: 'Pessoas' })
    const patricio = within(tabela).getByRole('row', { name: /Patrício Ferreira/ })
    expect(within(patricio).getByLabelText('Nome de exibição de Patrício Ferreira')).toHaveValue('CP PATRICIO')
    expect(within(patricio).getByText('admin')).toBeInTheDocument()
    expect(patricio).toHaveTextContent('HTO')
    expect(patricio).toHaveTextContent('(2ª ETAPA) · gestor')
    const maria = within(tabela).getByRole('row', { name: /Maria Souza/ })
    expect(maria).toHaveTextContent('@maria')
    expect(within(maria).queryByText('admin')).not.toBeInTheDocument()
    expect(within(maria).getByText('usa o nome do Telegram')).toBeInTheDocument()
    expect(within(maria).getByLabelText('Nome de exibição de Maria Souza')).toHaveValue('')
    // ordenada por nome de exibição, ou o do Telegram quando não há
    const nomes = within(tabela)
      .getAllByRole('row')
      .slice(1)
      .map((l) => (within(l).getAllByRole('textbox')[0] as HTMLInputElement).getAttribute('aria-label'))
    expect(nomes).toEqual([
      'Nome de exibição de Patrício Ferreira',
      'Nome de exibição de Eduardo Lima',
      'Nome de exibição de Maria Souza',
      'Nome de exibição de Você (teste)',
    ])
  })

  it('digita em maiúsculas, salva normalizado, mantém a mensagem e permite remover o nome', async () => {
    const user = userEvent.setup()
    const repo = criarRepositorioAdminFixture()
    const definir = vi.spyOn(repo, 'definirNomeExibicao')
    renderizar('/pessoas', repo)
    const campo = await screen.findByLabelText('Nome de exibição de Eduardo Lima')
    const salvar = screen.getByRole('button', { name: 'Salvar nome de Eduardo Lima' })
    expect(salvar).toBeDisabled()
    await user.type(campo, 'cb  eduardo')
    expect(campo).toHaveValue('CB  EDUARDO')
    await user.click(salvar)
    const linha = screen.getByRole('row', { name: /Eduardo Lima/ })
    expect(await within(linha).findByText('Salvo.')).toBeInTheDocument()
    expect(definir).toHaveBeenCalledWith('usuario-eduardo', 'CB  EDUARDO')
    expect(screen.getByLabelText('Nome de exibição de Eduardo Lima')).toHaveValue('CB EDUARDO')
    expect(screen.getByRole('button', { name: 'Salvar nome de Eduardo Lima' })).toBeDisabled()

    await user.clear(screen.getByLabelText('Nome de exibição de Eduardo Lima'))
    await user.click(screen.getByRole('button', { name: 'Salvar nome de Eduardo Lima' }))
    expect(await screen.findByText('Nome de exibição removido.')).toBeInTheDocument()
    expect(definir).toHaveBeenLastCalledWith('usuario-eduardo', null)
  })

  it('mostra o erro do servidor quando o nome é longo demais', async () => {
    const user = userEvent.setup()
    const repo = criarRepositorioAdminFixture()
    vi.spyOn(repo, 'definirNomeExibicao').mockRejectedValue(new Error('O nome de exibição pode ter até 60 caracteres'))
    renderizar('/pessoas', repo)
    await user.type(await screen.findByLabelText('Nome de exibição de Maria Souza'), 'MARIA')
    await user.click(screen.getByRole('button', { name: 'Salvar nome de Maria Souza' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('até 60 caracteres')
  })

  it('a busca acha por nome de exibição, nome do Telegram (sem acento) ou @username', async () => {
    const user = userEvent.setup()
    renderizar('/pessoas')
    const busca = await screen.findByLabelText('Buscar pessoa')
    await user.type(busca, 'patricio')
    expect(screen.getAllByRole('row')).toHaveLength(2)
    expect(screen.getByLabelText('Nome de exibição de Patrício Ferreira')).toBeInTheDocument()
    await user.clear(busca)
    await user.type(busca, 'cp pat')
    expect(screen.getAllByRole('row')).toHaveLength(2)
    await user.clear(busca)
    await user.type(busca, '@maria')
    expect(screen.getByLabelText('Nome de exibição de Maria Souza')).toBeInTheDocument()
    expect(screen.queryByLabelText('Nome de exibição de Eduardo Lima')).not.toBeInTheDocument()
    await user.clear(busca)
    await user.type(busca, 'zzz')
    expect(screen.getByText('Nenhuma pessoa encontrada.')).toBeInTheDocument()
  })

  it('o novo nome aparece nos responsáveis da etapa', async () => {
    const user = userEvent.setup()
    const repo = criarRepositorioAdminFixture()
    renderizar('/pessoas', repo)
    const campo = await screen.findByLabelText('Nome de exibição de Patrício Ferreira')
    await user.clear(campo)
    await user.type(campo, 'cap patricio')
    await user.click(screen.getByRole('button', { name: 'Salvar nome de Patrício Ferreira' }))
    expect(await screen.findByText('Salvo.')).toBeInTheDocument()
    expect((await repo.obterEtapa('2a-etapa')).responsaveis[0].nome_exibicao).toBe('CAP PATRICIO')
  })
})
