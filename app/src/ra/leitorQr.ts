/**
 * Leitura do QR no vídeo. Usa o `BarcodeDetector` do navegador quando existe (Android) e,
 * senão, o `jsQR` (carregado sob demanda).
 */
import { recorteVisivel } from './camera.ts'
import type { Ponto2 } from './pose.ts'

export interface QrLido {
  texto: string
  /** Cantos em NDC: superior esquerdo, superior direito, inferior direito, inferior esquerdo. */
  cantos: [Ponto2, Ponto2, Ponto2, Ponto2]
}

interface DetectorNativo {
  detect(fonte: CanvasImageSource): Promise<{ rawValue: string; cornerPoints: { x: number; y: number }[] }[]>
}

const LADO_LEITURA = 960

type Leitor = (canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) => Promise<{ texto: string; px: Ponto2[] } | null>

async function criarLeitor(): Promise<Leitor> {
  const Nativo = (globalThis as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => DetectorNativo })
    .BarcodeDetector
  if (Nativo) {
    try {
      const detector = new Nativo({ formats: ['qr_code'] })
      return async (canvas) => {
        const [achado] = await detector.detect(canvas)
        if (!achado || achado.cornerPoints.length !== 4) return null
        return { texto: achado.rawValue, px: achado.cornerPoints.map((p): Ponto2 => [p.x, p.y]) }
      }
    } catch {
      // Sem suporte a QR no detector nativo: cai no jsQR.
    }
  }
  const { default: jsQR } = await import('jsqr')
  return async (canvas, ctx) => {
    const imagem = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const achado = jsQR(imagem.data, imagem.width, imagem.height, { inversionAttempts: 'dontInvert' })
    if (!achado) return null
    const l = achado.location
    return {
      texto: achado.data,
      px: [l.topLeftCorner, l.topRightCorner, l.bottomRightCorner, l.bottomLeftCorner].map((p): Ponto2 => [p.x, p.y]),
    }
  }
}

export interface LeitorQr {
  /** Lê o quadro atual (a parte visível do vídeo); null se não houver QR. */
  ler(video: HTMLVideoElement, aspectoTela: number): Promise<QrLido | null>
}

export async function criarLeitorQr(): Promise<LeitorQr> {
  const leitor = await criarLeitor()
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  return {
    async ler(video, aspectoTela) {
      if (!ctx || !video.videoWidth || !video.videoHeight) return null
      const r = recorteVisivel(video.videoWidth, video.videoHeight, aspectoTela)
      const fator = Math.min(1, LADO_LEITURA / Math.max(r.sw, r.sh))
      canvas.width = Math.max(1, Math.round(r.sw * fator))
      canvas.height = Math.max(1, Math.round(r.sh * fator))
      ctx.drawImage(video, r.sx, r.sy, r.sw, r.sh, 0, 0, canvas.width, canvas.height)
      let achado: Awaited<ReturnType<Leitor>>
      try {
        achado = await leitor(canvas, ctx)
      } catch {
        return null
      }
      if (!achado) return null
      const cantos = achado.px.map(([x, y]): Ponto2 => [(x / canvas.width) * 2 - 1, 1 - (y / canvas.height) * 2])
      return { texto: achado.texto, cantos: cantos as QrLido['cantos'] }
    },
  }
}
