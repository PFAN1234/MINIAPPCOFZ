/**
 * QR code do ambiente (usado pelo Mini App para alinhar a realidade aumentada). A matriz de
 * módulos vem do pacote `qrcode`; o desenho em SVG é nosso, para controlar o tamanho exato
 * na impressão (docs/contrato-ra.md, seção "QR").
 */
import QRCode from 'qrcode'

export const APP_PADRAO = 'fiscalcofz'

/** Link do ambiente: `https://t.me/<bot>/<app>?startapp=amb_<slug>_<codigo>`. */
export function textoQr(bot: string, app: string, slug: string, codigo: string): string {
  const limpo = (s: string) => s.replace(/^@/, '').trim()
  return `https://t.me/${limpo(bot)}/${limpo(app) || APP_PADRAO}?startapp=amb_${slug}_${codigo}`
}

export interface QrGerado {
  /** Módulos por lado. */
  tamanho: number
  /** `modulos[linha][coluna]`: true = módulo escuro. */
  modulos: boolean[][]
  /** Um único `<path>` (unidade = 1 módulo, sem margem) com todos os módulos escuros. */
  caminho: string
}

/** Gera a matriz do QR (correção de erro M) e o caminho SVG dos módulos escuros. */
export function gerarQr(texto: string): QrGerado {
  const qr = QRCode.create(texto, { errorCorrectionLevel: 'M' })
  const tamanho = qr.modules.size
  const dados = qr.modules.data
  const modulos: boolean[][] = []
  const partes: string[] = []
  for (let l = 0; l < tamanho; l++) {
    const linha: boolean[] = []
    for (let c = 0; c < tamanho; c++) {
      const escuro = Boolean(dados[l * tamanho + c])
      linha.push(escuro)
      if (escuro) partes.push(`M${c} ${l}h1v1h-1z`)
    }
    modulos.push(linha)
  }
  return { tamanho, modulos, caminho: partes.join('') }
}
