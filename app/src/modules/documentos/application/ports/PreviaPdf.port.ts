/** Prévia de PDF no navegador (pdf.js); nos testes entra uma implementação falsa. */
export interface PdfPrevia {
  paginas: number
  /** Tamanho da página (1-based) em pontos, na escala 1. */
  tamanho(pagina: number): Promise<{ largura: number; altura: number }>
  /** Desenha a página no canvas, na resolução física; cancela o desenho anterior do mesmo canvas. */
  desenhar(pagina: number, escala: number, canvas: HTMLCanvasElement): Promise<void>
  fechar(): void
}

export interface PreviaPdf {
  abrirPdf(bytes: Uint8Array): Promise<PdfPrevia>
}
