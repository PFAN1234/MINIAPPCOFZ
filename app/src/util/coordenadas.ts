import type { Marcador, RecortePt } from '../dados/tipos.ts'

export interface ReferenciaImagem {
  /** `[largura, altura]` da página do PDF, em pontos. */
  pagina_pt: readonly [number, number]
  recorte_pt: Readonly<RecortePt>
  /** Tamanho em pixels da imagem. */
  largura: number
  altura: number
}

/**
 * Converte um marcador normalizado na página (0 a 1) para pixels da imagem
 * recortada. O ponto é o centro do rótulo no topo do nome; o pino fica acima.
 */
export function marcadorParaPixel(
  marcador: Marcador,
  { pagina_pt, recorte_pt, largura, altura }: ReferenciaImagem,
): { x: number; y: number } {
  const [x0, y0, x1, y1] = recorte_pt
  return {
    x: ((marcador.x * pagina_pt[0] - x0) * largura) / (x1 - x0),
    y: ((marcador.y * pagina_pt[1] - y0) * altura) / (y1 - y0),
  }
}
