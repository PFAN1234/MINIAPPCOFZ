import type { SupabaseClient } from '@supabase/supabase-js'
import type { Armazenamento } from '@modules/armazenamento/application/ports/Armazenamento.port.ts'
import { erroDoSupabase } from '../../../dados/erros.ts'
import type { OrganizacaoRepositorio } from '../application/ports/OrganizacaoRepositorio.port.ts'
import type { Organizacao } from '../domain/tipos.ts'
import type { Linha } from './validacao.ts'

export function criarOrganizacaoSupabase(
  cliente: SupabaseClient,
  armazenamento: Armazenamento,
): OrganizacaoRepositorio {
  return {
  async organizacao(): Promise<Organizacao> {
    try {
      const { data, error } = await cliente.rpc('organizacao')
      if (error) throw error
      const l = (Array.isArray(data) ? data[0] : data) as Linha | null
      const logo = typeof l?.logo_path === 'string' && l.logo_path ? l.logo_path : null
      return {
        nome: typeof l?.nome === 'string' ? l.nome : '',
        logo_url: logo ? ((await armazenamento.urls('organizacao', [logo])).get(logo) ?? null) : null,
      }
    } catch (e) {
      throw erroDoSupabase(e)
    }
  },
  }
}
