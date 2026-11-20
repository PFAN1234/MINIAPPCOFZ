/** Tipos puros do contexto obras (lado Mini App): obras, etapas, pavimentos, ambientes e organização. */
import type { PapelObra } from '@modules/acessos/domain/tipos.ts'
import type { Marcador, RecortePt } from '@shared/kernel/tipos.ts'

export interface ObraResumo {
  id: string
  slug: string
  nome: string
}

/** Etapa de implantação do campus: agrupa obras (e tem um grupo do Telegram). */
export interface Etapa {
  id: string
  slug: string
  nome: string
  ordem: number
}

/** Obra da tela inicial (`listarObras`), com a etapa a que pertence. */
export interface ObraDaLista extends ObraResumo {
  etapa: Etapa
}

/** Identidade da organização militar (RPC `organizacao`). */
export interface Organizacao {
  nome: string
  /** URL pública do logo no bucket `organizacao`; `null` se não houver logo. */
  logo_url: string | null
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
  nome_planta: string | null
  categoria: string
  area_m2: number | null
  marcadores: Marcador[]
  pendencias_abertas: number
  /**
   * `false` quando o ambiente não existe na planta vigente (saiu numa revisão).
   * Fica fora da lista, da busca e da planta, mas a tela dele abre (histórico).
   */
  ativo: boolean
}

/** Totais de uma obra para o Início (`resumo_obras`): serviços de sempre, pendências abertas e resolvidas. */
export interface ResumoObra {
  obra_id: string
  /** Papel do usuário na obra; `null` quando vê a obra sem participar (admin). */
  papel: PapelObra | null
  servicos: number
  abertas: number
  resolvidas: number
}

export interface ObraDetalhe {
  obra: ObraResumo
  /** Papel do usuário na obra (da própria participação). */
  papel: PapelObra
  pavimentos: Pavimento[]
  /** Todos os ambientes, inclusive os inativos (as telas filtram por `ativo`). */
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

/** Etapa da tela inicial (`etapas_inicio`): todas as ativas, com a participação do usuário. */
export interface EtapaInicio {
  id: string
  slug: string
  nome: string
  ordem: number
  participa: boolean
}
