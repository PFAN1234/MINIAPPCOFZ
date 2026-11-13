import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TelegramWebApp } from '../telegram.ts'
import { criarRepositorioFixture } from '../dados/fixture.ts'
import type { Organizacao } from '../dados/tipos.ts'
import { renderizarApp } from '../test/renderApp.tsx'
import { FaixaDoTopo } from './faixaDoTopo.ts'
import { OrganizacaoContexto } from './identidade.ts'
import { TopoTela } from './TopoTela.tsx'

function simularTelegram() {
  const app: TelegramWebApp = {
    initData: 'query_id=abc&hash=123',
    colorScheme: 'light',
    themeParams: {},
    BackButton: { show: vi.fn(), hide: vi.fn(), onClick: vi.fn(), offClick: vi.fn() },
    ready: vi.fn(),
    expand: vi.fn(),
    enableClosingConfirmation: vi.fn(),
    disableClosingConfirmation: vi.fn(),
  }
  window.Telegram = { WebApp: app }
}

/** Rotas mínimas: o início e uma tela interna com o topo. */
function renderizar(rotas: string[], topo = <TopoTela titulo="HTO" />) {
  return render(
    <MemoryRouter initialEntries={rotas} initialIndex={rotas.length - 1}>
      <Routes>
        <Route index element={<TopoTela lista titulo="Obras" />} />
        <Route path="obras/hto" element={topo} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => {
  delete window.Telegram
})

describe('TopoTela', () => {
  it('mostra o título como h1, com o sobretítulo e o subtítulo', () => {
    renderizar(['/obras/hto'], <TopoTela titulo="HTO" sobretitulo="Obras" subtitulo="Térreo" />)
    expect(screen.getByRole('heading', { level: 1, name: 'HTO' })).toBeInTheDocument()
    expect(screen.getByText('Obras')).toBeInTheDocument()
    expect(screen.getByText('Térreo')).toBeInTheDocument()
  })

  it('fora do Telegram, mostra "Voltar" nas telas internas e volta no histórico', async () => {
    const usuario = userEvent.setup()
    renderizar(['/', '/obras/hto'])
    await usuario.click(screen.getByRole('button', { name: 'Voltar' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Obras' })).toBeInTheDocument()
    // No início não há para onde voltar.
    expect(screen.queryByRole('button', { name: 'Voltar' })).not.toBeInTheDocument()
  })

  it('dentro do Telegram não mostra "Voltar" (vale o BackButton nativo)', () => {
    simularTelegram()
    renderizar(['/', '/obras/hto'])
    expect(screen.getByRole('heading', { level: 1, name: 'HTO' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Voltar' })).not.toBeInTheDocument()
  })

  it('com destino, o "Voltar" leva até ele', async () => {
    const usuario = userEvent.setup()
    renderizar(['/obras/hto'], <TopoTela titulo="HTO" voltar="/" />)
    await usuario.click(screen.getByRole('button', { name: 'Voltar' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Obras' })).toBeInTheDocument()
  })

  it('mostra a faixa do Layout logo abaixo do azul', () => {
    render(
      <MemoryRouter>
        <FaixaDoTopo.Provider value={<div role="status">1 registro aguardando envio</div>}>
          <TopoTela lista titulo="Obras" />
        </FaixaDoTopo.Provider>
      </MemoryRouter>,
    )
    const cabecalho = screen.getByRole('heading', { level: 1, name: 'Obras' }).closest('header')!
    expect(cabecalho.nextElementSibling).toBe(screen.getByRole('status'))
  })
})

describe('TopoTela: faixa de identidade', () => {
  function comOrganizacao(organizacao: Organizacao | null) {
    return render(
      <MemoryRouter>
        <OrganizacaoContexto.Provider value={organizacao}>
          <TopoTela titulo="HTO" />
        </OrganizacaoContexto.Provider>
      </MemoryRouter>,
    )
  }

  it('com logo: OM à esquerda, logo decorativo (alt vazio) de 40 px no centro e "Fiscal Bot" à direita, acima do título', () => {
    const { container } = comOrganizacao({ nome: 'CO-FZ', logo_url: 'https://exemplo.test/logo.png' })
    const faixa = screen.getByTestId('faixa-identidade')
    const logo = container.querySelector('img')!
    expect(logo).toHaveAttribute('src', 'https://exemplo.test/logo.png')
    expect(logo).toHaveAttribute('alt', '')
    expect(logo).toHaveAttribute('height', '40')
    expect([...faixa.children].map((filho) => filho.textContent)).toEqual(['CO-FZ', '', 'Fiscal Bot'])
    expect(faixa).toHaveTextContent('CO-FZ')
    expect(faixa).toHaveTextContent('Fiscal Bot')
    const cabecalho = screen.getByRole('heading', { level: 1, name: 'HTO' }).closest('header')!
    expect(cabecalho.firstElementChild).toBe(faixa)
  })

  it('logo que não carrega some, e os textos ficam', () => {
    const { container } = comOrganizacao({ nome: 'CO-FZ', logo_url: 'https://exemplo.test/sumiu.png' })
    fireEvent.error(container.querySelector('img')!)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByTestId('faixa-identidade')).toHaveTextContent('CO-FZFiscal Bot')
  })

  it('sem logo: só os textos', () => {
    const { container } = comOrganizacao({ nome: 'CO-FZ', logo_url: null })
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByTestId('faixa-identidade')).toHaveTextContent('CO-FZFiscal Bot')
  })

  it('sem organização (fora do Layout ou ainda sem dados): só "Fiscal Bot"', () => {
    comOrganizacao(null)
    expect(screen.getByTestId('faixa-identidade')).toHaveTextContent(/^Fiscal Bot$/)
  })

  it('no app, mostra a organização da consulta', async () => {
    renderizarApp('/obras/hto')
    await screen.findByRole('heading', { level: 1, name: 'HTO' })
    await waitFor(() => expect(screen.getByTestId('faixa-identidade')).toHaveTextContent('CO-FZFiscal Bot'))
  })

  it('organização indisponível (erro): a tela abre normalmente, com "Fiscal Bot"', async () => {
    renderizarApp('/', { ...criarRepositorioFixture(), organizacao: () => Promise.reject(new Error('falhou')) })
    expect(await screen.findByRole('link', { name: /^HTO/ })).toBeInTheDocument()
    expect(screen.getByTestId('faixa-identidade')).toHaveTextContent(/^Fiscal Bot/)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('a versão do app aparece no pé do topo em todas as telas', async () => {
    const { unmount } = renderizarApp('/')
    await screen.findByRole('link', { name: /^HTO/ })
    const versao = screen.getByRole('button', { name: /^Versão do app: / })
    expect(versao.parentElement!.lastElementChild).toBe(versao)
    unmount()
    renderizarApp('/obras/hto')
    await screen.findByRole('heading', { level: 1, name: 'HTO' })
    expect(screen.getByRole('button', { name: /^Versão do app: / })).toBeInTheDocument()
  })
})
