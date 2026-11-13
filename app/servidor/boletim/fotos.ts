/**
 * Fotos do boletim: baixadas do Storage (bucket `fotos`, com a chave secreta), reduzidas a no
 * máximo 1000 px no lado maior, JPEG ~75%, e embutidas no HTML como data URL. Uma foto que não
 * baixa ou não abre vira o quadro "foto indisponível" (o boletim sai mesmo assim).
 */
import sharp from 'sharp'

export const LADO_MAXIMO = 1000
export const QUALIDADE_JPEG = 75

/** Reduz (sem ampliar) e converte para JPEG, respeitando a orientação EXIF. */
export async function reduzirFoto(bytes: Uint8Array, ladoMaximo = LADO_MAXIMO, qualidade = QUALIDADE_JPEG): Promise<Buffer> {
  return sharp(bytes, { failOn: 'error' })
    .rotate()
    .resize({ width: ladoMaximo, height: ladoMaximo, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: qualidade, mozjpeg: true })
    .toBuffer()
}

export interface OpcoesFotos {
  concorrencia?: number
  ladoMaximo?: number
  qualidade?: number
  /** Registro de falhas (uma linha por foto). */
  aviso?: (mensagem: string) => void
}

/** Caminho → data URL JPEG (ou null quando a foto não pôde ser usada). */
export async function prepararFotos(
  caminhos: string[],
  baixar: (caminho: string) => Promise<Uint8Array>,
  o: OpcoesFotos = {},
): Promise<Map<string, string | null>> {
  const resultado = new Map<string, string | null>()
  const fila = [...new Set(caminhos)]
  const trabalhador = async () => {
    for (let c = fila.shift(); c !== undefined; c = fila.shift()) {
      try {
        const jpeg = await reduzirFoto(await baixar(c), o.ladoMaximo, o.qualidade)
        resultado.set(c, `data:image/jpeg;base64,${jpeg.toString('base64')}`)
      } catch (e) {
        o.aviso?.(`Foto ${c} não usada: ${e instanceof Error ? e.message : String(e)}`)
        resultado.set(c, null)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, o.concorrencia ?? 4) }, trabalhador))
  return resultado
}

/** Bytes de uma imagem qualquer como data URL (logo da OM, imagem do clima). */
export function dataUrl(bytes: Uint8Array, tipo: string): string {
  return `data:${tipo};base64,${Buffer.from(bytes).toString('base64')}`
}

/** Tipo da imagem pelos primeiros bytes (PNG, JPEG ou WebP). */
export function tipoDaImagem(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp'
  return 'application/octet-stream'
}
