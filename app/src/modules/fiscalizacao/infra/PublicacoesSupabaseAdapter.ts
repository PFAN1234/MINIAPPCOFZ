import type { SupabaseClient } from '@supabase/supabase-js'
import type { PublicacoesRepositorio } from '@modules/fiscalizacao/application/ports/PublicacoesRepositorio.port.ts'
import type { EstadoPublicacao, PublicacaoProblema } from '@modules/fiscalizacao/domain/tipos.ts'
import { ErroEnvio, erroDoSupabase } from '../../../dados/erros.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
type Linha = Record<string, unknown>

function exigirUuid(valor: string, nome: string): string {
  if (!UUID.test(valor)) throw new ErroEnvio('validacao', `Identificador inválido (${nome}).`)
  return valor
}

export function criarPublicacoesSupabase(cliente: SupabaseClient): PublicacoesRepositorio {
  async function chamar(nome: string, args: Record<string, unknown>): Promise<unknown> {
    try {
      const { data, error } = await cliente.rpc(nome, args)
      if (error) throw error
      return data
    } catch (e) {
      throw erroDoSupabase(e)
    }
  }

  return {
    async listarPublicacoesProblema(obraId) {
      const dados = await chamar('listar_publicacoes_problema', {
        p_obra: exigirUuid(obraId, 'obra'),
      })
      return ((dados ?? []) as Linha[]).map(
        (l): PublicacaoProblema => ({
          id: Number(l.id),
          estado: l.estado as EstadoPublicacao,
          erro: l.erro ? String(l.erro) : null,
          tentativas: Number(l.tentativas),
          atualizado_em: String(l.atualizado_em),
          registro_id: String(l.registro_id),
          encerramento_id: l.encerramento_id ? String(l.encerramento_id) : null,
          tipo: l.tipo as PublicacaoProblema['tipo'],
          legenda: String(l.legenda ?? ''),
          ambiente: String(l.ambiente ?? ''),
        }),
      )
    },

    async republicar(id) {
      await chamar('republicar', { p_id: id })
    },

    async marcarPublicada(id) {
      await chamar('marcar_publicada', { p_id: id })
    },
  }
}
