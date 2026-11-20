import type { SupabaseClient } from '@supabase/supabase-js'
import { erroDoSupabase } from '../../../dados/erros.ts'
import type { EquipeServicoRepositorio } from '../application/ports/EquipeServicoRepositorio.port.ts'
import type { EquipeServico, MembroServico } from '../domain/tipos.ts'
import { exigirUuid, type Linha } from './validacao.ts'

function lerEquipeServico(dado: unknown): EquipeServico {
  const d = (dado ?? {}) as Linha
  const meu = d.meu_servico as Linha | null | undefined
  return {
    etapa_id: String(d.etapa_id ?? ''),
    participa: d.participa === true,
    tem_localizacao: d.tem_localizacao === true,
    meu_servico: meu
      ? {
          id: String(meu.id),
          etapa_id: String(meu.etapa_id),
          etapa_nome: String(meu.etapa_nome ?? ''),
          entrada_em: String(meu.entrada_em),
        }
      : null,
    equipe: ((d.equipe ?? []) as Linha[]).map(
      (m): MembroServico => ({
        id: String(m.id),
        usuario_id: String(m.usuario_id),
        nome: String(m.nome ?? ''),
        entrada_em: String(m.entrada_em),
        saida_em: m.saida_em ? String(m.saida_em) : null,
        saida_automatica: m.saida_automatica === true,
        eu: m.eu === true,
      }),
    ),
  }
}

export function criarEquipeServicoSupabase(cliente: SupabaseClient): EquipeServicoRepositorio {
  return {
    async equipeServico(etapaId) {
      try {
        const { data, error } = await cliente.rpc('equipe_servico', { p_etapa: exigirUuid(etapaId, 'etapa') })
        if (error) throw error
        return lerEquipeServico(data)
      } catch (e) {
        throw erroDoSupabase(e)
      }
    },

    async fazerCheckin(etapaId, posicao) {
      try {
        const { data, error } = await cliente.rpc('fazer_checkin', {
          p_etapa: exigirUuid(etapaId, 'etapa'),
          p_latitude: posicao.latitude,
          p_longitude: posicao.longitude,
          p_precisao: posicao.precisao,
        })
        if (error) throw error
        return lerEquipeServico(data)
      } catch (e) {
        throw erroDoSupabase(e)
      }
    },

    async fazerCheckout() {
      try {
        const { data, error } = await cliente.rpc('fazer_checkout')
        if (error) throw error
        return lerEquipeServico(data)
      } catch (e) {
        throw erroDoSupabase(e)
      }
    },
  }
}
