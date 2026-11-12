import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TelegramWebApp } from '../telegram.ts'
import { FaixaDoTopo } from './faixaDoTopo.ts'
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
