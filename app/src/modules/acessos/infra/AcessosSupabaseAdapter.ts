import type { SupabaseClient } from '@supabase/supabase-js'
import { erroDoSupabase } from '../../../dados/erros.ts'
import type { AcessosRepositorio } from '../application/ports/AcessosRepositorio.port.ts'
import type {
  MatrizAcessos,
  ObraDisponivel,
  PapelObra,
  Participante,
  SolicitacaoAcesso,
} from '../domain/tipos.ts'
import { exigirUuid, type Linha } from './validacao.ts'

export function criarAcessosSupabase(cliente: SupabaseClient): AcessosRepositorio {
  /** Chama uma RPC e converte a falha em `ErroEnvio`. */
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
    async obrasDisponiveis() {
      try {
        const { data, error } = await cliente.rpc('obras_disponiveis')
        if (error) throw error
        return ((data ?? []) as Linha[]).map(
          (l): ObraDisponivel => ({
            id: String(l.id),
            slug: String(l.slug),
            nome: String(l.nome),
            solicitacao: l.solicitacao === 'pendente' || l.solicitacao === 'recusada' ? l.solicitacao : null,
            etapa_id: String(l.etapa_id ?? ''),
            etapa_nome: String(l.etapa_nome ?? ''),
            etapa_ordem: Number(l.etapa_ordem ?? 0),
          }),
        )
      } catch (e) {
        throw erroDoSupabase(e)
      }
    },

    async solicitarAcesso(obraId) {
      try {
        const { error } = await cliente.rpc('solicitar_acesso', { p_obra: exigirUuid(obraId, 'obra') })
        if (error) throw error
      } catch (e) {
        throw erroDoSupabase(e)
      }
    },

    async listarSolicitacoes(obraId) {
      try {
        const { data, error } = await cliente.rpc('listar_solicitacoes', {
          p_obra: exigirUuid(obraId, 'obra'),
        })
        if (error) throw error
        return ((data ?? []) as Linha[]).map(
          (l): SolicitacaoAcesso => ({
            id: String(l.id),
            usuario_id: String(l.usuario_id),
            nome: String(l.nome),
            username: l.username ? String(l.username) : null,
            criado_em: String(l.criado_em),
          }),
        )
      } catch (e) {
        throw erroDoSupabase(e)
      }
    },

    async decidirSolicitacao(id, aprovar) {
      try {
        const { error } = await cliente.rpc('decidir_solicitacao', {
          p_id: exigirUuid(id, 'solicitação'),
          p_aprovar: aprovar,
        })
        if (error) throw error
      } catch (e) {
        throw erroDoSupabase(e)
      }
    },

    async matrizAcessos(): Promise<MatrizAcessos> {
      const dados = ((await chamar('matriz_acessos', {})) ?? {}) as Linha
      return {
        obras: ((dados.obras ?? []) as Linha[]).map((o) => ({
          id: String(o.id),
          slug: String(o.slug),
          nome: String(o.nome),
        })),
        pessoas: ((dados.pessoas ?? []) as Linha[]).map((l) => ({
          id: String(l.id),
          nome: String(l.nome),
          username: l.username ? String(l.username) : null,
          admin: l.admin === true,
          vistoEm: l.visto_em ? String(l.visto_em) : null,
          acessos: Object.fromEntries(
            Object.entries((l.acessos ?? {}) as Record<string, unknown>).map(([k, v]) => [
              k,
              v === 'gestor' ? 'gestor' : 'equipe',
            ]),
          ),
          pedidos: ((l.pedidos ?? []) as unknown[]).map(String),
        })),
      }
    },

    async definirAcesso(obraId, usuarioId, papel) {
      await chamar('definir_acesso', {
        p_obra: exigirUuid(obraId, 'obra'),
        p_usuario: exigirUuid(usuarioId, 'usuário'),
        p_papel: papel,
      })
    },

    async listarParticipantes(obraId) {
      const dados = await chamar('listar_participantes', { p_obra: exigirUuid(obraId, 'obra') })
      return ((dados ?? []) as Linha[]).map(
        (l): Participante => ({
          usuario_id: String(l.usuario_id),
          nome: String(l.nome),
          username: l.username ? String(l.username) : null,
          papel: l.papel === 'gestor' ? 'gestor' : 'equipe',
          desde: String(l.desde),
        }),
      )
    },

    async definirPapel(obraId, usuarioId, papel: PapelObra) {
      await chamar('definir_papel', {
        p_obra: exigirUuid(obraId, 'obra'),
        p_usuario: exigirUuid(usuarioId, 'usuário'),
        p_papel: papel,
      })
    },

    async removerParticipante(obraId, usuarioId) {
      await chamar('remover_participante', {
        p_obra: exigirUuid(obraId, 'obra'),
        p_usuario: exigirUuid(usuarioId, 'usuário'),
      })
    },
  }
}
