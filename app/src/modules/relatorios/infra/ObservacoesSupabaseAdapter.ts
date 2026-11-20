import type { SupabaseClient } from '@supabase/supabase-js'
import type { ObservacoesRepositorio } from '@modules/relatorios/application/ports/ObservacoesRepositorio.port.ts'
import type { NovaObservacao, Observacao, ObservacoesDoDia } from '@modules/relatorios/domain/tipos.ts'
import { FUSO_PADRAO, dataNoFuso } from '@shared/kernel/fuso.ts'
import { ErroEnvio, erroDoSupabase } from '../../../dados/erros.ts'
import { nomeMostrado } from '../../../dados/nome.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
type Linha = Record<string, unknown>

function exigirUuid(valor: string, nome: string): string {
  if (!UUID.test(valor)) throw new ErroEnvio('validacao', `Identificador inválido (${nome}).`)
  return valor
}

/** Linha de `observacoes_do_dia` (ou o retorno de `salvar_observacao`) no tipo do app. */
function mapearObservacao(l: Linha, padrao: { minha: boolean; travada: boolean }): Observacao {
  const autor = (l.autor as Linha | null) ?? {}
  return {
    id: String(l.id),
    data: String(l.data),
    texto: String(l.texto),
    escrito_em: String(l.escrito_em),
    editado_em: l.editado_em ? String(l.editado_em) : null,
    autor: { id: String(autor.id ?? ''), nome: nomeMostrado(autor) ?? 'Autor desconhecido' },
    minha: typeof l.minha === 'boolean' ? l.minha : padrao.minha,
    travada: typeof l.travada === 'boolean' ? l.travada : padrao.travada,
  }
}

export function criarObservacoesSupabase(cliente: SupabaseClient): ObservacoesRepositorio {
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
    async observacoesDoDia(obraId): Promise<ObservacoesDoDia> {
      const [dados, obraLinha] = await Promise.all([
        chamar('observacoes_do_dia', { p_obra: exigirUuid(obraId, 'obra') }),
        cliente.from('obra').select('etapa_id, etapa(fuso)').eq('id', obraId).maybeSingle(),
      ])
      const observacoes = ((dados ?? []) as Linha[]).map((l) =>
        mapearObservacao(l, { minha: false, travada: false }),
      )
      const obra = (obraLinha.error ? null : obraLinha.data) as Linha | null
      const fusoEtapa = (obra?.etapa as Linha | null)?.fuso
      const fuso = typeof fusoEtapa === 'string' && fusoEtapa ? fusoEtapa : FUSO_PADRAO
      const data = observacoes[0]?.data ?? dataNoFuso(new Date(), fuso)
      let travada = observacoes[0]?.travada ?? false
      // Sem observações a RPC não diz se o dia travou: confere se já há boletim da etapa no dia.
      if (observacoes.length === 0 && obra?.etapa_id) {
        const { count, error } = await cliente
          .from('boletim')
          .select('id', { count: 'exact', head: true })
          .eq('etapa_id', String(obra.etapa_id))
          .eq('data', data)
        travada = !error && (count ?? 0) > 0
      }
      return { data, fuso, travada, observacoes }
    },

    async salvarObservacao(d: NovaObservacao) {
      const dados = await chamar('salvar_observacao', {
        p: {
          id: exigirUuid(d.id, 'observação'),
          obra_id: exigirUuid(d.obraId, 'obra'),
          texto: d.texto,
          escrito_em: d.escritoEm,
        },
      })
      return mapearObservacao(dados as Linha, { minha: true, travada: false })
    },

    async excluirObservacao(id) {
      await chamar('excluir_observacao', { p_id: exigirUuid(id, 'observação') })
    },
  }
}
