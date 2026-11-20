import type { ConfigObra } from '@modules/plantas/domain/tipos.ts'

/** Tipos do lado admin do contexto obras (etapas, obras e organização). RPCs em supabase/migrations. */

export interface PavimentoResumo {
  codigo: string
  nome: string
  ordem: number
}

export interface ObraLista {
  id: string
  slug: string
  nome: string
  ordem: number
  pavimentos: PavimentoResumo[]
  ambientes_ativos: number
  /** `config.status`; null sem configuração. */
  status: string | null
  config_atualizada_em: string | null
  /** Obra arquivada (some do Mini App e não publica no Telegram); null se ativa. */
  arquivada_em: string | null
  /** Etapa da obra (`obra.etapa_id`, sempre preenchido no banco). */
  etapa_id: string
  etapa_slug: string
  etapa_nome: string
  /** Etapa arquivada: vale como obra arquivada, sem mexer no `arquivada_em` da obra. */
  etapa_arquivada_em: string | null
}

export interface PavimentoAdmin extends PavimentoResumo {
  id: string
  ambientes: number
  ambientes_ativos: number
  plantas: number
}

/** Etapa embutida em `admin_obter_obra`. */
export interface EtapaDaObra {
  id: string
  slug: string
  nome: string
  arquivada_em: string | null
  telegram_vinculado: boolean
}

export interface ObraAdmin {
  obra: {
    id: string
    slug: string
    nome: string
    ordem: number
    telegram_vinculado: boolean
    arquivada_em: string | null
    /** null só se o servidor ainda não tiver as etapas. */
    etapa: EtapaDaObra | null
  }
  pavimentos: PavimentoAdmin[]
  config: ConfigObra | null
  config_atualizada_em: string | null
  config_atualizada_por: string | null
}

/**
 * Criação (sem `id`, com `slug` e `etapa_id`) ou edição (com `id`; o slug não muda; `etapa_id`,
 * se vier, move a obra de etapa).
 */
export interface DadosObra {
  id?: string
  slug?: string
  nome: string
  ordem: number
  etapa_id?: string
}

/** Uma etapa do campus (`admin_listar_etapas`), com as contagens de obras. */
export interface EtapaLista {
  id: string
  slug: string
  nome: string
  ordem: number
  arquivada_em: string | null
  /** A etapa tem grupo do Telegram (`/vincular_etapa <slug>`). */
  telegram_vinculado: boolean
  /** Título do grupo na hora do vínculo (null se não registrado). */
  telegram_chat_titulo: string | null
  obras: number
  obras_arquivadas: number
  /** Forma o número do boletim (`BA<sigla>/…`); null na etapa que ainda não tem. */
  sigla: string | null
  /** Quantos campos do cadastro do boletim estão vazios (0 = completo). */
  faltando: number
}

/** Campos do cadastro da etapa que não são identidade (`etapa.*`, todos opcionais no banco). */
export interface CamposEtapa {
  sigla: string | null
  endereco: string | null
  latitude: number | null
  longitude: number | null
  fuso: string
  /** Código da estação do Observatório de Fortaleza (`ESTACOES_OBSERVATORIO`). */
  estacao: string | null
  estacao_reserva: string | null
  /** "HH:MM", hora local da emissão automática. */
  boletim_horario: string
  objeto: string | null
  local: string | null
  contratante: string | null
  contrato: string | null
  contratada: string | null
  contratada_cnpj: string | null
  os_numero: string | null
  /** "AAAA-MM-DD". */
  os_data: string | null
  vigencia_meses: number | null
  valor_original: number | null
  area_construida_m2: number | null
}

export interface Aditivo {
  id: string
  etapa_id: string
  numero: string
  /** "AAAA-MM-DD". */
  data: string
  /** Acréscimo em dias (negativo = supressão). */
  prazo_dias: number
  /** Acréscimo em reais (negativo = supressão). */
  valor: number
  descricao: string | null
}

export interface DadosAditivo {
  id?: string
  etapa_id: string
  numero: string
  data: string
  prazo_dias: number
  valor: number
  descricao: string | null
}

export interface Responsavel {
  usuario_id: string
  nome: string
  nome_exibicao: string | null
  funcao: string
  ordem: number
}

export interface PrazoEtapa {
  termino_original: string
  prazo_aditivos_dias: number
  termino_atual: string
  /** Valor original mais os aditivos; null sem valor original. */
  valor_atual: number | null
}

/** `admin_obter_etapa`: a etapa inteira, com aditivos, responsáveis, prazo e o que falta. */
export interface EtapaDetalhe extends CamposEtapa {
  id: string
  slug: string
  nome: string
  ordem: number
  arquivada_em: string | null
  telegram_vinculado: boolean
  telegram_chat_titulo: string | null
  aditivos: Aditivo[]
  responsaveis: Responsavel[]
  /** Só com `os_data` e `vigencia_meses`. */
  prazo: PrazoEtapa | null
  /** Campos vazios entre os que o boletim usa (nomes em `ROTULO_FALTANDO`). */
  faltando: string[]
}

/**
 * Criação (sem `id`, com `slug`; `sigla`, `latitude`, `longitude` e `fuso` obrigatórios) ou edição
 * (com `id`): chave ausente mantém o valor, `null` apaga (menos `fuso`, `boletim_horario` e `sigla`).
 */
export type DadosEtapa = Partial<{ [K in keyof CamposEtapa]: CamposEtapa[K] | null }> & {
  id?: string
  slug?: string
  nome: string
  ordem: number
}

/** Devolvido ao salvar: a etapa como em `admin_obter_etapa`. */
export type EtapaSalva = EtapaDetalhe

/** O que a exclusão da etapa apaga (`admin_resumo_etapa`): as obras e a soma das contagens. */
export interface ResumoEtapa {
  obras: { slug: string; nome: string }[]
  total: ResumoObra
}

/** Resposta da Edge Function `admin-excluir-obra`, ação `excluir_etapa`. */
export interface ResultadoExclusaoEtapa {
  exclusoes: { exclusao_id: string; removidos: Partial<Record<BucketObra, number>>; pendente: boolean; erro: string | null }[]
  /** Parte dos arquivos ficou no Storage (tentar de novo em "Obras excluídas"). */
  pendente: boolean
  erro: string | null
}

/** Identidade da organização militar (RPC `organizacao()`). */
export interface Organizacao {
  nome: string
  /** Caminho no bucket público `organizacao`; null = sem logo. */
  logo_path: string | null
  /** URL pública do logo (montada pelo repositório); null sem logo. */
  logo_url: string | null
  /** Linhas de subordinação acima do nome no boletim (até 4); vazio = nenhuma. */
  cabecalho: string[]
}

export interface ObraSalva {
  id: string
  slug: string
  nome: string
  ordem: number
}

/** Buckets com arquivos da obra (todos com o id da obra como 1ª pasta). */
export type BucketObra = 'fotos' | 'plantas' | 'originais' | 'modelos'

/** O que a exclusão da obra apaga (`admin_resumo_obra`). */
export interface ResumoObra {
  registros: number
  fotos: number
  ambientes: number
  pavimentos: number
  plantas: number
  modelos: number
  participantes: number
  publicacoes_telegram: number
  arquivos: Record<BucketObra, number>
}

/** Resposta da Edge Function `admin-excluir-obra` (ações `excluir` e `limpar`). */
export interface ResultadoExclusao {
  exclusao_id: string
  obra_id: string
  arquivos_removidos: Partial<Record<BucketObra, number>>
  /** A obra saiu do banco, mas parte dos arquivos ficou no Storage (tentar de novo). */
  pendente: boolean
  erro?: string
}

/** Uma exclusão registrada (`admin_listar_exclusoes`). */
export interface Exclusao {
  id: string
  obra_id: string
  slug: string
  nome: string
  excluida_em: string
  excluida_por_nome: string | null
  resumo: Partial<ResumoObra> | null
  arquivos_removidos_em: string | null
  arquivos_removidos: Partial<Record<BucketObra, number>> | null
  arquivos_erro: string | null
  /** Nome da etapa, quando a obra saiu junto com ela. */
  etapa_nome?: string | null
}
