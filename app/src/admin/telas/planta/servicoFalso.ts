/**
 * `ServicoPdf` de teste: uma página sintética (spans montados a partir de um ambientes.json),
 * sem pdf.js nem canvas. Imagens são data URLs mínimas; WebP são bytes "RIFF....WEBP".
 */
import type { DocumentoPdf, PaginaAberta, ServicoPdf } from '../../planta/servico.ts'
import type { Span } from '../../planta/tipos.ts'

const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='

interface AmbienteJson {
  nome_planta: string | null
  area_m2: number | null
  marcadores: { x: number; y: number }[]
}

/** Spans de rótulo (nome + "A=xx m²") na posição de cada pino de um ambientes.json. */
export function spansDosAmbientes(ambientes: AmbienteJson[], largura: number, altura: number): Span[] {
  const spans: Span[] = []
  for (const a of ambientes) {
    if (a.nome_planta === null) continue
    for (const m of a.marcadores) {
      const cx = m.x * largura
      const topo = m.y * altura
      const w = 4 * a.nome_planta.length
      spans.push({ text: a.nome_planta, bbox: [cx - w / 2, topo, cx + w / 2, topo + 6.6], size: 5.5, direction: [1, 0] })
      const area = a.area_m2 === null ? 'Não incluso' : a.area_m2.toFixed(2)
      spans.push({ text: `A=${area} m²`, bbox: [cx - 15, topo + 7.7, cx + 15, topo + 14.3], size: 5.5, direction: [1, 0] })
    }
  }
  return spans
}

export function criarServicoFalso(spans: Span[], largura = 2908.32, altura = 1683.72, paginas = 1): ServicoPdf {
  const blob = (tipo: string) => new Blob([new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80])], { type: tipo })
  const pagina = (numero: number): PaginaAberta => ({
    numero,
    largura,
    altura,
    spans,
    previa: async (larguraPx) => ({ url: PNG_1PX, largura: larguraPx, altura: Math.round((larguraPx * altura) / largura) }),
    recorte: async (img) => ({ url: PNG_1PX, largura: img.largura, altura: img.altura }),
    webp: async () => blob('image/webp'),
    prova: async (img) => ({ url: PNG_1PX, largura: img.largura, altura: img.altura, blob: blob('image/png') }),
  })
  return {
    async abrir(): Promise<DocumentoPdf> {
      return { paginas, pagina: async (n) => pagina(n), fechar: async () => {} }
    },
  }
}
