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
