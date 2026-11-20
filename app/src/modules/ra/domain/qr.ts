/**
 * QR code do ambiente (usado pelo Mini App para alinhar a realidade aumentada). A matriz de
 * módulos vem do pacote `qrcode`; o desenho em SVG é nosso, para controlar o tamanho exato
 * na impressão (docs/contrato-ra.md, seção "QR").
 */

export const APP_PADRAO = 'fiscalcofz'

/** Link do ambiente: `https://t.me/<bot>/<app>?startapp=amb_<slug>_<codigo>`. */
export function textoQr(bot: string, app: string, slug: string, codigo: string): string {
  const limpo = (s: string) => s.replace(/^@/, '').trim()
  return `https://t.me/${limpo(bot)}/${limpo(app) || APP_PADRAO}?startapp=amb_${slug}_${codigo}`
}
