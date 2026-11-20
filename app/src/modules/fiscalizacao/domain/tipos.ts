/** Tipos do domínio de fiscalização (registros, pendências, encerramentos e publicações). */
import type { PapelObra } from '@modules/acessos/domain/tipos.ts'
import type { DadosRA, OrigemFoto } from '@modules/ra/domain/tipos.ts'

export type TipoRegistro = 'servico' | 'pendencia'
export type SituacaoRegistro = 'aberta' | 'resolvida'

export type EstadoPublicacao = 'pendente' | 'enviando' | 'publicado' | 'incerto' | 'falhou'

export interface FotoRegistro {
  id: string
  /** Caminho no bucket `fotos`: `<obra_id>/<registro_id>/<foto_id>.jpg`. */
  path: string
  largura: number
  altura: number
  /** `ra_limpa` e `ra_modelo` são o par tirado na realidade aumentada. */
  origem?: OrigemFoto
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

/** Dados de uma foto na conclusão do registro; `origem` e `ra` só nas fotos da realidade aumentada. */
export interface FotoEnviada {
  id: string
  largura: number
  altura: number
  bytes: number
  origem?: Exclude<OrigemFoto, 'normal'>
  ra?: DadosRA
}

export interface NovoRegistro {
  id: string
  ambienteId: string
  tipo: TipoRegistro
  legenda: string
  /** ISO. */
  capturadoEm: string
  /** Na ordem escolhida. */
  fotos: FotoEnviada[]
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
  /** Etapa da obra do registro. */
  etapaId?: string
  /** Id do autor. */
  autorId?: string
  /** Período de `capturado_em` (`AAAA-MM-DD`, fuso de Fortaleza); cada lado é opcional. */
  de?: string
  ate?: string
  limite?: number
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
