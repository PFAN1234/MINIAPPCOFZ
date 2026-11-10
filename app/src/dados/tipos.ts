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

export type PapelObra = 'equipe' | 'gestor'

export interface ObraDetalhe {
  obra: ObraResumo
  /** Papel do usuário na obra (da própria participação). */
  papel: PapelObra
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
  /** `pavimento` (nome) vem preenchido nas consultas do app; opcional para quem monta resumos à mão. */
  ambiente: { id: string; codigo: string; nome: string; pavimento?: string }
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
  /** Slug da obra (usado pelas filtragens vindas da URL). */
  obraSlug?: string
  ambienteId?: string
  /** Código do ambiente; só faz sentido junto com a obra. */
  ambienteCodigo?: string
  tipo?: TipoRegistro
  situacao?: SituacaoRegistro
  limite?: number
}

/** Obra em que o usuário está no grupo do Telegram mas ainda não tem acesso. */
export interface ObraDisponivel {
  id: string
  slug: string
  nome: string
  /** Estado do pedido mais recente; `null` se nunca pediu. */
  solicitacao: 'pendente' | 'recusada' | null
}

/** Pedido de acesso pendente, visto pelo gestor da obra. */
export interface SolicitacaoAcesso {
  id: string
  usuario_id: string
  nome: string
  username: string | null
  criado_em: string
}

export interface RegistroLocalizado {
  slug: string
  /** Código do ambiente do registro. */
  codigo: string
  tipo: TipoRegistro
}

/** Encerramento de uma pendência: fotos de comprovação e observação do gestor. */
export interface Encerramento {
  id: string
  observacao: string | null
  encerrado_em: string
  /** Nome do gestor que encerrou. */
  gestor: string
  /** Ordenadas por `ordem`. */
  fotos: FotoRegistro[]
  publicacao: EstadoPublicacao | null
}

/** Pendência com o contexto da tela de detalhe. */
export interface PendenciaDetalhe {
  registro: RegistroResumo
  pavimento: { codigo: string; nome: string }
  /** Papel do usuário na obra da pendência. */
  papel: PapelObra
  /** `null` enquanto a pendência está aberta. */
  encerramento: Encerramento | null
}

export interface NovoEncerramento {
  /** Id do encerramento (gerado no cliente, chave de idempotência). */
  id: string
  /** Id da pendência. */
  registroId: string
  obraId: string
  observacao: string
  /** Na ordem escolhida. */
  fotos: { id: string; largura: number; altura: number; bytes: number }[]
}

export interface Participante {
  usuario_id: string
  nome: string
  username: string | null
  papel: PapelObra
  desde: string
}

/** Publicação no Telegram que precisa de atenção do gestor. */
export interface PublicacaoProblema {
  id: number
  estado: EstadoPublicacao
  erro: string | null
  tentativas: number
  atualizado_em: string
  registro_id: string
  encerramento_id: string | null
  /** `encerramento` quando a publicação é a de um encerramento. */
  tipo: TipoRegistro | 'encerramento'
  legenda: string
  ambiente: string
}
