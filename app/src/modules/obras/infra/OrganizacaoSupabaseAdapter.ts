import type { SupabaseClient } from '@supabase/supabase-js'
import { erroDoSupabase } from '../../../dados/erros.ts'
import type { OrganizacaoRepositorio } from '../application/ports/OrganizacaoRepositorio.port.ts'
import type { Organizacao } from '../domain/tipos.ts'
import type { Linha } from './validacao.ts'

/** URL pública do logo no bucket (público) `organizacao`. */
export function urlPublicaLogo(logoPath: string): string {
  const base = String(import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '')
  const caminho = logoPath.split('/').map(encodeURIComponent).join('/')
  return `${base}/storage/v1/object/public/organizacao/${caminho}`
}

export function criarOrganizacaoSupabase(cliente: SupabaseClient): OrganizacaoRepositorio {
  return {
  async organizacao(): Promise<Organizacao> {
    try {
      const { data, error } = await cliente.rpc('organizacao')
      if (error) throw error
      const l = (Array.isArray(data) ? data[0] : data) as Linha | null
      const logo = typeof l?.logo_path === 'string' && l.logo_path ? l.logo_path : null
      return {
        nome: typeof l?.nome === 'string' ? l.nome : '',
        logo_url: logo ? urlPublicaLogo(logo) : null,
      }
    } catch (e) {
      throw erroDoSupabase(e)
    }
  },
  }
}
