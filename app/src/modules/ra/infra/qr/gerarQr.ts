/** Matriz e caminho SVG do QR (docs/contrato-ra.md, seção "QR"). */
import QRCode from 'qrcode'

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
