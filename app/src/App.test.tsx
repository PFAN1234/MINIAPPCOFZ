import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
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
    expect(await screen.findByRole('heading', { level: 2, name: 'Obras' })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: /Residencial Aurora/ })).toBeInTheDocument()

    await usuario.click(await screen.findByRole('link', { name: /^HTO/ }))
    expect(await screen.findByRole('heading', { level: 2, name: 'HTO' })).toBeInTheDocument()

    await usuario.click(await screen.findByRole('link', { name: /Apto\. 101/ }))
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Apto. 101' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Térreo/)).toBeInTheDocument()
  })

  it('a barra inferior leva às Pendências abertas', async () => {
    const usuario = userEvent.setup()
    renderizar()
    await usuario.click(await screen.findByRole('link', { name: 'Pendências' }))
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Pendências abertas' }),
    ).toBeInTheDocument()
    expect(await screen.findAllByRole('link', { name: /Pendência aberta/ })).toHaveLength(3)
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
    renderizar('/obras/hto')
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
    renderizar('/obras/hto')
    expect(await screen.findByRole('link', { name: /Apto\. 101/ })).toBeInTheDocument()
    const abas = screen.getAllByRole('tab', { selected: false })
    await usuario.click(abas.find((a) => /1º/.test(a.textContent ?? ''))!)
    expect(await screen.findByRole('link', { name: /Circula/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Apto\. 101/ })).not.toBeInTheDocument()
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

  it('flags ocultam o modelo federado e o Novo registro, e os mostram quando ligadas', async () => {
    renderizar('/obras/hto')
    await screen.findByRole('link', { name: /Apto\. 101/ })
    expect(screen.queryByText('Modelo federado')).not.toBeInTheDocument()
    cleanup()
    renderizar('/obras/hto/ambientes/terreo-apto-101')
    await screen.findByRole('tab', { name: 'Histórico' })
    expect(screen.queryByRole('button', { name: 'Novo registro' })).not.toBeInTheDocument()
    cleanup()

    recursos.modeloFederado = true
    recursos.novoRegistro = true
    try {
      renderizar('/obras/hto')
      expect(await screen.findByText('Modelo federado')).toBeInTheDocument()
      cleanup()
      renderizar('/obras/hto/ambientes/terreo-apto-101')
      expect(await screen.findByRole('button', { name: 'Novo registro' })).toBeInTheDocument()
    } finally {
      recursos.modeloFederado = false
      recursos.novoRegistro = false
    }
  })
})

describe('sessão e recursos', () => {
  it('sem sessão no modo Supabase pede para abrir pelo Telegram', async () => {
    renderizar('/', { ...criarRepositorioFixture(), temSessao: async () => false })
    expect(
      await screen.findByText('Abra o Diário da obra pelo Telegram'),
    ).toBeInTheDocument()
  })

  it('flags de fases futuras começam desligadas', () => {
    expect(recursos.modeloFederado).toBe(false)
    expect(recursos.novoRegistro).toBe(false)
  })
})
