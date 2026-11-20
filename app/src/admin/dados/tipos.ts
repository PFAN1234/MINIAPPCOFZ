import type { PlantaAdmin } from '@modules/ra/domain/planta.ts'
import type { QrAmbiente } from '@modules/ra/domain/tipos.ts'
/** Tipos do site de administração (/admin/). RPCs em supabase/migrations/20261111170000_admin.sql. */

export type StatusObra = 'aguardando_revisao_humana' | 'revisado'

export const ROTULO_STATUS: Record<StatusObra, string> = {
  aguardando_revisao_humana: 'Aguardando revisão humana',
  revisado: 'Revisado',
}

/** Categorias usadas pelo extrator (scripts/extrair_ambientes.py e app/src/modules/plantas/domain/extrair.ts). */
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

// --- Etapas e organização: RPCs em supabase/migrations/20261112180000_etapas.sql ----------------

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

/** Resultado de `excluir_boletim` (Edge Function `admin-excluir-obra`): o dia inteiro do boletim sai. */
export interface ResultadoExclusaoBoletim {
  numero: string
  data: string
  /** Quantas revisões (boletins) do dia foram apagadas. */
  revisoes: number
  mensagens: { apagadas: number; falhas: number }
  /** Os PDFs não saíram do armazenamento (texto do erro). */
  arquivos_erro: string | null
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

export interface ErroCliente {
  id: number
  criado_em: string
  usuario_id: string | null
  usuario_nome: string | null
  app: 'miniapp' | 'admin'
  versao: string | null
  rota: string | null
  mensagem: string
  pilha: string | null
  agente: string | null
  contexto: Record<string, unknown> | null
}

export interface ResumoOrfaoBucket {
  bucket: string
  quantidade: number
  bytes: number
}

export interface ArquivoOrfao {
  bucket: string
  caminho: string
  tamanho: number | null
  criado_em: string | null
  detectado_em: string
}

/** RPC `admin_resumo_orfaos`: simulação da varredura de arquivos sem referência no banco. */
export interface ResumoOrfaos {
  buckets: ResumoOrfaoBucket[]
  maiores: ArquivoOrfao[]
}

export type Bucket = 'originais' | 'plantas' | 'modelos'

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
  /** Contorno normalizado (0..1) na página do PDF; null sem planta. */
  contorno_pagina: [number, number][] | null
  /** Planta do pavimento já com URL assinada; null se ausente. */
  planta: PlantaAdmin | null
}

/** Erro já com a mensagem para a tela. */
export class ErroAdmin extends Error {
  constructor(message: string, opcoes?: { cause?: unknown }) {
    super(message, opcoes)
    this.name = 'ErroAdmin'
  }
}
