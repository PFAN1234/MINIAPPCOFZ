import type { SupabaseClient } from '@supabase/supabase-js'
import { erroDoSupabase } from '../../../dados/erros.ts'
import type { EtapasInicioRepositorio } from '../application/ports/EtapasInicioRepositorio.port.ts'
import type { EtapaInicio } from '../domain/tipos.ts'
import type { Linha } from './validacao.ts'

export function criarEtapasInicioSupabase(cliente: SupabaseClient): EtapasInicioRepositorio {
  return {
  async etapasInicio() {
    try {
      const { data, error } = await cliente.rpc('etapas_inicio')
      if (error) throw error
      return ((data ?? []) as Linha[]).map(
        (l): EtapaInicio => ({
          id: String(l.id),
          slug: String(l.slug ?? ''),
          nome: String(l.nome),
          ordem: Number(l.ordem ?? 0),
          participa: l.participa === true,
        }),
      )
    } catch (e) {
      throw erroDoSupabase(e)
    }
  },
  }
}
