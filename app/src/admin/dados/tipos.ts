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

/** Equivalente do `data/<slug>/obra.json`, sem slug e nome. Campos desconhecidos são preservados. */
export interface ConfigObra {
  status?: StatusObra
  revisao?: string
  nomes_fixos?: Record<string, string>
  categorias?: Record<string, string>
  [chave: string]: unknown
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

// --- Etapas e organização: RPCs em supabase/migrations/20261112180000_etapas.sql ----------------

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

// --- Boletim: cadastro da etapa e pessoas (contrato: docs/contrato-boletim.md) -------------------

/** Fusos do Brasil aceitos pelo banco (`etapa.fuso`), com o rótulo mostrado no site. */
export const FUSOS: { valor: string; rotulo: string }[] = [
  { valor: 'America/Noronha', rotulo: 'Fernando de Noronha (UTC−2)' },
  { valor: 'America/Belem', rotulo: 'Belém (UTC−3)' },
  { valor: 'America/Fortaleza', rotulo: 'Fortaleza (UTC−3)' },
  { valor: 'America/Recife', rotulo: 'Recife (UTC−3)' },
  { valor: 'America/Araguaina', rotulo: 'Araguaína (UTC−3)' },
  { valor: 'America/Maceio', rotulo: 'Maceió (UTC−3)' },
  { valor: 'America/Bahia', rotulo: 'Salvador (UTC−3)' },
  { valor: 'America/Sao_Paulo', rotulo: 'São Paulo / Brasília (UTC−3)' },
  { valor: 'America/Campo_Grande', rotulo: 'Campo Grande (UTC−4)' },
  { valor: 'America/Cuiaba', rotulo: 'Cuiabá (UTC−4)' },
  { valor: 'America/Santarem', rotulo: 'Santarém (UTC−3)' },
  { valor: 'America/Porto_Velho', rotulo: 'Porto Velho (UTC−4)' },
  { valor: 'America/Boa_Vista', rotulo: 'Boa Vista (UTC−4)' },
  { valor: 'America/Manaus', rotulo: 'Manaus (UTC−4)' },
  { valor: 'America/Eirunepe', rotulo: 'Eirunepé (UTC−5)' },
  { valor: 'America/Rio_Branco', rotulo: 'Rio Branco (UTC−5)' },
]

/** Nomes dos campos em `admin_obter_etapa.faltando`, como aparecem no aviso do site. */
export const ROTULO_FALTANDO: Record<string, string> = {
  sigla: 'sigla',
  localizacao: 'localização (latitude e longitude)',
  estacao: 'estação meteorológica',
  objeto: 'obra/serviço',
  local: 'local',
  contratante: 'contratante',
  contrato: 'contrato',
  contratada: 'contratada',
  contratada_cnpj: 'CNPJ da contratada',
  os_numero: 'número da OS',
  os_data: 'data da OS',
  vigencia_meses: 'vigência',
  valor_original: 'valor original',
  area_construida_m2: 'área construída',
  responsaveis: 'responsáveis',
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

export interface ParticipacaoPessoa {
  obra_slug: string
  obra_nome: string
  etapa_nome: string
  papel: string
}

/** `admin_listar_pessoas`. */
export interface Pessoa {
  id: string
  nome: string
  nome_exibicao: string | null
  username: string | null
  telegram_id: number
  eh_admin: boolean
  participacoes: ParticipacaoPessoa[]
}

export const NOME_EXIBICAO_MAX = 60

/**
 * Estações meteorológicas do Observatório de Riscos Climáticos de Fortaleza (lista fixa, só no
 * site; o gerador do boletim tem a mesma lista em `servidor/boletim/estacoes.ts`).
 */
export const ESTACOES_OBSERVATORIO: { codigo: string; nome: string }[] = [
  { codigo: '3318', nome: 'Dom Lustosa' },
  { codigo: '8642', nome: 'Centro' },
  { codigo: '8836', nome: 'Montese' },
  { codigo: '8869', nome: 'Vila Velha' },
  { codigo: '9134', nome: 'Conjunto Esperança' },
  { codigo: '9137', nome: 'Mucuripe' },
  { codigo: '9169', nome: 'Messejana' },
  { codigo: '9242', nome: 'Guararapes' },
  { codigo: '9249', nome: 'Jangurussu' },
  { codigo: '9281', nome: 'Benfica' },
  { codigo: '9282', nome: 'Granja Lisboa' },
]

/** Padrão na criação da etapa (Montese e, de reserva, Benfica). */
export const ESTACAO_PADRAO = '8836'
export const ESTACAO_RESERVA_PADRAO = '9281'

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

export const CABECALHO_LINHAS_MAX = 4
export const CABECALHO_LINHA_MAX = 100

export const NOME_OM_MAX = 80
/** Limite do bucket `organizacao` (1 MB). */
export const LOGO_MAX_BYTES = 1024 * 1024
/** Tipos aceitos pelo bucket `organizacao` e a extensão do caminho de cada um. */
export const TIPOS_LOGO: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
/** Caminho do logo no bucket: `logo-<16 hex>.<png|jpg|webp>` (nome novo a cada troca). */
export const CAMINHO_LOGO = /^logo-[0-9a-f]{16}\.(png|jpg|webp)$/

/** Confere o arquivo do logo antes de enviar; devolve a mensagem de erro ou null. */
export function problemaDoLogo(arquivo: { type: string; size: number }): string | null {
  if (!(arquivo.type in TIPOS_LOGO)) return 'O logo precisa ser PNG, JPEG ou WebP.'
  if (arquivo.size > LOGO_MAX_BYTES) return 'O logo pode ter no máximo 1 MB.'
  return null
}

/** Caminho novo para o logo, com a extensão do tipo. */
export function novoCaminhoLogo(tipo: string): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `logo-${hex}.${TIPOS_LOGO[tipo] ?? 'png'}`
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

/** Posição do QR de um ambiente (tabela `ambiente_qr`; ver docs/contrato-ra.md). */
export interface QrAmbiente {
  /** Aresta i do contorno: de `contorno[i]` a `contorno[(i+1) % n]` (a partir de 0). */
  parede: number
  distancia_m: number
  altura_m: number
  lado_m: number
}

/** Ambiente com geometria (`admin_listar_ra`). */
export interface AmbienteRA {
  ambiente_id: string
  codigo: string
  nome: string
  pavimento: string
  /** [x, z] em metros, sem repetir o primeiro ponto. */
  contorno: [number, number][]
  y_piso: number
  y_teto: number
  qr: QrAmbiente | null
}

/** Erro já com a mensagem para a tela. */
export class ErroAdmin extends Error {
  constructor(message: string, opcoes?: { cause?: unknown }) {
    super(message, opcoes)
    this.name = 'ErroAdmin'
  }
}
