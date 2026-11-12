/**
 * Tipos da planta no site de administração (fase 2). Espelham os JSON dos scripts Python:
 * `data/<slug>/obra.json` (configuração), `data/<slug>/ambientes.json` (saída do extrator) e
 * `data/<slug>/plantas.json` (manifesto das imagens). Coordenadas normalizadas na página do PDF
 * (0–1, origem no canto superior esquerdo); recortes em pontos PDF.
 */

export type Retangulo = [number, number, number, number]

/** Span de texto como o `spans_da_pagina` do extrator (PyMuPDF): bbox em pontos, 3 casas. */
export interface Span {
  text: string
  bbox: Retangulo
  size: number
  direction: [number, number]
}

/** Página lida do PDF: o que o extrator usa de cada pavimento. */
export interface PaginaLida {
  largura: number
  altura: number
  spans: Span[]
}

export interface Mascara {
  retangulo: Retangulo
  descricao?: string
}

export interface Prancha {
  observacao?: string
  recorte_edificio: Retangulo
  mascaras?: Mascara[]
}

export interface PavimentoConfig {
  codigo: string
  nome: string
  ordem?: number
  pdf: string
  pagina?: number
}

export interface Renomear {
  pavimento: string
  nome_planta: string
  area_m2: number | null
  nome_operacional: string
}

export interface AmbienteManual {
  pavimento: string
  nome_operacional: string
  categoria: string
  /** Primeiro pino (o único, se não houver `marcadores`). */
  marcador: { x: number; y: number }
  /** Todos os pinos, quando o ambiente tem mais de um (o primeiro igual a `marcador`). */
  marcadores?: { x: number; y: number }[]
  observacao?: string
}

/** Pinos definidos no editor para um ambiente (por id final), válidos só na revisão indicada. */
export interface AjusteMarcadores {
  revisao: string
  marcadores: { x: number; y: number }[]
}

export type StatusConfig = 'revisado' | 'aguardando_revisao_humana'

/** Configuração da obra no formato do `obra.json` (com slug e nome). */
export interface ObraConfig {
  slug: string
  nome: string
  status: StatusConfig
  revisao: string
  pasta_pdf: string
  pavimentos: PavimentoConfig[]
  prancha: Prancha
  nomes_fixos?: Record<string, string>
  categorias?: Record<string, string>
  renomear?: Renomear[]
  ambientes_manuais?: AmbienteManual[]
  manter_codigo?: Record<string, string>
  /** Só no site (o extrator Python ignora): pinos arrastados ou removidos no editor. */
  marcadores_ajustados?: Record<string, AjusteMarcadores>
  revisao_humana?: unknown
  [chave: string]: unknown
}

export interface Marcador {
  x: number
  y: number
  rotulo_bbox: Retangulo
}

export interface Ambiente {
  id: string
  pavimento: string
  nome_operacional: string
  nome_planta: string | null
  categoria: string
  area_m2: number | null
  pdf: string
  pagina: number
  revisao: string
  marcadores: Marcador[]
}

export interface ItemRevisar {
  pavimento: string
  motivo: string
  rotulo?: string
  nome?: string
  nomes?: string[]
}

export interface Removido {
  id: string
  pavimento: string
  nome_operacional: string
  revisao_ultima?: string | null
}

export interface PontoXY {
  x: number
  y: number
}

export interface Sucessor {
  id: string
  nome_operacional: string
  motivo: string
}

export interface Diferencas {
  revisao_base: string | null
  novos: { id: string; pavimento: string; nome_operacional: string; area_m2: number | null }[]
  removidos: {
    id: string
    pavimento: string
    nome_operacional: string
    nome_planta: string | null
    area_m2: number | null
    revisao_ultima: string | null
    marcadores: PontoXY[]
    sucessor_sugerido: Sucessor | null
  }[]
  herdados: {
    id: string
    id_calculado: string
    pavimento: string
    nome_antes: string | null
    nome_operacional: string
    reativado: boolean
  }[]
  nome_alterado: { id: string; antes: string; depois: string }[]
  area_alterada: { id: string; nome_operacional: string; antes: number | null; depois: number | null }[]
  marcador_deslocado: {
    id: string
    nome_operacional: string
    distancia: number | null
    antes: PontoXY[]
    depois: PontoXY[]
  }[]
}

/** Conteúdo do `ambientes.json`. */
export interface ResultadoExtracao {
  obra: string
  fonte: string
  status: StatusConfig
  revisao_humana: unknown
  coordenadas: string
  pavimentos: { id: string; nome: string }[]
  ambientes: Ambiente[]
  revisar: ItemRevisar[]
  ambientes_removidos: Removido[]
  diferencas: Diferencas
}

/** Base anterior (o `ambientes.json` de antes, ou o estado do banco). */
export interface BaseExtracao {
  ambientes?: {
    id: string
    pavimento: string
    nome_operacional: string
    nome_planta?: string | null
    area_m2?: number | null
    revisao?: string | null
    marcadores?: PontoXY[]
  }[]
  ambientes_removidos?: Removido[]
  diferencas?: Diferencas | null
}

/** Erro de configuração ou de dados (no Python, `SystemExit` com a mesma mensagem). */
export class ErroPlanta extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ErroPlanta'
  }
}
