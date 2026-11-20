/** Tipos do domínio de boletins no site de administração (/admin/). */
export type { ResultadoExclusaoBoletim } from './tipos.ts'

/** Boletim emitido (`admin_listar_boletins`). */
export interface BoletimEmitido {
  id: string
  /** "AAAA-MM-DD". */
  data: string
  revisao: number
  numero: string
  emitido_em: string
  /** null = emissão automática. */
  emitido_por_nome: string | null
  /** Caminho no bucket `boletins`. */
  pdf_path: string | null
  /** Já enviado ao grupo do Telegram da etapa. */
  publicado: boolean
  /** Estado da publicação no Telegram (`publicacao_telegram.estado`); null = ainda não enfileirada. */
  publicacao_estado: string | null
  /** Último erro do envio ao Telegram (`publicacao_telegram.erro`). */
  publicacao_erro: string | null
  /** Tentativas de envio já feitas. */
  publicacao_tentativas: number
}

export type EstadoEmissao = 'pendente' | 'gerando' | 'emitido' | 'falhou'

/** Pedido de emissão ainda não emitido (na fila, gerando ou com falha). */
export interface PedidoEmissao {
  id: number
  data: string
  revisao: number
  estado: EstadoEmissao
  tentativas: number
  erro: string | null
  atualizado_em: string
  /** Número do boletim do pedido (devolvido por `admin_pedir_emissao`). */
  numero?: string
}

export interface ListaBoletins {
  /** Mais recentes primeiro. */
  boletins: BoletimEmitido[]
  pedidos: PedidoEmissao[]
}

/** Boletim da lista geral (`admin_listar_todos_boletins`): o emitido + a etapa e as marcas de edição. */
export interface BoletimDaLista extends BoletimEmitido {
  etapa_slug: string
  etapa_nome: string
  /** Número do boletim em que a edição se baseou (retificação editada); null = sem base. */
  base_numero: string | null
  /** A revisão nasceu de uma edição (`boletim.edicao` não nula). */
  editado: boolean
  /** Há rascunho salvo para este boletim. */
  tem_rascunho: boolean
}

/** Pedido não emitido da lista geral. */
export interface PedidoDaLista extends PedidoEmissao {
  etapa_slug: string
  etapa_nome: string
  editado: boolean
}

export interface ListaTodosBoletins {
  boletins: BoletimDaLista[]
  pedidos: PedidoDaLista[]
}

/** Filtros da lista geral; datas "AAAA-MM-DD" inclusivas. */
export interface FiltroBoletins {
  /** Slug da etapa; ausente = todas. */
  etapa?: string
  de?: string
  ate?: string
}

/** Edição do boletim (mesmo formato de `Edicao` em `servidor/boletim/edicao.ts`). */
export interface EdicaoBoletim {
  /** Chave (`servico:<id>`, `aberta:<id>`, `encerrada:<id>`, `encerramento:<id>`, `observacao:<obra>:<i>`, `tardio:<id>`) → novo texto. */
  textos?: Record<string, string>
  ocultos?: string[]
  /** Caminhos no bucket `fotos`. */
  fotos_ocultas?: string[]
}

// Snapshot do boletim, só com o que o editor usa (espelha `servidor/boletim/tipos.ts`).
export interface FotoBoletim {
  /** Caminho no bucket `fotos`. */
  path: string
  largura: number
  altura: number
  origem?: 'normal' | 'ra_limpa' | 'ra_modelo'
}

/** Serviço do dia ou pendência aberta no dia. */
export interface RegistroBoletim {
  id: string
  pavimento: string
  ambiente: string
  hora: string
  autor: string
  legenda: string | null
  fotos: FotoBoletim[]
}

export interface PendenciaEncerradaBoletim {
  id: string
  pavimento: string
  ambiente: string
  aberta_em: string
  dias_aberta: number
  legenda: string | null
  fotos_registro: FotoBoletim[]
  encerramento: { hora: string; autor: string; observacao: string | null; fotos: FotoBoletim[] }
}

export interface ObservacaoBoletim {
  hora: string
  autor: string
  texto: string
  editada: boolean
}

export interface ObraBoletim {
  id: string
  nome: string
  servicos: RegistroBoletim[]
  pendencias_abertas: RegistroBoletim[]
  pendencias_encerradas: PendenciaEncerradaBoletim[]
  observacoes: ObservacaoBoletim[]
}

export interface TardioBoletim {
  id: string
  tipo: 'servico' | 'pendencia' | 'encerramento' | 'observacao'
  data: string
  hora: string | null
  recebido_em: string | null
  obra: string
  ambiente: string | null
  autor: string
  texto: string | null
}

export interface SnapshotBoletim {
  data: string
  obras: ObraBoletim[]
  tardios: TardioBoletim[]
}

/** Um boletim para o editor (`admin_boletim`). */
export interface BoletimDetalhe {
  id: string
  etapa_slug: string
  etapa_nome: string
  data: string
  revisao: number
  numero: string
  emitido_em: string
  emitido_por_nome: string | null
  pdf_path: string | null
  publicado: boolean
  publicacao_estado: string | null
  /** Nenhuma revisão posterior no mesmo dia (só ela é editável). */
  ultima_revisao: boolean
  /** Há emissão pendente/gerando no dia (editor só leitura). */
  emissao_em_andamento: boolean
  base_numero: string | null
  /** Edição que originou esta revisão; null = emissão comum. */
  edicao: EdicaoBoletim | null
  snapshot: SnapshotBoletim
  rascunho: { edicao: EdicaoBoletim; atualizado_em: string; atualizado_por_nome: string | null } | null
}
