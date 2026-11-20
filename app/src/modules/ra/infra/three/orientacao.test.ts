import { afterEach, describe, expect, it, vi } from 'vitest'
import { iniciarOrientacao } from './orientacao.ts'

describe('iniciarOrientacao', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    delete (window as unknown as { Telegram?: unknown }).Telegram
  })

  it('para o sensor do Telegram e o polling quando o evento do navegador entrega leituras', async () => {
    vi.useFakeTimers()
    const stop = vi.fn()
    const telegramSensor = {
      isStarted: true,
      alpha: 0.1,
      beta: 1.2,
      gamma: 0,
      start: vi.fn(),
      stop,
    }
    ;(window as unknown as { Telegram?: unknown }).Telegram = { WebApp: { DeviceOrientation: telegramSensor } }

    const o = await iniciarOrientacao()
    expect(telegramSensor.start).toHaveBeenCalledTimes(1)

    window.dispatchEvent(
      Object.assign(new Event('deviceorientation'), { alpha: 10, beta: 80, gamma: 0 }),
    )
    expect(o.fonte()).toBe('navegador')
    expect(stop).toHaveBeenCalledTimes(1)

    // Avançar o relógio não deve gerar leituras extras do polling do Telegram.
    const leiturasAntes = o.leituras()
    vi.advanceTimersByTime(200)
    expect(o.leituras()).toBe(leiturasAntes)
    o.parar()
  })
})
