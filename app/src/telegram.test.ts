import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BackButton,
  colorScheme,
  disableClosingConfirmation,
  enableClosingConfirmation,
  dentroDoTelegram,
  expand,
  idUsuarioTelegram,
  initData,
  parametroInicial,
  ready,
  themeParams,
  type TelegramWebApp,
} from './telegram'

function criarWebApp(): TelegramWebApp {
  return {
    initData: 'query_id=abc&hash=123',
    colorScheme: 'dark',
    themeParams: { bg_color: '#111111' },
    BackButton: {
      show: vi.fn(),
      hide: vi.fn(),
      onClick: vi.fn(),
      offClick: vi.fn(),
    },
    ready: vi.fn(),
    expand: vi.fn(),
    enableClosingConfirmation: vi.fn(),
    disableClosingConfirmation: vi.fn(),
  }
}

afterEach(() => {
  delete window.Telegram
  vi.restoreAllMocks()
})

describe('telegram sem window.Telegram', () => {
  it('retorna valores neutros e não lança erro', () => {
    expect(dentroDoTelegram()).toBe(false)
    expect(initData()).toBe('')
    expect(themeParams()).toEqual({})
    expect(() => {
      ready()
      expand()
      enableClosingConfirmation()
      disableClosingConfirmation()
      BackButton.show()
      BackButton.hide()
      BackButton.onClick(() => {})
      BackButton.offClick(() => {})
    }).not.toThrow()
  })

  it('usa o esquema de cores do sistema', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('dark'),
    }))
    expect(colorScheme()).toBe('dark')
    vi.unstubAllGlobals()
    expect(colorScheme()).toBe('light')
  })
})

describe('telegram com window.Telegram', () => {
  it('delega ao WebApp', () => {
    const app = criarWebApp()
    window.Telegram = { WebApp: app }
    const cb = () => {}

    expect(dentroDoTelegram()).toBe(true)
    expect(initData()).toBe('query_id=abc&hash=123')
    expect(colorScheme()).toBe('dark')
    expect(themeParams()).toEqual({ bg_color: '#111111' })

    ready()
    expand()
    enableClosingConfirmation()
    disableClosingConfirmation()
    BackButton.show()
    BackButton.hide()
    BackButton.onClick(cb)
    BackButton.offClick(cb)

    expect(app.ready).toHaveBeenCalledOnce()
    expect(app.expand).toHaveBeenCalledOnce()
    expect(app.enableClosingConfirmation).toHaveBeenCalledOnce()
    expect(app.disableClosingConfirmation).toHaveBeenCalledOnce()
    expect(app.BackButton.show).toHaveBeenCalledOnce()
    expect(app.BackButton.hide).toHaveBeenCalledOnce()
    expect(app.BackButton.onClick).toHaveBeenCalledWith(cb)
    expect(app.BackButton.offClick).toHaveBeenCalledWith(cb)
  })
})

describe('parâmetro inicial e usuário', () => {
  it('sem Telegram, ambos são null', () => {
    expect(parametroInicial()).toBeNull()
    expect(idUsuarioTelegram()).toBeNull()
  })

  it('lê start_param e user.id de initDataUnsafe', () => {
    window.Telegram = {
      WebApp: { ...criarWebApp(), initDataUnsafe: { user: { id: 42 }, start_param: 'acessos_hto' } },
    }
    expect(parametroInicial()).toBe('acessos_hto')
    expect(idUsuarioTelegram()).toBe(42)
  })

  it('start_param vazio ou ausente vira null', () => {
    window.Telegram = { WebApp: { ...criarWebApp(), initDataUnsafe: { start_param: '' } } }
    expect(parametroInicial()).toBeNull()
    window.Telegram = { WebApp: criarWebApp() }
    expect(parametroInicial()).toBeNull()
    expect(idUsuarioTelegram()).toBeNull()
  })
})
