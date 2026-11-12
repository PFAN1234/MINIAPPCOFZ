/**
 * Orientação do aparelho para a RA. Usa o giroscópio em modo relativo (sem bússola):
 * primeiro o evento `deviceorientation` do navegador, depois a API de sensores do
 * Telegram (Bot API 8.0). Sem sensor, a orientação fica fixa e a tela avisa.
 */
import { Euler, Quaternion, Vector3 } from 'three'

export type FonteOrientacao = 'navegador' | 'telegram' | 'nenhuma'

export interface Orientacao {
  /** Orientação atual da câmera no referencial do sensor (Y para cima). */
  atual(): Quaternion
  fonte(): FonteOrientacao
  /** Leituras recebidas até agora (diagnóstico). */
  leituras(): number
  parar(): void
}

interface SensorTelegram {
  isStarted?: boolean
  alpha?: number | null
  beta?: number | null
  gamma?: number | null
  start(parametros: { refresh_rate?: number; need_absolute?: boolean }, retorno?: (ok: boolean) => void): unknown
  stop(retorno?: (ok: boolean) => void): unknown
}

const Z = new Vector3(0, 0, 1)
/** A câmera olha para trás do aparelho: −90° em X. */
const AJUSTE_CAMERA = new Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2)
const GRAUS = Math.PI / 180

/** Quaternion da câmera a partir dos ângulos do aparelho (rad) e do giro da tela (rad). */
export function quaternionDoAparelho(alpha: number, beta: number, gamma: number, tela: number): Quaternion {
  return new Quaternion()
    .setFromEuler(new Euler(beta, alpha, -gamma, 'YXZ'))
    .multiply(AJUSTE_CAMERA)
    .multiply(new Quaternion().setFromAxisAngle(Z, -tela))
}

/** Câmera na horizontal, usada quando o aparelho não informa a orientação. */
export function orientacaoFixa(): Quaternion {
  return quaternionDoAparelho(0, Math.PI / 2, 0, 0)
}

function giroDaTela(): number {
  return ((typeof screen !== 'undefined' && screen.orientation?.angle) || 0) * GRAUS
}

function sensorTelegram(): SensorTelegram | undefined {
  const app = window.Telegram?.WebApp as unknown as { DeviceOrientation?: SensorTelegram } | undefined
  return app?.DeviceOrientation
}

/**
 * Começa a ler a orientação. No iPhone o navegador exige um pedido de permissão feito a
 * partir de um toque: chame esta função dentro do tratador do toque que abre a RA.
 */
export async function iniciarOrientacao(): Promise<Orientacao> {
  let q = orientacaoFixa()
  let fonte: FonteOrientacao = 'nenhuma'
  let n = 0

  function aoEvento(e: DeviceOrientationEvent) {
    if (e.alpha == null || e.beta == null || e.gamma == null) return
    q = quaternionDoAparelho(e.alpha * GRAUS, e.beta * GRAUS, e.gamma * GRAUS, giroDaTela())
    fonte = 'navegador'
    n++
  }

  const pedir = (
    globalThis.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined
  )?.requestPermission
  let permitido = true
  if (typeof pedir === 'function') {
    try {
      permitido = (await pedir()) === 'granted'
    } catch {
      permitido = false
    }
  }
  if (permitido) window.addEventListener('deviceorientation', aoEvento)

  const telegram = sensorTelegram()
  let temporizador: ReturnType<typeof setInterval> | undefined
  if (telegram) {
    try {
      telegram.start({ refresh_rate: 20, need_absolute: false })
      temporizador = setInterval(() => {
        // O evento do navegador, quando existe, tem prioridade.
        if (fonte === 'navegador') return
        const { alpha, beta, gamma } = telegram
        if (!telegram.isStarted || alpha == null || beta == null || gamma == null) return
        q = quaternionDoAparelho(alpha, beta, gamma, giroDaTela())
        fonte = 'telegram'
        n++
      }, 20)
    } catch {
      // Cliente sem a API de sensores: fica só o evento do navegador.
    }
  }

  return {
    atual: () => q.clone(),
    fonte: () => fonte,
    leituras: () => n,
    parar() {
      window.removeEventListener('deviceorientation', aoEvento)
      if (temporizador !== undefined) clearInterval(temporizador)
      try {
        telegram?.stop()
      } catch {
        // Nada a fazer.
      }
    },
  }
}
