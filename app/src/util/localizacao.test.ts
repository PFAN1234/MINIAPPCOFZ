import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TelegramLocationManager, TelegramWebApp } from '../telegram.ts'
import { ErroLocalizacao, MSG_SEM_PERMISSAO, obterPosicao } from './localizacao.ts'

afterEach(() => {
  delete window.Telegram
  vi.unstubAllGlobals()
})

function telegram(lm: Partial<TelegramLocationManager>, versao = '8.0') {
  window.Telegram = {
    WebApp: {
      initData: 'x=1',
      colorScheme: 'light',
      themeParams: {},
      BackButton: { show: vi.fn(), hide: vi.fn(), onClick: vi.fn(), offClick: vi.fn() },
      ready: vi.fn(),
      expand: vi.fn(),
      enableClosingConfirmation: vi.fn(),
      disableClosingConfirmation: vi.fn(),
      isVersionAtLeast: (v: string) => Number(v) <= Number(versao),
      LocationManager: {
        isInited: true,
        isLocationAvailable: true,
        isAccessRequested: false,
        isAccessGranted: false,
        init: (cb?: () => void) => cb?.(),
        getLocation: vi.fn(),
        openSettings: vi.fn(),
        ...lm,
      },
    } satisfies TelegramWebApp,
  }
}

function navegador(fn: Geolocation['getCurrentPosition']) {
  vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition: fn } })
}

describe('obterPosicao', () => {
  it('usa o LocationManager do Telegram (8.0+)', async () => {
    telegram({ getLocation: (cb) => cb({ latitude: 1, longitude: 2, horizontal_accuracy: 5 }) })
    expect(await obterPosicao()).toEqual({ latitude: 1, longitude: 2, precisao: 5 })
  })

  it('Telegram: acesso negado oferece os ajustes', async () => {
    const openSettings = vi.fn()
    telegram({ getLocation: (cb) => cb(null), openSettings })
    const erro = await obterPosicao().catch((e: unknown) => e)
    expect(erro).toBeInstanceOf(ErroLocalizacao)
    expect((erro as ErroLocalizacao).message).toBe(MSG_SEM_PERMISSAO)
    ;(erro as ErroLocalizacao).abrirAjustes?.()
    expect(openSettings).toHaveBeenCalled()
  })

  it('Telegram: localização indisponível no aparelho', async () => {
    telegram({ isLocationAvailable: false })
    await expect(obterPosicao()).rejects.toMatchObject({ motivo: 'indisponivel' })
  })

  it('cliente antigo (< 8.0): cai no GPS do navegador', async () => {
    telegram({}, '7.10')
    navegador((ok) => ok({ coords: { latitude: 3, longitude: 4, accuracy: 20 } } as GeolocationPosition))
    expect(await obterPosicao()).toEqual({ latitude: 3, longitude: 4, precisao: 20 })
  })

  it('navegador: erros viram mensagens em português', async () => {
    navegador((_ok, erro) => erro?.({ code: 1 } as GeolocationPositionError))
    await expect(obterPosicao()).rejects.toMatchObject({ motivo: 'permissao', message: MSG_SEM_PERMISSAO })
    navegador((_ok, erro) => erro?.({ code: 3 } as GeolocationPositionError))
    await expect(obterPosicao()).rejects.toMatchObject({ motivo: 'tempo' })
    navegador((_ok, erro) => erro?.({ code: 2 } as GeolocationPositionError))
    await expect(obterPosicao()).rejects.toMatchObject({ motivo: 'indisponivel' })
  })
})
