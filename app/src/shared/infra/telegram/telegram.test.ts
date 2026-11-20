import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  aplicarCoresTelegram,
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
  telaCheia,
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

describe('cores do Telegram', () => {
  /** Compara versões como o SDK do Telegram: por partes numéricas ('7.10' > '7.2'). */
  function versaoMaiorOuIgual(versao: string, minima: string): boolean {
    const a = versao.split('.').map(Number)
    const b = minima.split('.').map(Number)
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const x = a[i] ?? 0
      const y = b[i] ?? 0
      if (x !== y) return x > y
    }
    return true
  }

  function webAppNaVersao(versao: string) {
    const app = {
      ...criarWebApp(),
      version: versao,
      isVersionAtLeast: (minima: string) => versaoMaiorOuIgual(versao, minima),
      setHeaderColor: vi.fn(),
      setBackgroundColor: vi.fn(),
      setBottomBarColor: vi.fn(),
    }
    window.Telegram = { WebApp: app }
    return app
  }

  it.each([
    { versao: '6.0', cabecalho: false, fundo: false, barra: false },
    { versao: '6.1', cabecalho: false, fundo: true, barra: false },
    { versao: '6.8', cabecalho: false, fundo: true, barra: false },
    { versao: '6.9', cabecalho: true, fundo: true, barra: false },
    { versao: '7.0', cabecalho: true, fundo: true, barra: false },
    { versao: '7.2', cabecalho: true, fundo: true, barra: false },
    { versao: '7.10', cabecalho: true, fundo: true, barra: true },
    { versao: '8.0', cabecalho: true, fundo: true, barra: true },
  ])('versão $versao: só pede as cores que a versão aceita', ({ versao, cabecalho, fundo, barra }) => {
    const app = webAppNaVersao(versao)
    aplicarCoresTelegram()

    if (cabecalho) expect(app.setHeaderColor).toHaveBeenCalledExactlyOnceWith('#0B1625')
    else expect(app.setHeaderColor).not.toHaveBeenCalled()
    if (fundo) expect(app.setBackgroundColor).toHaveBeenCalledExactlyOnceWith('#ECEFF3')
    else expect(app.setBackgroundColor).not.toHaveBeenCalled()
    if (barra) expect(app.setBottomBarColor).toHaveBeenCalledExactlyOnceWith('#FFFFFF')
    else expect(app.setBottomBarColor).not.toHaveBeenCalled()
  })

  it('sem window.Telegram, não faz nada e não lança erro', () => {
    expect(() => aplicarCoresTelegram()).not.toThrow()
  })

  it('cliente sem isVersionAtLeast ou sem os métodos: não pede nada e não lança erro', () => {
    const app = criarWebApp()
    window.Telegram = { WebApp: app }
    expect(() => aplicarCoresTelegram()).not.toThrow()

    const semMetodos = { ...criarWebApp(), isVersionAtLeast: () => true }
    window.Telegram = { WebApp: semMetodos }
    expect(() => aplicarCoresTelegram()).not.toThrow()
  })

  it('erro de um método não impede os outros nem derruba o app', () => {
    const app = webAppNaVersao('7.10')
    app.setHeaderColor.mockImplementation(() => {
      throw new Error('WebAppHeaderColorInvalid')
    })
    expect(() => aplicarCoresTelegram()).not.toThrow()
    expect(app.setBackgroundColor).toHaveBeenCalledOnce()
    expect(app.setBottomBarColor).toHaveBeenCalledOnce()
  })
})

describe('tela cheia', () => {
  function webApp(versao: number, platform: string) {
    const app = {
      ...criarWebApp(),
      platform,
      isVersionAtLeast: (minima: string) => versao >= Number(minima),
      disableVerticalSwipes: vi.fn(),
      requestFullscreen: vi.fn(),
    }
    window.Telegram = { WebApp: app }
    return app
  }

  it.each([
    { versao: 7.6, platform: 'ios', trava: false, cheia: false },
    { versao: 7.7, platform: 'ios', trava: true, cheia: false },
    { versao: 8.0, platform: 'ios', trava: true, cheia: true },
    { versao: 8.0, platform: 'android', trava: true, cheia: true },
    { versao: 8.0, platform: 'android_x', trava: true, cheia: true },
    { versao: 8.0, platform: 'tdesktop', trava: true, cheia: false },
    { versao: 8.0, platform: 'macos', trava: true, cheia: false },
    { versao: 8.0, platform: 'weba', trava: true, cheia: false },
  ])('versão $versao em $platform: trava=$trava, tela cheia=$cheia', ({ versao, platform, trava, cheia }) => {
    const app = webApp(versao, platform)
    telaCheia()
    if (trava) expect(app.disableVerticalSwipes).toHaveBeenCalledOnce()
    else expect(app.disableVerticalSwipes).not.toHaveBeenCalled()
    if (cheia) expect(app.requestFullscreen).toHaveBeenCalledOnce()
    else expect(app.requestFullscreen).not.toHaveBeenCalled()
  })

  it('sem window.Telegram ou sem os métodos, não lança erro', () => {
    expect(() => telaCheia()).not.toThrow()
    window.Telegram = { WebApp: { ...criarWebApp(), platform: 'ios', isVersionAtLeast: () => true } }
    expect(() => telaCheia()).not.toThrow()
  })

  it('erro na trava não impede a tela cheia', () => {
    const app = webApp(8.0, 'ios')
    app.disableVerticalSwipes.mockImplementation(() => {
      throw new Error('WebAppMethodUnsupported')
    })
    expect(() => telaCheia()).not.toThrow()
    expect(app.requestFullscreen).toHaveBeenCalledOnce()
  })
})
