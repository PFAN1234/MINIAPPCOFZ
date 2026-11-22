/**
 * Snapshot do BCF (PNG ou JPEG) → PNG de até 5 MB, no navegador. PNG que já cabe passa direto;
 * JPEG (ou PNG grande) é desenhado num canvas e, se o PNG passar do limite, reduzido em 25% por vez.
 */
import { IMAGEM_VISTA_MAX_BYTES } from '../../domain/issues.ts'

function tipoDe(b: Uint8Array): 'image/png' | 'image/jpeg' | null {
  if (b.length > 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  return null
}

export async function snapshotParaPng(bytes: Uint8Array, max = IMAGEM_VISTA_MAX_BYTES): Promise<Blob> {
  const tipo = tipoDe(bytes)
  if (!tipo) throw new Error('Formato de imagem não suportado.')
  const copia = new Uint8Array(bytes)
  if (tipo === 'image/png' && copia.byteLength <= max) return new Blob([copia], { type: 'image/png' })

  const bitmap = await createImageBitmap(new Blob([copia], { type: tipo }))
  try {
    let escala = 1
    for (let i = 0; i < 8; i++) {
      const largura = Math.max(1, Math.round(bitmap.width * escala))
      const altura = Math.max(1, Math.round(bitmap.height * escala))
      const tela = document.createElement('canvas')
      tela.width = largura
      tela.height = altura
      const ctx = tela.getContext('2d')
      if (!ctx) throw new Error('Canvas indisponível.')
      ctx.drawImage(bitmap, 0, 0, largura, altura)
      const png = await new Promise<Blob | null>((ok) => tela.toBlob(ok, 'image/png'))
      if (png && png.size <= max) return png
      escala *= 0.75
    }
  } finally {
    bitmap.close()
  }
  throw new Error('Não foi possível reduzir a imagem a 5 MB.')
}
