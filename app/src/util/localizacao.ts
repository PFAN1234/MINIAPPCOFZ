import type { Posicao } from '../dados/tipos.ts'
import { localizacaoDoTelegram, type TelegramLocationManager } from '../telegram.ts'

export type MotivoErroLocalizacao = 'permissao' | 'indisponivel' | 'tempo'

/** Erro de localização com mensagem em português para a tela. */
export class ErroLocalizacao extends Error {
  readonly motivo: MotivoErroLocalizacao
  /** Dentro do Telegram, abre os ajustes de localização do app (para o usuário liberar o acesso). */
  readonly abrirAjustes?: () => void
  constructor(motivo: MotivoErroLocalizacao, message: string, abrirAjustes?: () => void) {
    super(message)
    this.name = 'ErroLocalizacao'
    this.motivo = motivo
    this.abrirAjustes = abrirAjustes
  }
}

export const MSG_SEM_PERMISSAO = 'Permita o acesso à localização para fazer o check-in.'
export const MSG_SEM_GPS = 'Não foi possível obter a localização. Ative o GPS do aparelho e tente de novo.'
export const MSG_TEMPO = 'A localização demorou demais. Vá para um local aberto e tente de novo.'

const TEMPO_LIMITE_MS = 15_000

function viaTelegram(lm: TelegramLocationManager): Promise<Posicao> {
  return new Promise((resolve, reject) => {
    let encerrado = false
    const terminar = (f: () => void) => {
      if (encerrado) return
      encerrado = true
      clearTimeout(relogio)
      f()
    }
    const relogio = setTimeout(
      () => terminar(() => reject(new ErroLocalizacao('tempo', MSG_TEMPO))),
      TEMPO_LIMITE_MS,
    )
    const pedir = () => {
      if (!lm.isLocationAvailable) {
        terminar(() => reject(new ErroLocalizacao('indisponivel', MSG_SEM_GPS)))
        return
      }
      // Acesso já negado antes: o Telegram não pergunta de novo; só pelos ajustes.
      if (lm.isAccessRequested && !lm.isAccessGranted) {
        terminar(() =>
          reject(new ErroLocalizacao('permissao', MSG_SEM_PERMISSAO, () => lm.openSettings())),
        )
        return
      }
      lm.getLocation((dados) => {
        if (!dados) {
          terminar(() =>
            reject(new ErroLocalizacao('permissao', MSG_SEM_PERMISSAO, () => lm.openSettings())),
          )
          return
        }
        terminar(() =>
          resolve({
            latitude: dados.latitude,
            longitude: dados.longitude,
            precisao: typeof dados.horizontal_accuracy === 'number' ? dados.horizontal_accuracy : null,
          }),
        )
      })
    }
    try {
      if (lm.isInited) pedir()
      else lm.init(pedir)
    } catch {
      terminar(() => reject(new ErroLocalizacao('indisponivel', MSG_SEM_GPS)))
    }
  })
}

function viaNavegador(): Promise<Posicao> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new ErroLocalizacao('indisponivel', MSG_SEM_GPS))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          latitude: p.coords.latitude,
          longitude: p.coords.longitude,
          precisao: Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : null,
        }),
      (e) => {
        if (e.code === 1) reject(new ErroLocalizacao('permissao', MSG_SEM_PERMISSAO))
        else if (e.code === 3) reject(new ErroLocalizacao('tempo', MSG_TEMPO))
        else reject(new ErroLocalizacao('indisponivel', MSG_SEM_GPS))
      },
      { enableHighAccuracy: true, timeout: TEMPO_LIMITE_MS, maximumAge: 0 },
    )
  })
}

/** Posição atual: `LocationManager` do Telegram (8.0+) quando existir; senão o GPS do navegador. */
export function obterPosicao(): Promise<Posicao> {
  const lm = localizacaoDoTelegram()
  return lm ? viaTelegram(lm) : viaNavegador()
}
