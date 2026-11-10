/** Tipos do domínio usados pelo app (independentes da origem dos dados). */

/** Marcador normalizado na página do PDF (0 a 1, origem no canto superior esquerdo). */
export interface Marcador {
  x: number
  y: number
}

/** `[x0, y0, x1, y1]` em pontos do PDF, origem no canto superior esquerdo. */
export type RecortePt = [number, number, number, number]

export interface ObraResumo {
  id: string
  slug: string
  nome: string
}

export interface ImagemPlanta {
  /** Caminho no bucket `plantas`: `<obra_id>/<revisao>/<pavimento>/...`. */
  path: string
  largura: number
  altura: number
}

export interface Planta {
  id: string
  revisao: string
  /** `[largura, altura]` da página, em pontos. */
  pagina_pt: [number, number]
  recorte_pt: RecortePt
  imagem: ImagemPlanta
  imagem_hd: ImagemPlanta | null
}

export interface Pavimento {
  id: string
  codigo: string
  nome: string
  ordem: number
  /** Planta ativa do pavimento; `null` se ainda não foi publicada. */
  planta: Planta | null
}

export interface Ambiente {
  id: string
  codigo: string
  pavimento_codigo: string
  nome_operacional: string
  nome_planta: string
  categoria: string
  area_m2: number | null
  marcadores: Marcador[]
  pendencias_abertas: number
}

export interface ObraDetalhe {
  obra: ObraResumo
  pavimentos: Pavimento[]
  ambientes: Ambiente[]
}

export interface DetalhePlanta {
  imagem: ImagemPlanta
  recorte_pt: RecortePt
}

export interface AmbienteDetalhe {
  obra: ObraResumo
  ambiente: Ambiente
  pavimento: Pavimento
  planta: Planta | null
  detalhe: DetalhePlanta | null
}

export type TipoRegistro = 'servico' | 'pendencia'
export type SituacaoRegistro = 'aberta' | 'resolvida'

export type EstadoPublicacao = 'pendente' | 'enviando' | 'publicado' | 'incerto' | 'falhou'

export interface FotoRegistro {
  id: string
  /** Caminho no bucket `fotos`: `<obra_id>/<registro_id>/<foto_id>.jpg`. */
  path: string
  largura: number
  altura: number
}

export interface RegistroResumo {
  id: string
  tipo: TipoRegistro
  situacao: SituacaoRegistro | null
  legenda: string
  autor: string
  capturado_em: string
  recebido_em: string
  ambiente: { id: string; codigo: string; nome: string }
  obra: { id: string; slug: string; nome: string }
  /** Ordenadas por `ordem`. */
  fotos: FotoRegistro[]
  /** `null` se o registro não tem publicação (ou ela não é visível). */
  publicacao: EstadoPublicacao | null
}

export interface NovoRegistro {
  id: string
  ambienteId: string
  tipo: TipoRegistro
  legenda: string
  /** ISO. */
  capturadoEm: string
  /** Na ordem escolhida. */
  fotos: { id: string; largura: number; altura: number; bytes: number }[]
}

export interface CaminhoFoto {
  obraId: string
  registroId: string
  fotoId: string
}

export interface FiltroRegistros {
  obraId?: string
  ambienteId?: string
  tipo?: TipoRegistro
  situacao?: SituacaoRegistro
  limite?: number
}
