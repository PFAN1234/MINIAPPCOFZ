/** Preparo das fotos no cliente: orientação, redução e recodificação em JPEG. */

export interface FotoPreparada {
  id: string
  blob: Blob
  largura: number
  altura: number
  bytes: number
}

export const LADO_MAXIMO_PADRAO = 1920
export const QUALIDADE_PADRAO = 0.8
export const MENSAGEM_FOTO_ILEGIVEL =
  'Não foi possível ler esta foto. Tente outra ou tire pela câmera.'

/** Tamanho final: o maior lado vira `ladoMaximo`, mantendo a proporção; nunca amplia. */
export function dimensoesAlvo(
  largura: number,
  altura: number,
  ladoMaximo: number = LADO_MAXIMO_PADRAO,
): { largura: number; altura: number } {
  const maior = Math.max(largura, altura)
  if (maior <= ladoMaximo) return { largura, altura }
  const fator = ladoMaximo / maior
  return {
    largura: Math.max(1, Math.round(largura * fator)),
    altura: Math.max(1, Math.round(altura * fator)),
  }
}

/**
 * Valor de `capturado_em` (ISO): o menor `lastModified` entre os arquivos,
 * limitado a `agora`; vale `agora` se não houver nenhum (o servidor recusa
 * datas mais de 5 min no futuro).
 */
export function capturadoEm(arquivos: File[], agora: Date = new Date()): string {
  const tempos = arquivos.map((a) => a.lastModified).filter((t) => Number.isFinite(t) && t > 0)
  if (tempos.length === 0) return agora.toISOString()
  return new Date(Math.min(Math.min(...tempos), agora.getTime())).toISOString()
}

interface Decodificada {
  fonte: CanvasImageSource
  largura: number
  altura: number
  liberar: () => void
}

async function decodificar(arquivo: File): Promise<Decodificada> {
  if (typeof createImageBitmap === 'function') {
    const bmp = await createImageBitmap(arquivo, { imageOrientation: 'from-image' })
    return { fonte: bmp, largura: bmp.width, altura: bmp.height, liberar: () => bmp.close() }
  }
  // Alternativa: o <img> aplica a rotação do EXIF por conta própria nos navegadores atuais.
  const url = URL.createObjectURL(arquivo)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return {
      fonte: img,
      largura: img.naturalWidth,
      altura: img.naturalHeight,
      liberar: () => URL.revokeObjectURL(url),
    }
  } catch (e) {
    URL.revokeObjectURL(url)
    throw e
  }
}

async function paraJpeg(
  fonte: CanvasImageSource,
  largura: number,
  altura: number,
  qualidade: number,
): Promise<Blob> {
  if (typeof OffscreenCanvas === 'function') {
    const canvas = new OffscreenCanvas(largura, altura)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('sem contexto 2d')
    ctx.drawImage(fonte, 0, 0, largura, altura)
    return canvas.convertToBlob({ type: 'image/jpeg', quality: qualidade })
  }
  const canvas = document.createElement('canvas')
  canvas.width = largura
  canvas.height = altura
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('sem contexto 2d')
  ctx.drawImage(fonte, 0, 0, largura, altura)
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob sem resultado'))),
      'image/jpeg',
      qualidade,
    )
  })
}

/**
 * Decodifica (com a rotação do EXIF), reduz e recodifica em JPEG. A
 * recodificação descarta todo o EXIF, inclusive a localização.
 * Falha com `MENSAGEM_FOTO_ILEGIVEL` se o arquivo não puder ser lido.
 */
export async function prepararFoto(
  arquivo: File,
  opcoes: { ladoMaximo?: number; qualidade?: number } = {},
): Promise<FotoPreparada> {
  const { ladoMaximo = LADO_MAXIMO_PADRAO, qualidade = QUALIDADE_PADRAO } = opcoes
  try {
    const dec = await decodificar(arquivo)
    try {
      if (!(dec.largura > 0 && dec.altura > 0)) throw new Error('imagem vazia')
      const { largura, altura } = dimensoesAlvo(dec.largura, dec.altura, ladoMaximo)
      const blob = await paraJpeg(dec.fonte, largura, altura, qualidade)
      if (blob.size === 0) throw new Error('JPEG vazio')
      return { id: crypto.randomUUID(), blob, largura, altura, bytes: blob.size }
    } finally {
      dec.liberar()
    }
  } catch {
    throw new Error(MENSAGEM_FOTO_ILEGIVEL)
  }
}
