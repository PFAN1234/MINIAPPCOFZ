/**
 * Regras puras do modelo 3D: o `.frag` de cada disciplina (`ModeloFrag`), a ordem de exibição
 * e as regras do envio pelo admin (sigla e revisão pelo nome do arquivo, limites e conferência
 * do `.frag`). O `.frag` vem da conversão do IFC no navegador ou pronto, do script `npm run modelos`.
 */
import { REVISAO_VALIDA } from '../../../admin/planta/editor.ts'

/**
 * Um `.frag` de uma disciplina. `arquivo` é onde o repositório o encontra: nome do arquivo em
 * `/modelos/<obra>/` na fixture, caminho no bucket `modelos` no Supabase. `hash` identifica o
 * conteúdo (chave do cache no aparelho).
 */
export interface ModeloFrag {
  sigla: string
  revisao: string | null
  arquivo: string
  bytes: number
  hash: string
  /** Correção opcional (16 números, ordem `THREE.Matrix4.elements`) sobre as coordenadas do `.frag`. */
  matriz?: number[]
}

/** Coloca o modelo de referência (`ARQ` por padrão) antes dos demais, preservando a ordem relativa. */
export function ordenarPorReferencia(modelos: readonly ModeloFrag[], referencia = 'ARQ'): ModeloFrag[] {
  return [...modelos].sort((a, b) => Number(b.sigla === referencia) - Number(a.sigla === referencia))
}

/** Limite de upload do Supabase no plano grátis (vale para cada arquivo). */
export const LIMITE_FRAG = 50 * 1024 * 1024
/** Acima disto o IFC pode estourar a memória da aba: avisar e sugerir o script. */
export const AVISO_IFC = 400 * 1000 * 1000
export const SIGLA_VALIDA = /^[A-Z]{2,4}$/

export type TipoArquivo = 'ifc' | 'frag'

export function tipoDoArquivo(nome: string): TipoArquivo | null {
  const ext = nome.toLowerCase().split('.').pop()
  return ext === 'ifc' ? 'ifc' : ext === 'frag' ? 'frag' : null
}

/**
 * Sigla e revisão pelo padrão `<obra>-<projeto>-<SIGLA>-<REV>.ifc` (o mesmo do script
 * `ifc_para_frag.mjs`): `CE01-14PE01-ARQ-R06.ifc` → ARQ, R06. Fora do padrão, `null`.
 */
export function siglaERevisao(nome: string): {
  sigla: string | null
  revisao: string | null
} {
  const base = nome.replace(/\.[^.]*$/, '')
  const partes = base.split('-')
  const sigla = partes[2]?.toUpperCase() ?? null
  const revisao = partes[3]?.toUpperCase() ?? null
  return {
    sigla: sigla && SIGLA_VALIDA.test(sigla) ? sigla : null,
    revisao: revisao && REVISAO_VALIDA.test(revisao) ? revisao : null,
  }
}

/** O `.frag` da That Open é comprimido com zlib (começa com 0x78 e o cabeçalho fecha em 31). */
export function pareceFrag(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x78 && ((bytes[0] << 8) | bytes[1]) % 31 === 0
}

export function problemaSigla(sigla: string): string | null {
  return SIGLA_VALIDA.test(sigla) ? null : 'Sigla da disciplina: de 2 a 4 letras maiúsculas (ex.: ARQ, EST, HID).'
}

export function problemaRevisaoModelo(revisao: string): string | null {
  if (!revisao) return null
  return REVISAO_VALIDA.test(revisao)
    ? null
    : 'Revisão inválida: use letras, dígitos, ponto, hífen ou sublinhado (ex.: R06).'
}

export function problemaFrag(bytes: Uint8Array): string | null {
  if (bytes.length === 0) return 'O arquivo .frag está vazio.'
  if (!pareceFrag(bytes)) return 'O arquivo não parece um .frag da That Open (gerado pela conversão do IFC).'
  if (bytes.length > LIMITE_FRAG) {
    return `O .frag tem ${mb(bytes.length)}, acima do limite de ${mb(LIMITE_FRAG)} por arquivo do Supabase (plano grátis).`
  }
  return null
}

export function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`
}

/** Caminho endereçado pelo conteúdo: um `.frag` novo nunca sobrescreve o anterior. */
export function caminhoModelo(obraId: string, sigla: string, hash: string): string {
  return `${obraId}/${sigla}/${hash}.frag`
}
