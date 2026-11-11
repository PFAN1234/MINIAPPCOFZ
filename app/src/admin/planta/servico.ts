/**
 * Interface do processamento de PDF usada pelo editor. A implementação do navegador
 * (`servicoNavegador.ts`, carregada sob demanda com o pdf.js) fica fora das telas, para os
 * testes das telas usarem uma página sintética sem pdf.js nem canvas.
 */
import type { ImagemCalculada } from './plantas.ts'
import type { PaginaLida, Retangulo } from './tipos.ts'

export interface ImagemGerada {
  /** Object URL (ou data URL) para exibir. */
  url: string
  largura: number
  altura: number
}

export interface PaginaAberta extends PaginaLida {
  numero: number
  /** A página inteira com `larguraPx` de largura (para desenhar recorte e máscaras). */
  previa(larguraPx: number): Promise<ImagemGerada>
  /** Um recorte com as máscaras, para exibir. */
  recorte(img: ImagemCalculada, mascaras: Retangulo[]): Promise<ImagemGerada>
  /** O mesmo recorte em WebP, para enviar. */
  webp(img: ImagemCalculada, mascaras: Retangulo[]): Promise<Blob>
  /** Prova: visão geral com todos os pinos, em PNG. */
  prova(img: ImagemCalculada, mascaras: Retangulo[], pinos: { x: number; y: number }[]): Promise<ImagemGerada & { blob: Blob }>
}

export interface DocumentoPdf {
  paginas: number
  pagina(numero: number): Promise<PaginaAberta>
  fechar(): Promise<void>
}

export interface ServicoPdf {
  abrir(bytes: Uint8Array): Promise<DocumentoPdf>
}

/** SHA-256 em hexadecimal (Web Crypto). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
