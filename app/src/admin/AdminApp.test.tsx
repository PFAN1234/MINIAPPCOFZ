import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AdminApp from './AdminApp.tsx'
import { RepositorioAdminProvider } from './dados/contexto.tsx'
import { criarRepositorioAdminFixture } from './dados/fixture.ts'
import type { RepositorioAdmin } from './dados/repositorio.ts'
import { criarEntrada, tokenDoHash } from './entrada.ts'
import { URL_WIDGET } from './telas/Entrar.tsx'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

function renderizar(
  rota = '/',
  repositorio: RepositorioAdmin = criarRepositorioAdminFixture(),
  token: string | null = null,
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <RepositorioAdminProvider repositorio={repositorio}>
        <MemoryRouter initialEntries={[rota]}>
          <AdminApp entrada={criarEntrada(token)} />
        </MemoryRouter>
      </RepositorioAdminProvider>
    </QueryClientProvider>,
  )
  return { repositorio }
}

describe('entrada', () => {
  it('lê o token do hash #entrar=', () => {
    expect(tokenDoHash('#entrar=abc_DEF-123')).toBe('abc_DEF-123')
    expect(tokenDoHash('#outra=1')).toBeNull()
    expect(tokenDoHash('')).toBeNull()
    expect(tokenDoHash('#entrar=a b')).toBeNull()
  })

  it('entrega o token uma única vez', () => {
    const e = criarEntrada('t')
    expect(e.pegarToken()).toBe('t')
    expect(e.pegarToken()).toBeNull()
  })

  it('link válido abre a sessão e mostra as etapas', async () => {
    const repo = criarRepositorioAdminFixture({ sessao: false })
    const trocar = vi.spyOn(repo, 'entrarComToken')
    renderizar('/', repo, 'fixture')
    expect(await screen.findByRole('heading', { name: 'Etapas' })).toBeInTheDocument()
    expect(trocar).toHaveBeenCalledTimes(1)
    expect(trocar).toHaveBeenCalledWith('fixture')
  })

  it('link inválido mostra o erro e a tela de entrada', async () => {
    renderizar('/', criarRepositorioAdminFixture({ sessao: false }), 'ruim')
    expect(await screen.findByRole('alert')).toHaveTextContent('Link inválido, expirado ou já usado')
    expect(screen.getByText(/ou use o botão Administração no Mini App/)).toBeInTheDocument()
  })

  it('sem sessão mostra o Login Widget do bot e entra pelo retorno dele', async () => {
    vi.stubEnv('VITE_TELEGRAM_BOT', '@bot_teste')
    const repo = criarRepositorioAdminFixture({ sessao: false })
    const widget = vi.spyOn(repo, 'entrarComWidget')
    renderizar('/', repo)
    const caixa = await screen.findByTestId('widget-telegram')
    const script = caixa.querySelector('script')!
    expect(script.getAttribute('src')).toBe(URL_WIDGET)
    expect(script.getAttribute('data-telegram-login')).toBe('bot_teste')
    expect(script.getAttribute('data-onauth')).toBe('onTelegramAuth(user)')
    const dados = { id: 1, first_name: 'Ana', auth_date: 1, hash: 'h' }
    window.onTelegramAuth!(dados)
    expect(await screen.findByRole('heading', { name: 'Etapas' })).toBeInTheDocument()
    expect(widget).toHaveBeenCalledWith(dados)
    // o widget sai da página e o retorno global é limpo
    expect(window.onTelegramAuth).toBeUndefined()
  })

  it('quem não é admin vê acesso negado', async () => {
    renderizar('/', criarRepositorioAdminFixture({ admin: false }))
    expect(await screen.findByRole('heading', { name: 'Acesso negado' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Etapas' })).not.toBeInTheDocument()
  })

  it('Sair volta para a tela de entrada', async () => {
    const usuario = userEvent.setup()
    renderizar()
    await usuario.click(await screen.findByRole('button', { name: 'Sair' }))
    expect(await screen.findByRole('heading', { name: 'Administração do Fiscal Bot' })).toBeInTheDocument()
    // a tela de entrada mostra o nome da OM (RPC `organizacao()` também sem sessão)
    expect(screen.getByTestId('identidade-om')).toHaveTextContent('CO-FZ')
  })
})

describe('obras', () => {
  it('lista HTO e COFZ com slug, pavimentos, ambientes ativos e status', async () => {
    renderizar()
    const hto = (await screen.findByRole('link', { name: 'HTO' })).closest('tr')!
    expect(within(hto).getByText('hto')).toBeInTheDocument()
    expect(within(hto).getByText('Térreo, 1º pavimento')).toBeInTheDocument()
    expect(within(hto).getByText('87')).toBeInTheDocument()
    expect(within(hto).getByText('Revisado')).toBeInTheDocument()
    const cofz = screen.getByRole('link', { name: 'COFZ' }).closest('tr')!
    expect(within(cofz).getByText('19')).toBeInTheDocument()
    expect(within(cofz).getByText('Aguardando revisão humana')).toBeInTheDocument()
  })

  it('cria obra, valida o slug e inclui pavimento', async () => {
    const usuario = userEvent.setup()
    renderizar()
    await usuario.click(await screen.findByRole('link', { name: 'Nova obra em 3ª ETAPA' }))
    expect(screen.getByLabelText('Etapa')).toHaveDisplayValue('3ª ETAPA')
    await usuario.type(screen.getByLabelText(/Slug/), 'Obra X')
    await usuario.type(screen.getByLabelText('Nome'), 'Obra Nova')
    await usuario.click(screen.getByRole('button', { name: 'Criar obra' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Slug inválido')

    await usuario.clear(screen.getByLabelText(/Slug/))
    await usuario.type(screen.getByLabelText(/Slug/), 'obra-nova')
    await usuario.click(screen.getByRole('button', { name: 'Criar obra' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Obra Nova' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '3ª ETAPA' })).toHaveAttribute('href', '/etapas/3a-etapa')
    expect(screen.getByRole('heading', { name: 'Modelo 3D' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Planta (PDF)' })).toBeInTheDocument()
    expect(screen.getByText('Nenhum pavimento.')).toBeInTheDocument()

    await usuario.click(screen.getByRole('button', { name: 'Incluir pavimento' }))
    await usuario.type(screen.getByLabelText('Código do pavimento 1'), 'terreo')
    await usuario.type(screen.getByLabelText('Nome do pavimento 1'), 'Térreo')
    await usuario.click(screen.getByRole('button', { name: 'Salvar pavimentos' }))
    expect(await screen.findByText('Pavimentos salvos.')).toBeInTheDocument()
    // depois de salvo, o código não é mais editável
    expect(screen.queryByLabelText('Código do pavimento 1')).not.toBeInTheDocument()
    expect(screen.getByText('terreo')).toBeInTheDocument()
  })

  it('edita nome e ordem da obra (slug só leitura)', async () => {
    const usuario = userEvent.setup()
    const repo = criarRepositorioAdminFixture()
    const salvar = vi.spyOn(repo, 'salvarObra')
    renderizar('/obras/cofz', repo)
    const nome = await screen.findByLabelText('Nome')
    expect(screen.getByLabelText('Slug')).toBeDisabled()
    await usuario.clear(nome)
    await usuario.type(nome, 'COFZ Fortaleza')
    await usuario.click(screen.getByRole('button', { name: 'Salvar obra' }))
    expect(await screen.findByText('Obra salva.')).toBeInTheDocument()
    expect(salvar).toHaveBeenCalledWith({ id: 'obra-cofz', nome: 'COFZ Fortaleza', ordem: 1 })
    expect(await screen.findByRole('heading', { level: 1, name: 'COFZ Fortaleza' })).toBeInTheDocument()
  })

  it('pavimento com ambientes não pode ser removido; o nome pode', async () => {
    const usuario = userEvent.setup()
    renderizar('/obras/hto')
    expect(await screen.findByRole('button', { name: 'Remover pavimento terreo' })).toBeDisabled()
    const nome = screen.getByLabelText('Nome do pavimento 2')
    await usuario.clear(nome)
    await usuario.type(nome, '1º andar')
    await usuario.click(screen.getByRole('button', { name: 'Salvar pavimentos' }))
    expect(await screen.findByText('Pavimentos salvos.')).toBeInTheDocument()
    expect(screen.getByLabelText('Nome do pavimento 2')).toHaveValue('1º andar')
  })

  it('erro do servidor ao salvar pavimentos aparece como alerta', async () => {
    const usuario = userEvent.setup()
    const repo: RepositorioAdmin = {
      ...criarRepositorioAdminFixture(),
      salvarPavimentos: () =>
        Promise.reject(new Error('Não é possível apagar pavimento com ambientes ou plantas: terreo')),
    }
    renderizar('/obras/hto', repo)
    await usuario.click(await screen.findByRole('button', { name: 'Salvar pavimentos' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Não é possível apagar pavimento com ambientes')
  })

  it('configuração: edita nomes fixos, categorias e status e preserva o resto', async () => {
    const usuario = userEvent.setup()
    const repo = criarRepositorioAdminFixture()
    const salvar = vi.spyOn(repo, 'salvarConfig')
    renderizar('/obras/cofz', repo)
    const valor = await screen.findByLabelText('Nome operacional 6')
    expect(screen.getByLabelText('Nome na planta 6')).toHaveValue('DA')
    await usuario.clear(valor)
    await usuario.type(valor, 'Sala do DA')
    await usuario.click(screen.getByRole('button', { name: 'Incluir em categorias' }))
    await usuario.type(screen.getByLabelText('Padrão na planta 16'), 'HALL')
    // Categoria é escolhida no mesmo select do editor de planta.
    expect(screen.getByLabelText('Categoria 1')).toHaveValue('banheiro')
    await usuario.selectOptions(screen.getByLabelText('Categoria 16'), 'circulacao')
    await usuario.selectOptions(screen.getByLabelText('Status da revisão humana'), 'revisado')
    expect(screen.getByText(/Outros campos mantidos como estão: .*prancha/)).toBeInTheDocument()
    await usuario.click(screen.getByRole('button', { name: 'Salvar configuração' }))
    expect(await screen.findByText('Configuração salva.')).toBeInTheDocument()
    const [slug, config] = salvar.mock.calls[0]
    expect(slug).toBe('cofz')
    expect(config.status).toBe('revisado')
    expect(config.nomes_fixos?.DA).toBe('Sala do DA')
    expect(config.categorias?.HALL).toBe('circulacao')
    expect(config.prancha).toBeTruthy()
    expect(config.ambientes_manuais).toHaveLength(2)
  })

  it('configuração recusa chave repetida', async () => {
    const usuario = userEvent.setup()
    const repo = criarRepositorioAdminFixture()
    const salvar = vi.spyOn(repo, 'salvarConfig')
    renderizar('/obras/cofz', repo)
    await usuario.click(await screen.findByRole('button', { name: 'Incluir em nomes fixos' }))
    await usuario.type(screen.getByLabelText('Nome na planta 7'), 'DML')
    await usuario.type(screen.getByLabelText('Nome operacional 7'), 'Outro')
    await usuario.click(screen.getByRole('button', { name: 'Salvar configuração' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('"DML" aparece mais de uma vez')
    expect(salvar).not.toHaveBeenCalled()
  })

  it('Exportar JSON baixa o resultado de exportarObra', async () => {
    const usuario = userEvent.setup()
    const criarUrl = vi.fn(() => 'blob:teste')
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: criarUrl, revokeObjectURL: vi.fn() }))
    const clique = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    renderizar('/obras/hto')
    await usuario.click(await screen.findByRole('button', { name: 'Exportar JSON' }))
    await waitFor(() => expect(clique).toHaveBeenCalledTimes(1))
    const blob = (criarUrl.mock.calls[0] as unknown as [Blob])[0]
    const dados = JSON.parse(await blob.text())
    expect(dados.formato).toBe('miniappcofz-obra')
    expect(dados.obra.slug).toBe('hto')
    expect((clique.mock.contexts[0] as HTMLAnchorElement).download).toMatch(/^hto-\d{4}-\d{2}-\d{2}\.json$/)
    vi.unstubAllGlobals()
  })
})

describe('admins', () => {
  it('inclui um admin entre os usuários existentes', async () => {
    const usuario = userEvent.setup()
    renderizar('/admins')
    expect(await screen.findByRole('cell', { name: 'Patrício Ferreira' })).toBeInTheDocument()
    const opcoes = await screen.findByLabelText('Usuário')
    expect(within(opcoes).queryByText(/Patrício/)).not.toBeInTheDocument()
    await usuario.selectOptions(opcoes, 'usuario-maria')
    await usuario.click(screen.getByRole('button', { name: 'Incluir admin' }))
    expect(await screen.findByText('Maria Souza agora é admin.')).toBeInTheDocument()
    expect(await screen.findByRole('cell', { name: 'Maria Souza' })).toBeInTheDocument()
  })

  it('remove com confirmação e não remove o último admin', async () => {
    const usuario = userEvent.setup()
    renderizar('/admins')
    await usuario.click(await screen.findByRole('button', { name: 'Remover Patrício Ferreira' }))
    await usuario.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByRole('cell', { name: 'Patrício Ferreira' })).toBeInTheDocument()

    await usuario.click(screen.getByRole('button', { name: 'Remover Patrício Ferreira' }))
    await usuario.click(screen.getByRole('button', { name: 'Confirmar remoção de Patrício Ferreira' }))
    expect(await screen.findByText('Patrício Ferreira não é mais admin.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('cell', { name: 'Patrício Ferreira' })).not.toBeInTheDocument())

    await usuario.click(screen.getByRole('button', { name: 'Remover Você (teste)' }))
    await usuario.click(screen.getByRole('button', { name: 'Confirmar remoção de Você (teste)' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Não é possível remover o último admin')
  })
})
