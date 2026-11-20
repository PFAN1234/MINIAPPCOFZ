import { ErroAdmin } from '../../../admin/dados/tipos.ts'
import type { EtapasAdminRepositorio } from '../application/ports/EtapasAdminRepositorio.port.ts'
import type { Aditivo, BucketObra, EtapaDetalhe, EtapaLista, Responsavel, ResultadoExclusaoEtapa, ResumoEtapa } from '../domain/tiposAdmin.ts'
import { codigoDe, ehMensagemBruta, numeroOuNulo, textoOuNulo, type FuncaoExcluir, type Linha, type Rpc } from './validacao.ts'

/** `obras` pode vir como contagem ou como lista. */
const contagem = (v: unknown) => (Array.isArray(v) ? v.length : Number(v ?? 0))

const aditivoDe = (l: Linha): Aditivo => ({
  id: String(l.id),
  etapa_id: String(l.etapa_id ?? ''),
  numero: String(l.numero),
  data: String(l.data),
  prazo_dias: Number(l.prazo_dias ?? 0),
  valor: Number(l.valor ?? 0),
  descricao: textoOuNulo(l.descricao),
})

const responsavelDe = (l: Linha): Responsavel => ({
  usuario_id: String(l.usuario_id),
  nome: String(l.nome ?? ''),
  nome_exibicao: textoOuNulo(l.nome_exibicao),
  funcao: String(l.funcao ?? 'Fiscal'),
  ordem: Number(l.ordem ?? 0),
})

function etapaDetalheDe(l: Linha): EtapaDetalhe {
  const prazo = l.prazo as Linha | null | undefined
  return {
    id: String(l.id),
    slug: String(l.slug),
    nome: String(l.nome),
    ordem: Number(l.ordem ?? 0),
    arquivada_em: textoOuNulo(l.arquivada_em),
    telegram_vinculado: l.telegram_vinculado === true,
    telegram_chat_titulo: textoOuNulo(l.telegram_chat_titulo),
    sigla: textoOuNulo(l.sigla),
    endereco: textoOuNulo(l.endereco),
    latitude: numeroOuNulo(l.latitude),
    longitude: numeroOuNulo(l.longitude),
    fuso: textoOuNulo(l.fuso) ?? 'America/Sao_Paulo',
    estacao: textoOuNulo(l.estacao),
    estacao_reserva: textoOuNulo(l.estacao_reserva),
    boletim_horario: (textoOuNulo(l.boletim_horario) ?? '23:30').slice(0, 5),
    objeto: textoOuNulo(l.objeto),
    local: textoOuNulo(l.local),
    contratante: textoOuNulo(l.contratante),
    contrato: textoOuNulo(l.contrato),
    contratada: textoOuNulo(l.contratada),
    contratada_cnpj: textoOuNulo(l.contratada_cnpj),
    os_numero: textoOuNulo(l.os_numero),
    os_data: textoOuNulo(l.os_data),
    vigencia_meses: numeroOuNulo(l.vigencia_meses),
    valor_original: numeroOuNulo(l.valor_original),
    area_construida_m2: numeroOuNulo(l.area_construida_m2),
    aditivos: Array.isArray(l.aditivos) ? (l.aditivos as Linha[]).map(aditivoDe) : [],
    responsaveis: Array.isArray(l.responsaveis) ? (l.responsaveis as Linha[]).map(responsavelDe) : [],
    prazo: prazo
      ? {
          termino_original: String(prazo.termino_original),
          prazo_aditivos_dias: Number(prazo.prazo_aditivos_dias ?? 0),
          termino_atual: String(prazo.termino_atual),
          valor_atual: numeroOuNulo(prazo.valor_atual),
        }
      : null,
    faltando: Array.isArray(l.faltando) ? l.faltando.map(String) : [],
  }
}

/** `rpc` traduz os erros das chamadas admin; `funcaoExcluir` chama a Edge Function `admin-excluir-obra`. */
export function criarEtapasAdminSupabase(rpc: Rpc, funcaoExcluir: FuncaoExcluir): EtapasAdminRepositorio {
  return {
    async listarEtapas() {
      const linhas = await rpc<Linha[] | null>('admin_listar_etapas')
      return (linhas ?? []).map(
        (l): EtapaLista => ({
          id: String(l.id),
          slug: String(l.slug),
          nome: String(l.nome),
          ordem: Number(l.ordem ?? 0),
          arquivada_em: textoOuNulo(l.arquivada_em),
          telegram_vinculado: l.telegram_vinculado === true,
          telegram_chat_titulo: textoOuNulo(l.telegram_chat_titulo),
          obras: contagem(l.obras),
          obras_arquivadas: contagem(l.obras_arquivadas),
          sigla: textoOuNulo(l.sigla),
          faltando: contagem(l.faltando),
        }),
      )
    },

    async salvarEtapa(dados) {
      try {
        return etapaDetalheDe(await rpc<Linha>('admin_salvar_etapa', { p: dados }))
      } catch (e) {
        if (codigoDe(e) === '23505' && ehMensagemBruta((e as ErroAdmin).message)) {
          const texto = /sigla/i.test((e as ErroAdmin).message)
            ? `Já existe uma etapa com a sigla ${dados.sigla ?? ''}`
            : `Já existe uma etapa com o slug ${dados.slug ?? ''}`
          throw new ErroAdmin(texto, { cause: e })
        }
        throw e
      }
    },

    async obterEtapa(slug) {
      const r = await rpc<Linha | null>('admin_obter_etapa', { p_slug: slug })
      if (!r) throw new ErroAdmin('Etapa não encontrada')
      return etapaDetalheDe(r)
    },

    async salvarAditivo(dados) {
      try {
        return aditivoDe(await rpc<Linha>('admin_salvar_aditivo', { p: dados }))
      } catch (e) {
        if (codigoDe(e) === '23505' && ehMensagemBruta((e as ErroAdmin).message)) {
          throw new ErroAdmin(`Já existe o aditivo ${dados.numero} nesta etapa`, { cause: e })
        }
        throw e
      }
    },

    async removerAditivo(id) {
      await rpc('admin_remover_aditivo', { p_id: id })
    },

    async definirResponsaveis(etapaId, lista) {
      const r = await rpc<Linha[] | null>('admin_definir_responsaveis', { p_etapa: etapaId, p: lista })
      return (r ?? []).map(responsavelDe)
    },

    async arquivarEtapa(slug, arquivada) {
      const r = await rpc<{ arquivada_em: string | null } | null>('admin_arquivar_etapa', {
        p_slug: slug,
        p_arquivada: arquivada,
      })
      return r?.arquivada_em ?? null
    },

    async desvincularEtapa(slug) {
      await rpc('admin_desvincular_etapa', { p_slug: slug })
    },

    async resumoEtapa(slug) {
      const r = await rpc<ResumoEtapa | null>('admin_resumo_etapa', { p_slug: slug })
      if (!r) throw new ErroAdmin('Etapa não encontrada')
      return { obras: r.obras ?? [], total: r.total }
    },

    async excluirEtapa(slug, confirmacao) {
      const json = await funcaoExcluir({ acao: 'excluir_etapa', slug, confirmacao }, 'Etapa não encontrada')
      const lista = Array.isArray(json.exclusoes) ? (json.exclusoes as Linha[]) : []
      const r: ResultadoExclusaoEtapa = {
        exclusoes: lista.map((x) => ({
          exclusao_id: String(x.exclusao_id),
          removidos: (x.removidos as Partial<Record<BucketObra, number>> | null) ?? {},
          pendente: Boolean(x.pendente),
          erro: textoOuNulo(x.erro),
        })),
        pendente: Boolean(json.pendente),
        erro: textoOuNulo(json.erro),
      }
      return r
    },
  }
}
