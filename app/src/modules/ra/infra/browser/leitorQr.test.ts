import jsQR from 'jsqr'
import QRCode from 'qrcode'
import { describe, expect, it } from 'vitest'

/** Desenha o QR num RGBA com `modulo` pixels por módulo e `margem` pixels brancos em volta. */
function imagemDoQr(texto: string, modulo: number, margem: number) {
  const qr = QRCode.create(texto, { errorCorrectionLevel: 'M' })
  const n = qr.modules.size
  const lado = n * modulo + margem * 2
  const dados = new Uint8ClampedArray(lado * lado * 4).fill(255)
  for (let y = 0; y < n * modulo; y++) {
    for (let x = 0; x < n * modulo; x++) {
      if (!qr.modules.get(Math.floor(y / modulo), Math.floor(x / modulo))) continue
      const i = ((y + margem) * lado + x + margem) * 4
      dados[i] = dados[i + 1] = dados[i + 2] = 0
    }
  }
  return { dados, lado, ladoQr: n * modulo }
}

describe('leitura do QR', () => {
  it('o jsQR devolve o texto e os cantos externos do QR, na ordem usada pela pose', () => {
    const texto = 'https://t.me/diarioobra_cofz_bot/fiscalcofz?startapp=amb_hto_terreo-apto-101'
    const margem = 40
    const { dados, lado, ladoQr } = imagemDoQr(texto, 6, margem)
    const lido = jsQR(dados, lado, lado, { inversionAttempts: 'dontInvert' })!
    expect(lido.data).toBe(texto)
    const l = lido.location
    const esperado = [
      [l.topLeftCorner, margem, margem],
      [l.topRightCorner, margem + ladoQr, margem],
      [l.bottomRightCorner, margem + ladoQr, margem + ladoQr],
      [l.bottomLeftCorner, margem, margem + ladoQr],
    ] as const
    // Tolerância de um módulo: o que importa é serem os cantos de fora, não os dos marcadores.
    for (const [p, x, y] of esperado) {
      expect(Math.abs(p.x - x)).toBeLessThan(6)
      expect(Math.abs(p.y - y)).toBeLessThan(6)
    }
  })
})
