import type { UsuarioApp } from '@modules/acessos/domain/tipos.ts'
import { aplicarCampos, calcularFaltando, calcularPrazo, camposDe } from '@modules/obras/infra/camposEtapa.ts'
import { ErroAdmin } from '../../../admin/dados/tipos.ts'
import type { EtapasAdminRepositorio } from '../application/ports/EtapasAdminRepositorio.port.ts'
import type { Aditivo, BucketObra, CamposEtapa, EtapaDetalhe, EtapaLista, Responsavel, ResumoObra, Exclusao } from '../domain/tiposAdmin.ts'
import type { ObraMemoria } from './ObrasAdminFixtureAdapter.ts'
import { copia } from './validacao.ts'

const SLUG = /^[a-z0-9-]+$/

export interface EtapaMemoria extends CamposEtapa {
  aditivos: Aditivo[]
  /** Responsáveis na ordem (a `ordem` sai da posição). */
  responsaveis: { usuario_id: string; funcao: string }[]
  id: string
  slug: string
  nome: string
  ordem: number
  telegram_chat_id: number | null
  telegram_chat_titulo: string | null
  arquivada_em: string | null
}

export interface OpcoesEtapasAdminFixture {
  /** Etapas da fixture (estado compartilhado com boletins e obras; mutável). */
  etapas: EtapaMemoria[]
  /** Obras (mutável: a exclusão da etapa as remove via `removerObra`). */
  obras: readonly ObraMemoria[]
  usuarios: readonly Omit<UsuarioApp, 'eh_admin'>[]
  nomeExibicao: (usuarioId: string) => string | null
  exigirAdmin: () => void
  proximoId: () => number
  resumoObra: (o: ObraMemoria) => ResumoObra
  removerObra: (o: ObraMemoria, etapaNome: string | null) => Exclusao
  /** Limpa o que depende da etapa em outros contextos (boletins e pedidos). */
  aoExcluirEtapa: (etapaId: string) => void
}

export type EtapasAdminFixture = EtapasAdminRepositorio

export function criarEtapasAdminFixture(opc: OpcoesEtapasAdminFixture): EtapasAdminFixture {
  const { etapas, obras, usuarios, nomeExibicao, exigirAdmin, proximoId } = opc
  const USUARIOS_BASE = usuarios
  const resumoDe = opc.resumoObra
  const removerObra = opc.removerObra

  function etapaPorSlug(slug: string): EtapaMemoria {
    const e = etapas.find((x) => x.slug === slug)
    if (!e) throw new ErroAdmin('Etapa não encontrada')
    return e
  }
  const nomeDaPessoa = (id: string) => USUARIOS_BASE.find((u) => u.id === id)?.nome ?? ''
  function responsaveisDe(e: EtapaMemoria): Responsavel[] {
    return e.responsaveis.map((r, i) => ({
      usuario_id: r.usuario_id,
      nome: nomeDaPessoa(r.usuario_id),
      nome_exibicao: nomeExibicao(r.usuario_id),
      funcao: r.funcao,
      ordem: i,
    }))
  }
  function detalheDe(e: EtapaMemoria): EtapaDetalhe {
    const campos = camposDe(e)
    return {
      ...campos,
      id: e.id,
      slug: e.slug,
      nome: e.nome,
      ordem: e.ordem,
      arquivada_em: e.arquivada_em,
      telegram_vinculado: e.telegram_chat_id !== null,
      telegram_chat_titulo: e.telegram_chat_titulo,
      aditivos: copia(e.aditivos).sort((a, b) => a.data.localeCompare(b.data) || a.numero.localeCompare(b.numero)),
      responsaveis: responsaveisDe(e),
      prazo: calcularPrazo(campos, e.aditivos),
      faltando: calcularFaltando(campos, e.responsaveis.length),
    }
  }

  return {
    async listarEtapas(): Promise<EtapaLista[]> {
      exigirAdmin()
      return [...etapas]
        .sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome))
        .map((e) => {
          const daEtapa = obras.filter((o) => o.etapa_id === e.id)
          return {
            id: e.id,
            slug: e.slug,
            nome: e.nome,
            ordem: e.ordem,
            arquivada_em: e.arquivada_em,
            telegram_vinculado: e.telegram_chat_id !== null,
            telegram_chat_titulo: e.telegram_chat_titulo,
            obras: daEtapa.length,
            obras_arquivadas: daEtapa.filter((o) => o.arquivada_em).length,
            sigla: e.sigla,
            faltando: calcularFaltando(camposDe(e), e.responsaveis.length).length,
          }
        })
    },

    async salvarEtapa(d) {
      exigirAdmin()
      const nome = (d.nome ?? '').trim()
      if (!nome || nome.length > 120) throw new ErroAdmin('Informe o nome da etapa (até 120 caracteres)')
      if (!Number.isInteger(d.ordem)) throw new ErroAdmin('O campo ordem precisa ser um número inteiro')
      if (d.id) {
        const e = etapas.find((x) => x.id === d.id)
        if (!e) throw new ErroAdmin('Etapa não encontrada')
        const campos = aplicarCampos(
          camposDe(e),
          d,
          etapas.filter((x) => x !== e && x.sigla !== null).map((x) => x.sigla as string),
        )
        e.nome = nome
        e.ordem = d.ordem
        Object.assign(e, campos)
        return detalheDe(e)
      }
      const slug = d.slug ?? ''
      if (!SLUG.test(slug) || slug.length > 40) {
        throw new ErroAdmin('Slug inválido: use letras minúsculas, dígitos e hífen (até 40 caracteres)')
      }
      if (etapas.some((x) => x.slug === slug)) throw new ErroAdmin(`Já existe uma etapa com o slug ${slug}`)
      const campos = aplicarCampos(
        null,
        d,
        etapas.filter((x) => x.sigla !== null).map((x) => x.sigla as string),
      )
      const nova: EtapaMemoria = {
        ...campos,
        id: `etapa-nova-${proximoId()}`,
        slug,
        nome,
        ordem: d.ordem,
        telegram_chat_id: null,
        telegram_chat_titulo: null,
        arquivada_em: null,
        aditivos: [],
        responsaveis: [],
      }
      etapas.push(nova)
      return detalheDe(nova)
    },

    async obterEtapa(slug) {
      exigirAdmin()
      return detalheDe(etapaPorSlug(slug))
    },

    async salvarAditivo(d) {
      exigirAdmin()
      const e = etapas.find((x) => x.id === d.etapa_id)
      if (!e) throw new ErroAdmin('Etapa não encontrada')
      const numero = (d.numero ?? '').trim()
      if (!numero || numero.length > 40) throw new ErroAdmin('Informe o número do aditivo (até 40 caracteres)')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.data ?? '') || Number.isNaN(Date.parse(d.data))) {
        throw new ErroAdmin('Data do aditivo inválida: use AAAA-MM-DD')
      }
      if (!Number.isInteger(d.prazo_dias)) throw new ErroAdmin('O prazo do aditivo precisa ser um número inteiro de dias')
      if (!Number.isFinite(d.valor)) throw new ErroAdmin('O valor do aditivo precisa ser um número')
      const descricao = (d.descricao ?? '').trim() || null
      if (descricao && descricao.length > 300) throw new ErroAdmin('A descrição do aditivo pode ter até 300 caracteres')
      if (e.aditivos.some((a) => a.numero === numero && a.id !== d.id)) {
        throw new ErroAdmin(`Já existe o aditivo ${numero} nesta etapa`)
      }
      const valor = Math.round(d.valor * 100) / 100
      if (d.id) {
        const atual = e.aditivos.find((a) => a.id === d.id)
        if (!atual) throw new ErroAdmin('Aditivo não encontrado')
        Object.assign(atual, { numero, data: d.data, prazo_dias: d.prazo_dias, valor, descricao })
        return copia(atual)
      }
      const novo: Aditivo = { id: `aditivo-novo-${proximoId()}`, etapa_id: e.id, numero, data: d.data, prazo_dias: d.prazo_dias, valor, descricao }
      e.aditivos.push(novo)
      return copia(novo)
    },

    async removerAditivo(id) {
      exigirAdmin()
      for (const e of etapas) {
        const i = e.aditivos.findIndex((a) => a.id === id)
        if (i >= 0) {
          e.aditivos.splice(i, 1)
          return
        }
      }
      throw new ErroAdmin('Aditivo não encontrado')
    },

    async definirResponsaveis(etapaId, lista) {
      exigirAdmin()
      const e = etapas.find((x) => x.id === etapaId)
      if (!e) throw new ErroAdmin('Etapa não encontrada')
      const vistos = new Set<string>()
      const nova = lista.map((r) => {
        if (vistos.has(r.usuario_id)) throw new ErroAdmin('Responsável repetido na lista')
        vistos.add(r.usuario_id)
        if (!USUARIOS_BASE.some((u) => u.id === r.usuario_id)) throw new ErroAdmin('Usuário não encontrado')
        const funcao = (r.funcao ?? '').trim() || 'Fiscal'
        if (funcao.length > 60) throw new ErroAdmin('A função pode ter até 60 caracteres')
        return { usuario_id: r.usuario_id, funcao }
      })
      e.responsaveis = nova
      return responsaveisDe(e)
    },

    async arquivarEtapa(slug, arquivada) {
      exigirAdmin()
      const e = etapaPorSlug(slug)
      e.arquivada_em = arquivada ? (e.arquivada_em ?? new Date().toISOString()) : null
      return e.arquivada_em
    },

    async desvincularEtapa(slug) {
      exigirAdmin()
      const e = etapaPorSlug(slug)
      e.telegram_chat_id = null
      e.telegram_chat_titulo = null
      for (const o of obras) if (o.etapa_id === e.id) o.telegram_chat_id = null
    },

    async resumoEtapa(slug) {
      exigirAdmin()
      const e = etapaPorSlug(slug)
      const daEtapa = [...obras]
        .filter((o) => o.etapa_id === e.id)
        .sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome))
      const total: ResumoObra = {
        registros: 0,
        fotos: 0,
        ambientes: 0,
        pavimentos: 0,
        plantas: 0,
        modelos: 0,
        participantes: 0,
        publicacoes_telegram: 0,
        arquivos: { fotos: 0, plantas: 0, originais: 0, modelos: 0 },
      }
      for (const o of daEtapa) {
        const r = resumoDe(o)
        for (const k of Object.keys(r) as (keyof ResumoObra)[]) {
          if (k === 'arquivos') {
            for (const b of Object.keys(r.arquivos) as BucketObra[]) total.arquivos[b] += r.arquivos[b]
          } else total[k] += r[k]
        }
      }
      return { obras: daEtapa.map((o) => ({ slug: o.slug, nome: o.nome })), total }
    },

    async excluirEtapa(slug, confirmacao) {
      exigirAdmin()
      const e = etapaPorSlug(slug)
      if ((confirmacao ?? '').trim() !== e.nome) {
        throw new ErroAdmin(`Para excluir, digite exatamente o nome da etapa: ${e.nome}`)
      }
      const feitas = obras.filter((o) => o.etapa_id === e.id).map((o) => removerObra(o, e.nome))
      etapas.splice(etapas.indexOf(e), 1)
      // Como `admin_excluir_etapa`: os boletins (e os pedidos) da etapa saem antes.
      opc.aoExcluirEtapa(e.id)
      return {
        exclusoes: feitas.map((x) => ({
          exclusao_id: x.id,
          removidos: x.arquivos_removidos ?? {},
          pendente: false,
          erro: null,
        })),
        pendente: false,
        erro: null,
      }
    },
  }
}
