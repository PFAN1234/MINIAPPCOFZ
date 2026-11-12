/** Tipos do site de administração (/admin/). RPCs em supabase/migrations/20261111170000_admin.sql. */

export type StatusObra = 'aguardando_revisao_humana' | 'revisado'

export const ROTULO_STATUS: Record<StatusObra, string> = {
  aguardando_revisao_humana: 'Aguardando revisão humana',
  revisado: 'Revisado',
}

/** Categorias usadas pelo extrator (scripts/extrair_ambientes.py e app/src/admin/planta/extrair.ts). */
export const CATEGORIAS = [
  'apartamento',
  'banheiro',
  'vestiario',
  'circulacao',
  'externa',
  'servico',
  'area_comum',
] as const

export const ROTULO_CATEGORIA: Record<string, string> = {
  apartamento: 'Apartamento',
  banheiro: 'Banheiro',
  vestiario: 'Vestiário',
  circulacao: 'Circulação',
  externa: 'Área externa',
  servico: 'Serviço',
  area_comum: 'Área comum',
}

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

// --- Planta (fase 2): RPCs em supabase/migrations/20261112090000_admin_planta.sql ----------------

export interface MarcadorBanco {
  x: number
  y: number
  rotulo_bbox?: [number, number, number, number]
}

export interface AmbienteBanco {
  codigo: string
  pavimento: string
  nome_operacional: string
  nome_planta: string | null
  categoria: string
  area_m2: number | null
  revisao_planta: string | null
  marcadores: MarcadorBanco[]
  ordem: number
  ativo: boolean
}

export interface PlantaAtiva {
  revisao: string
  pdf_sha256: string | null
  pagina_pt: [number, number]
  recorte_pt: [number, number, number, number]
  criado_em: string
}

export interface PdfGuardado {
  path: string
  sha256: string
  nome: string | null
  pagina: number
  revisao: string
  publicado_em: string
}

export interface PavimentoEditor {
  codigo: string
  nome: string
  ordem: number
  planta: PlantaAtiva | null
  ultimo_pdf: PdfGuardado | null
}

export interface DadosEditorPlanta {
  obra: { id: string; slug: string; nome: string }
  config: ConfigObra | null
  config_atualizada_em: string | null
  pavimentos: PavimentoEditor[]
  ambientes: AmbienteBanco[]
}

export interface Publicacao {
  id: string
  pavimento: string
  pavimento_nome: string
  revisao: string
  publicado_em: string
  publicado_por_nome: string | null
  pdf_path: string
  pdf_sha256: string
  pdf_nome: string | null
  pagina: number
  resumo: Record<string, unknown>
}

export interface ResultadoPublicacao {
  publicacoes: { id: string; pavimento: string; revisao: string }[]
  ambientes_ativos: number
  inativados: number
}

export type Bucket = 'originais' | 'plantas' | 'modelos'

/** Modelo 3D (.frag) publicado de uma disciplina (tabela `modelo`). */
export interface ModeloAdmin {
  sigla: string
  revisao: string | null
  caminho: string
  bytes: number
  hash: string
  atualizado_em: string
}

/** Linha do histórico de modelos (`publicacao_modelo`). */
export interface EventoModelo {
  id: string
  acao: 'publicado' | 'retirado'
  sigla: string
  revisao: string | null
  bytes: number | null
  hash: string | null
  origem: 'ifc' | 'frag' | null
  arquivo_nome: string | null
  ifc_bytes: number | null
  publicado_em: string
  publicado_por_nome: string | null
}

export interface DadosModelos {
  modelos: ModeloAdmin[]
  historico: EventoModelo[]
}

/** Payload da RPC `admin_registrar_modelo` (o arquivo já está no bucket `modelos`). */
export interface RegistroModelo {
  sigla: string
  revisao: string | null
  caminho: string
  bytes: number
  hash: string
  origem: 'ifc' | 'frag'
  arquivo_nome?: string | null
  ifc_bytes?: number | null
}

/** Erro já com a mensagem para a tela. */
export class ErroAdmin extends Error {
  constructor(message: string, opcoes?: { cause?: unknown }) {
    super(message, opcoes)
    this.name = 'ErroAdmin'
  }
}
