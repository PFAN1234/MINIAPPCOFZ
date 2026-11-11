/** Tipos do site de administração (/admin/). RPCs em supabase/migrations/20261111170000_admin.sql. */

export type StatusObra = 'aguardando_revisao_humana' | 'revisado'

export const ROTULO_STATUS: Record<StatusObra, string> = {
  aguardando_revisao_humana: 'Aguardando revisão humana',
  revisado: 'Revisado',
}

/** Categorias usadas pelos scripts (scripts/README.md); o campo aceita outras. */
export const CATEGORIAS = [
  'apartamento',
  'banheiro',
  'vestiario',
  'circulacao',
  'externa',
  'servico',
  'area_comum',
] as const

export interface UsuarioSessao {
  id: string
  nome: string
}

export type EstadoSessao =
  | { tipo: 'sem_sessao' }
  | { tipo: 'negado'; usuario: UsuarioSessao }
  | { tipo: 'admin'; usuario: UsuarioSessao }

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
}

export interface PavimentoAdmin extends PavimentoResumo {
  id: string
  ambientes: number
  ambientes_ativos: number
  plantas: number
}

/** Equivalente do `data/<slug>/obra.json`, sem slug e nome. Campos desconhecidos são preservados. */
export interface ConfigObra {
  status?: StatusObra
  revisao?: string
  nomes_fixos?: Record<string, string>
  categorias?: Record<string, string>
  [chave: string]: unknown
}

export interface ObraAdmin {
  obra: { id: string; slug: string; nome: string; ordem: number; telegram_vinculado: boolean }
  pavimentos: PavimentoAdmin[]
  config: ConfigObra | null
  config_atualizada_em: string | null
  config_atualizada_por: string | null
}

/** Criação (sem `id`, com `slug`) ou edição (com `id`; o slug não muda). */
export interface DadosObra {
  id?: string
  slug?: string
  nome: string
  ordem: number
}

export interface ObraSalva {
  id: string
  slug: string
  nome: string
  ordem: number
}

export interface Admin {
  usuario_id: string
  nome: string
  username: string | null
  telegram_id: number
  criado_em: string
  criado_por_nome: string | null
}

export interface UsuarioApp {
  id: string
  nome: string
  username: string | null
  telegram_id: number
  eh_admin: boolean
}

/** Objeto que o Telegram Login Widget entrega ao `data-onauth`. */
export interface DadosWidget {
  id: number
  first_name: string
  last_name?: string
  username?: string
  photo_url?: string
  auth_date: number
  hash: string
}

/** Erro já com a mensagem para a tela. */
export class ErroAdmin extends Error {
  constructor(message: string, opcoes?: { cause?: unknown }) {
    super(message, opcoes)
    this.name = 'ErroAdmin'
  }
}
