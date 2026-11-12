import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App.tsx'
import { RepositorioProvider } from './dados/contexto.tsx'
import { criarRepositorioFixture } from './dados/fixture.ts'
import type { Repositorio } from './dados/repositorio.ts'
import { recursos } from './recursos.ts'

vi.mock('./components/AbaPlanta.tsx', () => ({
  AbaPlanta: (props: { pavimentoCodigo: string; focoCodigo: string | null }) => (
    <div data-testid="aba-planta">
      planta {props.pavimentoCodigo} foco {props.focoCodigo ?? '-'}
    </div>
  ),
}))
vi.mock('./components/OndeFica.tsx', () => ({
  OndeFica: (props: { onAbrirPlanta: () => void }) => (
    <button type="button" onClick={props.onAbrirPlanta}>
      Abrir na planta
    </button>
  ),
}))

function renderizar(rota = '/', repositorio: Repositorio = criarRepositorioFixture()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <RepositorioProvider repositorio={repositorio}>
        <MemoryRouter initialEntries={[rota]}>
          <App />
        </MemoryRouter>
      </RepositorioProvider>
    </QueryClientProvider>,
  )
}

describe('navegação com a fixture', () => {
  it('Obras → HTO → Apto. 101', async () => {
    const usuario = userEvent.setup()
    renderizar()
    expect(await screen.findByRole('heading', { level: 1, name: 'Obras' })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: /Residencial Aurora/ })).toBeInTheDocument()

    await usuario.click(await screen.findByRole('link', { name: /^HTO/ }))
    expect(await screen.findByRole('heading', { level: 1, name: 'HTO' })).toBeInTheDocument()
    // A obra abre na planta; a lista fica a um toque.
    expect(await screen.findByTestId('aba-planta')).toBeInTheDocument()
    await usuario.click(screen.getByRole('tab', { name: 'Lista' }))

    await usuario.click(await screen.findByRole('link', { name: /Apto\. 101/ }))
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Apto. 101' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Térreo/)).toBeInTheDocument()
  })

  it('a barra inferior leva às Pendências (abertas, de todas as obras)', async () => {
    const usuario = userEvent.setup()
    renderizar()
    const navegacao = await screen.findByRole('navigation', { name: 'Navegação principal' })
    // Com as pendências do Início carregadas, o rótulo leva a contagem.
    const item = await within(navegacao).findByRole('link', { name: 'Pendências · 3 abertas' })
    await usuario.click(item)
    expect(await screen.findByRole('heading', { level: 1, name: 'Pendências' })).toBeInTheDocument()
    expect(item).toHaveAttribute('aria-current', 'page')
    expect(await screen.findByRole('tab', { name: 'Abertas (3)' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findAllByRole('link', { name: /Aberta/ })).toHaveLength(3)
  })

  it('endereço inexistente mostra a 404 com "Voltar ao início"', async () => {
    const usuario = userEvent.setup()
    renderizar('/nao-existe')
    expect(await screen.findByRole('heading', { level: 1, name: 'Página não encontrada' })).toBeInTheDocument()
    const inicio = screen.getByRole('link', { name: 'Voltar ao início' })
    expect(inicio).toHaveAttribute('href', '/')
    await usuario.click(inicio)
    expect(await screen.findByRole('heading', { level: 1, name: 'Obras' })).toBeInTheDocument()
  })

  it('mostra erro com "Tentar de novo"', async () => {
    const quebrado: Repositorio = {
      ...criarRepositorioFixture(),
      listarObras: () => Promise.reject(new Error('falhou')),
    }
    renderizar('/', quebrado)
    expect(await screen.findByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument()
  })
})

describe('telas', () => {
  it('Obras mostra a contagem de pendências abertas e os últimos registros', async () => {
    renderizar()
    expect(await screen.findByRole('link', { name: /^HTO.*3 pendências abertas/ })).toBeInTheDocument()
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    expect(await screen.findAllByText('Serviço')).not.toHaveLength(0)
  })

  it('Obra: busca "circ" mostra as circulações e area em pt-BR', async () => {
    const usuario = userEvent.setup()
    renderizar('/obras/hto?aba=lista')
    expect(await screen.findByRole('link', { name: /Apto\. 101/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Apto\. 101/ })).toHaveTextContent('23,88 m²')
    await usuario.type(screen.getByRole('searchbox'), 'circ')
    const links = await screen.findAllByRole('link', { name: /Circula/ })
    expect(links.length).toBeGreaterThan(0)
    expect(screen.queryByRole('link', { name: /Apto\. 101/ })).not.toBeInTheDocument()
    await usuario.clear(screen.getByRole('searchbox'))
    await usuario.type(screen.getByRole('searchbox'), 'zzzz')
    expect(await screen.findByText('Nenhum ambiente encontrado')).toBeInTheDocument()
  })

  it('Obra: trocar de pavimento troca a lista', async () => {
    const usuario = userEvent.setup()
    renderizar('/obras/hto?aba=lista')
    expect(await screen.findByRole('link', { name: /Apto\. 101/ })).toBeInTheDocument()
    const abas = screen.getAllByRole('tab', { selected: false })
    await usuario.click(abas.find((a) => /1º/.test(a.textContent ?? ''))!)
    expect(await screen.findByRole('link', { name: /Circula/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Apto\. 101/ })).not.toBeInTheDocument()
  })

  it('Obra: abre na planta por padrão, no primeiro pavimento', async () => {
    renderizar('/obras/hto')
    expect(await screen.findByTestId('aba-planta')).toHaveTextContent('planta terreo foco -')
    expect(screen.getByRole('tab', { name: 'Planta' })).toHaveAttribute('aria-selected', 'true')
  })

  it('Obra: aba Planta renderiza AbaPlanta com pav e foco da URL e esconde a barra inferior', async () => {
    renderizar('/obras/hto?aba=planta&pav=1pav&foco=1pav-circulacao')
    expect(await screen.findByTestId('aba-planta')).toHaveTextContent('planta 1pav foco 1pav-circulacao')
    expect(screen.queryByRole('navigation', { name: 'Navegação principal' })).not.toBeInTheDocument()
  })

  it('Ambiente: Pendências mostra as abertas da fixture', async () => {
    const usuario = userEvent.setup()
    renderizar('/obras/hto/ambientes/terreo-apto-101')
    expect(await screen.findByText(/Contrapiso do quarto/)).toBeInTheDocument()
    await usuario.click(screen.getByRole('tab', { name: 'Pendências' }))
    expect(await screen.findByText(/Tomada da sala/)).toBeInTheDocument()
    expect(screen.queryByText(/Contrapiso do quarto/)).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Pendências' })).toHaveAttribute('aria-selected', 'true')
  })

  it('Ambiente: "Onde fica" leva à planta com foco', async () => {
    const usuario = userEvent.setup()
    renderizar('/obras/hto/ambientes/terreo-apto-101')
    await usuario.click(await screen.findByRole('button', { name: 'Abrir na planta' }))
    expect(await screen.findByTestId('aba-planta')).toHaveTextContent('foco terreo-apto-101')
  })

  it('flag desligada oculta o Novo registro; ligada o mostra', async () => {
    recursos.novoRegistro = false
    try {
      renderizar('/obras/hto/ambientes/terreo-apto-101')
      await screen.findByRole('tab', { name: 'Histórico' })
      expect(screen.queryByRole('button', { name: 'Novo registro' })).not.toBeInTheDocument()
    } finally {
      recursos.novoRegistro = true
    }
    cleanup()
    renderizar('/obras/hto/ambientes/terreo-apto-101')
    expect(await screen.findByRole('button', { name: 'Novo registro' })).toBeInTheDocument()
  })
})

describe('sessão e recursos', () => {
  it('sem sessão no modo Supabase pede para abrir pelo Telegram', async () => {
    renderizar('/', { ...criarRepositorioFixture(), temSessao: async () => false })
    expect(
      await screen.findByText('Abra o Diário da obra pelo Telegram'),
    ).toBeInTheDocument()
  })

  it('flags: o Novo registro está ligado', () => {
    expect(recursos.novoRegistro).toBe(true)
  })
})

describe('acesso às obras', () => {
  it('Obras mostra "Outras obras" e o pedido vira "Aguardando aprovação"', async () => {
    const usuario = userEvent.setup()
    renderizar()
    expect(await screen.findByRole('heading', { level: 2, name: 'Outras obras' })).toBeInTheDocument()
    expect(screen.getByText('Obra Demonstração')).toBeInTheDocument()
    await usuario.click(screen.getByRole('button', { name: /Solicitar acesso/ }))
    expect(await screen.findByText('Aguardando aprovação')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Solicitar acesso/ })).not.toBeInTheDocument()
  })

  it('pedido recusado oferece "Pedir de novo" e o erro da RPC aparece como mensagem', async () => {
    const usuario = userEvent.setup()
    const repo: Repositorio = {
      ...criarRepositorioFixture(),
      obrasDisponiveis: async () => [
        { id: 'o1', slug: 'x', nome: 'Obra X', solicitacao: 'recusada' },
      ],
      solicitarAcesso: () =>
        Promise.reject(new Error('Pedido recusado recentemente. Fale com o gestor da obra.')),
    }
    renderizar('/', repo)
    await usuario.click(await screen.findByRole('button', { name: /Pedir de novo/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Pedido recusado recentemente')
  })

  it('sem obras e sem disponíveis mostra a orientação para entrar no grupo', async () => {
    const repo: Repositorio = {
      ...criarRepositorioFixture(),
      listarObras: async () => [],
      obrasDisponiveis: async () => [],
    }
    renderizar('/', repo)
    expect(await screen.findByText('Você ainda não tem acesso a nenhuma obra')).toBeInTheDocument()
    expect(
      screen.getByText('Entre no grupo da obra no Telegram e abra o app de novo para pedir acesso.'),
    ).toBeInTheDocument()
  })

  it('Obra (gestor) mostra o atalho da Gestão com o selo e a rota de Acessos aprova', async () => {
    const usuario = userEvent.setup()
    renderizar('/obras/hto')
    // 1 pedido de acesso + 2 publicações com problema.
    expect(await screen.findByRole('link', { name: 'Gestão 3' })).toHaveAttribute('href', '/obras/hto/gestao')
    cleanup()
    renderizar('/obras/hto/acessos')
    expect(await screen.findByRole('heading', { level: 1, name: 'Pedidos de acesso' })).toBeInTheDocument()
    expect(await screen.findByText('Maria Souza')).toBeInTheDocument()
    expect(screen.getByText('@maria')).toBeInTheDocument()
    await usuario.click(screen.getByRole('button', { name: /Aprovar/ }))
    expect(await screen.findByText('Nenhum pedido de acesso pendente.')).toBeInTheDocument()
  })

  it('Recusar pede confirmação', async () => {
    const usuario = userEvent.setup()
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    renderizar('/obras/hto/acessos')
    await usuario.click(await screen.findByRole('button', { name: /Recusar/ }))
    expect(confirmar).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Maria Souza')).toBeInTheDocument()
    await usuario.click(screen.getByRole('button', { name: /Recusar/ }))
    expect(await screen.findByText('Nenhum pedido de acesso pendente.')).toBeInTheDocument()
    confirmar.mockRestore()
  })

  it('quem não é gestor vê a mensagem de restrição', async () => {
    const base = criarRepositorioFixture()
    renderizar('/obras/hto/acessos', {
      ...base,
      obterObra: async (slug) => ({ ...(await base.obterObra(slug)), papel: 'equipe' }),
    })
    expect(
      await screen.findByText('Só gestores da obra veem os pedidos de acesso.'),
    ).toBeInTheDocument()
  })
})

describe('abertura por link startapp', () => {
  const ID_REGISTRO = '00000000-0000-4000-8000-000000000101'

  function simularTelegram(startParam: string) {
    window.Telegram = {
      WebApp: {
        initData: '',
        initDataUnsafe: { start_param: startParam },
        colorScheme: 'light',
        themeParams: {},
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
        ready() {},
        expand() {},
        enableClosingConfirmation() {},
        disableClosingConfirmation() {},
      },
    }
  }

  afterEach(() => {
    delete window.Telegram
    sessionStorage.clear()
  })

  it('registro_<id> abre o ambiente com o registro destacado e o visualizador', async () => {
    sessionStorage.clear()
    simularTelegram(`registro_${ID_REGISTRO}`)
    renderizar('/')
    expect(await screen.findByRole('heading', { level: 1, name: 'Apto. 101' })).toBeInTheDocument()
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    const item = screen.getByText(/Tomada da sala/).closest('li')
    expect(item).toHaveClass('registro-destaque')
    expect(screen.getByRole('tab', { name: 'Pendências' })).toHaveAttribute('aria-selected', 'true')
  })

  it('acessos_<slug> abre a tela Acessos', async () => {
    sessionStorage.clear()
    simularTelegram('acessos_hto')
    renderizar('/')
    expect(await screen.findByRole('heading', { level: 1, name: 'Pedidos de acesso' })).toBeInTheDocument()
  })

  it('registro inexistente mostra o aviso', async () => {
    sessionStorage.clear()
    simularTelegram('registro_00000000-0000-4000-8000-0000000009ff')
    renderizar('/')
    expect(await screen.findByText('Registro não encontrado ou sem acesso.')).toBeInTheDocument()
  })

  it('o parâmetro é consumido uma vez por abertura', async () => {
    sessionStorage.setItem('startapp-consumido', 'acessos_hto')
    simularTelegram('acessos_hto')
    renderizar('/')
    expect(await screen.findByRole('heading', { level: 1, name: 'Obras' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Pedidos de acesso' })).not.toBeInTheDocument()
  })
})
