/**
 * Port das contas de `scripts/gerar_plantas.py`: recorte do edifício, escalas, tamanho de cada
 * imagem (como o pixmap do PyMuPDF: retângulo arredondado para fora) e janela de detalhe de
 * cada ambiente. Funções puras; a renderização fica em `render.ts`.
 *
 * Conversão de um ponto normalizado da página (x, y) para pixels de uma imagem:
 *   px = (x * largura_pt - recorte_pt[0]) * escala_px_por_pt
 *   py = (y * altura_pt  - recorte_pt[1]) * escala_px_por_pt
 */
import { arredondar } from './spans.ts'
import { ErroPlanta, type Ambiente, type Prancha, type Retangulo } from './tipos.ts'

export const LADO_VISAO_GERAL = 2400
export const LADO_HD = 4096
/** px por ponto PDF. */
export const ESCALA_DETALHE = 4.0
/** largura, altura em pontos PDF. */
export const JANELA_DETALHE: [number, number] = [220.0, 125.0]
export const QUALIDADE_WEBP = 80

/** Recorte do edifício e máscaras normalizados, validados como no Python. */
export function prancha(cfg: Prancha): { recorte: Retangulo; mascaras: Retangulo[] } {
  const recorte = [...cfg.recorte_edificio] as Retangulo
  const mascaras = (cfg.mascaras ?? []).map((m) => [...m.retangulo] as Retangulo)
  for (const r of [recorte, ...mascaras]) {
    if (r.length !== 4 || !(0 <= r[0] && r[0] < r[2] && r[2] <= 1 && 0 <= r[1] && r[1] < r[3] && r[3] <= 1)) {
      throw new ErroPlanta(`retângulo normalizado inválido em obra.json: [${r.join(', ')}]`)
    }
  }
  return { recorte, mascaras }
}

/** Área em pixels do pixmap do MuPDF para `clip` em `escala`: `fz_round_rect` (para fora). */
export function areaPixmap(clip: Retangulo, escala: number): { x0: number; y0: number; largura: number; altura: number } {
  const x0 = Math.floor(clip[0] * escala + 0.001)
  const y0 = Math.floor(clip[1] * escala + 0.001)
  const x1 = Math.ceil(clip[2] * escala - 0.001)
  const y1 = Math.ceil(clip[3] * escala - 0.001)
  return { x0, y0, largura: x1 - x0, altura: y1 - y0 }
}

export interface ImagemCalculada {
  /** Recorte em pontos PDF (sem arredondar). */
  clip: Retangulo
  escala: number
  /** Canto do pixmap em pixels de página × escala. */
  origem: [number, number]
  largura: number
  altura: number
}

export interface PlantaCalculada {
  pagina_pt: [number, number]
  /** `recorte_pt` do manifesto (3 casas). */
  recorte_pt: Retangulo
  mascaras: Retangulo[]
  imagens: { planta: ImagemCalculada; 'planta-hd': ImagemCalculada }
  detalhes: Record<string, ImagemCalculada & { recorte_pt: Retangulo }>
}

function imagem(clip: Retangulo, escala: number): ImagemCalculada {
  const a = areaPixmap(clip, escala)
  return { clip, escala, origem: [a.x0, a.y0], largura: a.largura, altura: a.altura }
}

function intersecao(a: Retangulo, b: Retangulo): Retangulo {
  return [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]
}

/** Janela de detalhe: centrada no rótulo do 1º pino, um pouco abaixo para mostrar o pino acima do nome. */
export function janelaDetalhe(a: Pick<Ambiente, 'marcadores' | 'id'>, largura: number, altura: number): Retangulo {
  const m = a.marcadores[0]
  if (!m) throw new ErroPlanta(`ambiente sem pino: ${a.id}`)
  const rb = m.rotulo_bbox
  const cx = ((rb[0] + rb[2]) / 2) * largura
  const cy = ((rb[1] + rb[3]) / 2) * altura
  const [jw, jh] = JANELA_DETALHE
  return intersecao([cx - jw / 2, cy - jh * 0.45, cx + jw / 2, cy + jh * 0.55], [0, 0, largura, altura])
}

/** Tudo o que o `gerar_plantas.py` calcula para um pavimento, menos os arquivos. */
export function calcularPlanta(
  cfg: Prancha,
  pagina: { largura: number; altura: number },
  ambientes: Pick<Ambiente, 'id' | 'marcadores'>[],
): PlantaCalculada {
  const { recorte, mascaras } = prancha(cfg)
  const w = pagina.largura
  const h = pagina.altura
  const clip: Retangulo = [recorte[0] * w, recorte[1] * h, recorte[2] * w, recorte[3] * h]
  const maior = Math.max(clip[2] - clip[0], clip[3] - clip[1])
  const detalhes: PlantaCalculada['detalhes'] = {}
  for (const a of ambientes) {
    const janela = janelaDetalhe(a, w, h)
    if (!(janela[2] > janela[0] && janela[3] > janela[1])) {
      throw new ErroPlanta(`o pino de ${a.id} está fora da página`)
    }
    detalhes[a.id] = { ...imagem(janela, ESCALA_DETALHE), recorte_pt: janela.map((v) => arredondar(v, 3)) as Retangulo }
  }
  return {
    pagina_pt: [w, h],
    recorte_pt: clip.map((v) => arredondar(v, 3)) as Retangulo,
    mascaras,
    imagens: {
      planta: imagem(clip, LADO_VISAO_GERAL / maior),
      'planta-hd': imagem(clip, LADO_HD / maior),
    },
    detalhes,
  }
}

/** Ponto normalizado da página → pixel da imagem (mesma conta do Python para a prova). */
export function pontoNaImagem(
  x: number,
  y: number,
  pagina: { largura: number; altura: number },
  img: Pick<ImagemCalculada, 'clip' | 'escala'>,
): [number, number] {
  return [(x * pagina.largura - img.clip[0]) * img.escala, (y * pagina.altura - img.clip[1]) * img.escala]
}

/** Máscaras em pixels da imagem (x, y, largura, altura), como o `mascarar` do Python. */
export function mascarasNaImagem(
  mascaras: Retangulo[],
  pagina: { largura: number; altura: number },
  img: Pick<ImagemCalculada, 'clip' | 'escala'>,
): Retangulo[] {
  return mascaras.map(([x0, y0, x1, y1]) => {
    const [a, b] = pontoNaImagem(x0, y0, pagina, img)
    const [c, d] = pontoNaImagem(x1, y1, pagina, img)
    return [a, b, c, d]
  })
}

/** Caminhos no bucket `plantas` (contrato, seção A). */
export function caminhosPlanta(obraId: string, revisao: string, pavimento: string) {
  const base = `${obraId}/${revisao}/${pavimento}`
  return {
    planta: `${base}/planta.webp`,
    hd: `${base}/planta-hd.webp`,
    detalhe: (codigo: string) => `${base}/ambientes/${codigo}.webp`,
  }
}

/** Caminho do PDF original no bucket `originais`. */
export function caminhoOriginal(obraId: string, revisao: string, pavimento: string, sha256: string): string {
  return `${obraId}/${revisao}/${pavimento}/${sha256}.pdf`
}
