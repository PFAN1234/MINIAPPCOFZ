import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErroEnvio } from '../dados/erros.ts'
import { criarRepositorioFixture } from '../dados/fixture.ts'
import { renderizarApp } from '../test/renderApp.tsx'

afterEach(() => vi.restoreAllMocks())

const grupo = (nome: string, obra: string) =>
  screen.findByRole('group', { name: `Acesso de ${nome} em ${obra}` })

describe('Acessos da equipe', () => {
  it('renderiza a matriz da fixture, com pedido e admin', async () => {
    renderizarApp('/acessos')
    expect(await screen.findByRole('heading', { level: 1, name: 'Acessos da equipe' })).toBeInTheDocument()
    expect(
      screen.getByText('Marque o acesso de cada pessoa às obras. A lista mostra quem já abriu o app ou falou no grupo.'),
    ).toBeInTheDocument()
    const maria = await grupo('Maria Souza', 'HTO')
    expect(within(maria).getByRole('button', { name: 'Sem acesso' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Pediu acesso')).toBeInTheDocument()
    expect(screen.getByText('pediu')).toBeInTheDocument()
    expect(screen.getByText('Admin do grupo')).toBeInTheDocument()
    const marcos = await grupo('Marcos Teixeira', 'HTO')
    expect(within(marcos).getByRole('button', { name: 'Equipe' })).toHaveAttribute('aria-pressed', 'true')
    // Poucas pessoas: sem campo de busca.
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  })

  it('trocar para Equipe salva e atualiza o botão (e some o pedido)', async () => {
    const usuario = userEvent.setup()
    const base = criarRepositorioFixture()
    const definirAcesso = vi.spyOn(base, 'definirAcesso')
    renderizarApp('/acessos', base)
    const maria = await grupo('Maria Souza', 'HTO')
    await usuario.click(within(maria).getByRole('button', { name: 'Equipe' }))
    expect(definirAcesso).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'equipe')
    await vi.waitFor(async () => {
      const g = await grupo('Maria Souza', 'HTO')
      expect(within(g).getByRole('button', { name: 'Equipe' })).toHaveAttribute('aria-pressed', 'true')
    })
    await vi.waitFor(() => expect(screen.queryByText('Pediu acesso')).not.toBeInTheDocument())
  })

  it('erro volta ao valor anterior e mostra a mensagem', async () => {
    const usuario = userEvent.setup()
    const base = criarRepositorioFixture()
    renderizarApp('/acessos', {
      ...base,
      definirAcesso: async () => {
        throw new ErroEnvio('validacao', 'A obra precisa de pelo menos um gestor.')
      },
    })
    const marcos = await grupo('Marcos Teixeira', 'HTO')
    await usuario.click(within(marcos).getByRole('button', { name: 'Gestor' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('A obra precisa de pelo menos um gestor.')
    const depois = await grupo('Marcos Teixeira', 'HTO')
    expect(within(depois).getByRole('button', { name: 'Equipe' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('admin do grupo fica fixo em Gestor, desabilitado', async () => {
    renderizarApp('/acessos')
    const g = await grupo('Ana Prado', 'Residencial Aurora')
    expect(within(g).getByRole('button', { name: 'Gestor' })).toHaveAttribute('aria-pressed', 'true')
    for (const b of within(g).getAllByRole('button')) expect(b).toBeDisabled()
    expect(screen.getByText('Administradores do grupo são gestores de todas as obras.')).toBeInTheDocument()
  })

  it('na própria linha pede confirmação antes de salvar', async () => {
    const usuario = userEvent.setup()
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    const base = criarRepositorioFixture()
    const definirAcesso = vi.spyOn(base, 'definirAcesso')
    renderizarApp('/acessos', base)
    const eu = await grupo('Você (teste)', 'Residencial Aurora')
    await usuario.click(within(eu).getByRole('button', { name: 'Equipe' }))
    expect(confirmar).toHaveBeenCalledWith('Alterar o seu próprio acesso?')
    expect(definirAcesso).not.toHaveBeenCalled()
    await usuario.click(within(eu).getByRole('button', { name: 'Equipe' }))
    expect(definirAcesso).toHaveBeenCalledTimes(1)
  })

  it('quem não é gestor vê a mensagem de restrição', async () => {
    const base = criarRepositorioFixture()
    renderizarApp('/acessos', {
      ...base,
      matrizAcessos: async () => {
        throw new ErroEnvio('permissao', 'Só gestores veem a lista de acessos.')
      },
    })
    expect(await screen.findByText('Só gestores veem a lista de acessos.')).toBeInTheDocument()
  })

  it('lista vazia e busca com mais de 6 pessoas', async () => {
    const base = criarRepositorioFixture()
    const { unmount } = renderizarApp('/acessos', {
      ...base,
      matrizAcessos: async () => ({ obras: [], pessoas: [] }),
    })
    expect(
      await screen.findByText(
        'Ninguém do grupo apareceu ainda. As pessoas aparecem aqui depois de abrir o app ou mandar uma mensagem no grupo.',
      ),
    ).toBeInTheDocument()
    unmount()

    const pessoas = Array.from({ length: 7 }, (_, i) => ({
      id: `p${i}`,
      nome: `Pessoa ${i}`,
      username: i === 3 ? 'zeca' : null,
      admin: false,
      vistoEm: null,
      acessos: {},
      pedidos: [],
    }))
    const usuario = userEvent.setup()
    renderizarApp('/acessos', { ...base, matrizAcessos: async () => ({ obras: [], pessoas }) })
    await usuario.type(await screen.findByRole('searchbox'), 'zeca')
    expect(screen.getByText('Pessoa 3')).toBeInTheDocument()
    expect(screen.queryByText('Pessoa 2')).not.toBeInTheDocument()
  })

  it('o link da tela inicial aparece só para gestor', async () => {
    const base = criarRepositorioFixture()
    const { unmount } = renderizarApp('/', base)
    expect(await screen.findByRole('link', { name: 'Acessos da equipe' })).toHaveAttribute('href', '/acessos')
    unmount()
    renderizarApp('/', {
      ...base,
      resumoObras: async () => (await base.resumoObras()).map((r) => ({ ...r, papel: 'equipe' as const })),
    })
    await screen.findByText('HTO')
    expect(screen.queryByRole('link', { name: 'Acessos da equipe' })).not.toBeInTheDocument()
  })

  it('a Gestão e os pedidos têm o link para a lista', async () => {
    const { unmount } = renderizarApp('/obras/hto/gestao')
    expect(await screen.findByRole('link', { name: 'Lista de acessos da equipe' })).toHaveAttribute('href', '/acessos')
    unmount()
    renderizarApp('/obras/hto/acessos')
    expect(await screen.findByRole('link', { name: 'Lista de acessos da equipe' })).toHaveAttribute('href', '/acessos')
  })
})
