/** Câmera traseira ao vivo, recorte visível do vídeo e captura do par de fotos da RA. */

export const MENSAGEM_SEM_CAMERA = 'Este aparelho não permite abrir a câmera dentro do app.'
export const MENSAGEM_CAMERA_NEGADA =
  'O acesso à câmera foi negado. Libere a câmera para o Telegram nos ajustes do aparelho e tente de novo.'

/** Abre a câmera traseira no `<video>`. Lança `Error` com mensagem para o usuário. */
export async function abrirCamera(video: HTMLVideoElement): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error(MENSAGEM_SEM_CAMERA)
  let fluxo: MediaStream
  try {
    fluxo = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    })
  } catch (e) {
    const nome = e instanceof DOMException ? e.name : ''
    throw new Error(
      nome === 'NotAllowedError' || nome === 'SecurityError' ? MENSAGEM_CAMERA_NEGADA : MENSAGEM_SEM_CAMERA,
      { cause: e },
    )
  }
  video.srcObject = fluxo
  video.muted = true
  video.playsInline = true
  try {
    await video.play()
  } catch {
    // Alguns navegadores só tocam depois de um toque; o atributo autoplay cobre o resto.
  }
  return fluxo
}

export function fecharCamera(fluxo: MediaStream | null): void {
  for (const faixa of fluxo?.getTracks() ?? []) faixa.stop()
}

export interface Recorte {
  sx: number
  sy: number
  sw: number
  sh: number
}

/** Parte do vídeo que aparece na tela com `object-fit: cover`. */
export function recorteVisivel(larguraVideo: number, alturaVideo: number, aspectoTela: number): Recorte {
  const aspectoVideo = larguraVideo / alturaVideo
  if (aspectoVideo > aspectoTela) {
    const sw = alturaVideo * aspectoTela
    return { sx: (larguraVideo - sw) / 2, sy: 0, sw, sh: alturaVideo }
  }
  const sh = larguraVideo / aspectoTela
  return { sx: 0, sy: (alturaVideo - sh) / 2, sw: larguraVideo, sh }
}

const LADO_MAXIMO = 1920

function paraJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Não foi possível gerar a foto.'))), 'image/jpeg', 0.85)
  })
}

export interface ParCapturado {
  limpa: Blob
  comModelo: Blob
  largura: number
  altura: number
}

/**
 * Captura o quadro atual do vídeo duas vezes: limpo e com o canvas 3D por cima, mais a faixa
 * de identificação. `renderizar` deve desenhar a cena no `canvas3d` de forma síncrona.
 */
export async function capturarPar(opcoes: {
  video: HTMLVideoElement
  canvas3d: HTMLCanvasElement
  renderizar: () => void
  opacidade: number
  aspectoTela: number
  faixa: string[]
}): Promise<ParCapturado> {
  const { video, canvas3d, renderizar, opacidade, aspectoTela, faixa } = opcoes
  if (!video.videoWidth || !video.videoHeight) throw new Error('A câmera ainda não está pronta.')
  const r = recorteVisivel(video.videoWidth, video.videoHeight, aspectoTela)
  const fator = Math.min(1, LADO_MAXIMO / Math.max(r.sw, r.sh))
  const largura = Math.max(1, Math.round(r.sw * fator))
  const altura = Math.max(1, Math.round(r.sh * fator))

  const canvas = document.createElement('canvas')
  canvas.width = largura
  canvas.height = altura
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Não foi possível gerar a foto.')
  ctx.drawImage(video, r.sx, r.sy, r.sw, r.sh, 0, 0, largura, altura)
  const limpa = await paraJpeg(canvas)

  // O mesmo quadro continua no canvas; o 3D entra por cima.
  renderizar()
  ctx.globalAlpha = opacidade
  ctx.drawImage(canvas3d, 0, 0, largura, altura)
  ctx.globalAlpha = 1

  const tamanho = Math.max(14, Math.round(largura * 0.026))
  const linha = Math.round(tamanho * 1.35)
  const alturaFaixa = linha * faixa.length + Math.round(tamanho * 0.9)
  ctx.fillStyle = 'rgba(11, 22, 37, 0.82)'
  ctx.fillRect(0, altura - alturaFaixa, largura, alturaFaixa)
  ctx.fillStyle = '#FFFFFF'
  ctx.font = `600 ${tamanho}px Barlow, system-ui, sans-serif`
  ctx.textBaseline = 'top'
  faixa.forEach((texto, i) => {
    ctx.fillText(texto, Math.round(tamanho * 0.7), altura - alturaFaixa + Math.round(tamanho * 0.45) + i * linha, largura - tamanho * 1.4)
  })
  const comModelo = await paraJpeg(canvas)
  return { limpa, comModelo, largura, altura }
}
