import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErroEnvio } from '../dados/erros.ts'
import { criarRepositorioFixture } from '../dados/fixture.ts'
import { renderizarApp } from '../shared/test/renderApp.tsx'

afterEach(() => vi.restoreAllMocks())

const grupo = (nome: string, obra: string) =>
  screen.findByRole('group', { name: `Acesso de ${nome} em ${obra}` })

describe('Controle de acesso', () => {
  it('renderiza a matriz da fixture, com pedido e admin', async () => {
    renderizarApp('/acessos')
    expect(await screen.findByRole('heading', { level: 1, name: 'Controle de acesso' })).toBeInTheDocument()
    expect(
      screen.getByText('Marque o acesso de cada pessoa às obras. A lista mostra quem já abriu o app ou falou no grupo.'),
    ).toBeInTheDocument()
    const maria = await grupo('Maria Souza', 'HTO')
    // Pedido pendente sem acesso: nenhum botão marcado.
    for (const b of within(maria).getAllByRole('button')) expect(b).toHaveAttribute('aria-pressed', 'false')
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

  it('Sem acesso recusa o pedido pendente', async () => {
    const usuario = userEvent.setup()
    const base = criarRepositorioFixture()
    const definirAcesso = vi.spyOn(base, 'definirAcesso')
    renderizarApp('/acessos', base)
    const maria = await grupo('Maria Souza', 'HTO')
    await usuario.click(within(maria).getByRole('button', { name: 'Sem acesso' }))
    expect(definirAcesso).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'nenhum')
    await vi.waitFor(() => expect(screen.queryByText('Pediu acesso')).not.toBeInTheDocument())
    const depois = await grupo('Maria Souza', 'HTO')
    expect(within(depois).getByRole('button', { name: 'Sem acesso' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('admin que não é gestor também entra na tela', async () => {
    const base = criarRepositorioFixture({ admin: true })
    renderizarApp('/acessos', {
      ...base,
      resumoObras: async () => (await base.resumoObras()).map((r) => ({ ...r, papel: 'equipe' as const })),
    })
    expect(await grupo('Maria Souza', 'HTO')).toBeInTheDocument()
  })

  it('o botão da tela inicial aparece para gestor e admin, não para quem não é nenhum dos dois', async () => {
    const base = criarRepositorioFixture()
    const comoEquipe = (b: typeof base) => ({
      ...b,
      resumoObras: async () => (await b.resumoObras()).map((r) => ({ ...r, papel: 'equipe' as const })),
    })
    const { unmount } = renderizarApp('/', base)
    const botao = await screen.findByRole('link', { name: /^Controle de acesso/ })
    expect(botao).toHaveAttribute('href', '/acessos')
    // 1 pedido pendente (Maria).
    expect(await within(botao).findByText('1')).toBeInTheDocument()
    expect(screen.getByText('Escolha quais obras cada pessoa do grupo pode ver.')).toBeInTheDocument()
    unmount()

    const admin = criarRepositorioFixture({ admin: true })
    const { unmount: u2 } = renderizarApp('/', comoEquipe(admin))
    expect(await screen.findByRole('link', { name: /^Controle de acesso/ })).toBeInTheDocument()
    u2()

    renderizarApp('/', comoEquipe(base))
    await screen.findByText('HTO')
    expect(screen.queryByRole('link', { name: /^Controle de acesso/ })).not.toBeInTheDocument()
  })

  it('o botão fica embaixo da Administração', async () => {
    renderizarApp('/', criarRepositorioFixture({ admin: true }))
    const adm = await screen.findByRole('button', { name: 'Administração' })
    const ctl = await screen.findByRole('link', { name: /^Controle de acesso/ })
    expect(adm.compareDocumentPosition(ctl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('os pedidos de acesso têm o link para o Controle de acesso', async () => {
    renderizarApp('/obras/hto/acessos')
    expect(await screen.findByRole('link', { name: 'Controle de acesso' })).toHaveAttribute('href', '/acessos')
  })
})
