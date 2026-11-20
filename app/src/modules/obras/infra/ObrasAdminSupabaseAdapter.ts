import type { ConfigObra } from '@modules/plantas/domain/tipos.ts'
import type { ObrasAdminRepositorio } from '../application/ports/ObrasAdminRepositorio.port.ts'
import type { Exclusao, ObraAdmin, ObraLista, ObraSalva, PavimentoResumo, ResultadoExclusao, ResumoObra } from '../domain/tiposAdmin.ts'
import { textoOuNulo, type FuncaoExcluir, type Linha, type Rpc } from './validacao.ts'

/** `rpc` traduz os erros das chamadas admin; `funcaoExcluir` chama a Edge Function `admin-excluir-obra`. */
export function criarObrasAdminSupabase(rpc: Rpc, funcaoExcluir: FuncaoExcluir): ObrasAdminRepositorio {
  /** Ações `excluir` e `limpar` (uma obra). */
  async function excluirUma(corpo: Record<string, unknown>): Promise<ResultadoExclusao> {
    const json = await funcaoExcluir(corpo, 'Obra não encontrada')
    return {
      exclusao_id: String(json.exclusao_id),
      obra_id: String(json.obra_id),
      arquivos_removidos: (json.arquivos_removidos as ResultadoExclusao['arquivos_removidos'] | undefined) ?? {},
      pendente: Boolean(json.pendente),
      ...(typeof json.erro === 'string' ? { erro: json.erro } : {}),
    }
  }

  return {
    async listarObras() {
      const linhas = await rpc<Linha[]>('admin_listar_obras')
      return (linhas ?? []).map(
        (l): ObraLista => ({
          id: String(l.id),
          slug: String(l.slug),
          nome: String(l.nome),
          ordem: Number(l.ordem),
          pavimentos: (l.pavimentos as PavimentoResumo[] | null) ?? [],
          ambientes_ativos: Number(l.ambientes_ativos ?? 0),
          status: l.status == null ? null : String(l.status),
          config_atualizada_em: l.config_atualizada_em == null ? null : String(l.config_atualizada_em),
          arquivada_em: l.arquivada_em == null ? null : String(l.arquivada_em),
          etapa_id: String(l.etapa_id ?? ''),
          etapa_slug: String(l.etapa_slug ?? ''),
          etapa_nome: String(l.etapa_nome ?? ''),
          etapa_arquivada_em: textoOuNulo(l.etapa_arquivada_em),
        }),
      )
    },

    async obterObra(slug) {
      const d = await rpc<ObraAdmin>('admin_obter_obra', { p_slug: slug })
      const e = d.obra.etapa as (ObraAdmin['obra']['etapa'] & Linha) | null | undefined
      return {
        ...d,
        obra: {
          ...d.obra,
          etapa: e
            ? {
                id: String(e.id),
                slug: String(e.slug),
                nome: String(e.nome),
                arquivada_em: textoOuNulo(e.arquivada_em),
                telegram_vinculado: e.telegram_vinculado === true,
              }
            : null,
        },
      }
    },

    salvarObra(dados) {
      return rpc<ObraSalva>('admin_salvar_obra', { p: dados })
    },

    salvarPavimentos(slug, lista) {
      return rpc<PavimentoResumo[]>('admin_salvar_pavimentos', { p_slug: slug, p: lista })
    },

    async salvarConfig(slug, config: ConfigObra) {
      await rpc('admin_salvar_config', { p_slug: slug, p_config: config })
    },

    exportarObra(slug) {
      return rpc<unknown>('admin_exportar_obra', { p_slug: slug })
    },

    async arquivarObra(slug, arquivada) {
      const r = await rpc<{ arquivada_em: string | null } | null>('admin_arquivar_obra', {
        p_slug: slug,
        p_arquivada: arquivada,
      })
      return r?.arquivada_em ?? null
    },

    resumoObra(slug) {
      return rpc<ResumoObra>('admin_resumo_obra', { p_slug: slug })
    },

    excluirObra(slug, confirmacao) {
      return excluirUma({ acao: 'excluir', slug, confirmacao })
    },

    async listarExclusoes() {
      return ((await rpc<Exclusao[] | null>('admin_listar_exclusoes')) ?? []).map((e) => ({
        ...e,
        etapa_nome: e.etapa_nome ?? null,
      }))
    },

    limparExclusao(id) {
      return excluirUma({ acao: 'limpar', exclusao_id: id })
    },
  }
}
