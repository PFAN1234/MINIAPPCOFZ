import type { ConfigObra } from '@modules/plantas/domain/tipos.ts'
import { ErroAdmin } from '../../../admin/dados/tipos.ts'
import type { ObrasAdminRepositorio } from '../application/ports/ObrasAdminRepositorio.port.ts'
import type { BucketObra, Exclusao, ObraAdmin, ObraLista, PavimentoAdmin, PavimentoResumo, ResumoObra } from '../domain/tiposAdmin.ts'
import type { EtapaMemoria } from './EtapasAdminFixtureAdapter.ts'
import { copia } from './validacao.ts'

const SLUG = /^[a-z0-9-]+$/
const CODIGO = /^[a-z0-9][a-z0-9-]*$/

export interface ObraMemoria {
  id: string
  slug: string
  nome: string
  ordem: number
  pavimentos: (PavimentoResumo & { id: string; ambientes: number })[]
  config: ConfigObra | null
  config_atualizada_em: string | null
  config_atualizada_por: string | null
  arquivada_em: string | null
  etapa_id: string
  /** Grupo do Telegram do tópico vinculado (`obra.telegram_chat_id`); null sem vínculo. */
  telegram_chat_id: number | null
}

export interface OpcoesObrasAdminFixture {
  /** Obras da fixture (estado compartilhado com plantas e modelos; mutável). */
  obras: ObraMemoria[]
  etapas: readonly EtapaMemoria[]
  exigirAdmin: () => void
  proximoId: () => number
  /** Nome do usuário que aparece como autor (config e exclusões). */
  nomeUsuario: string
  /** Quantas plantas, ambientes e arquivos a obra tem (vêm das fixtures de plantas e modelos). */
  contagens: (o: ObraMemoria) => Pick<ResumoObra, 'ambientes' | 'plantas' | 'modelos' | 'arquivos'>
  /** Apaga ambientes, plantas e modelos da obra e devolve os arquivos removidos por bucket. */
  removerArquivos: (o: ObraMemoria) => Partial<Record<BucketObra, number>>
}

export type ObrasAdminFixture = ObrasAdminRepositorio & {
  /** Resumo do que a exclusão da obra apaga (usado também pelo resumo da etapa). */
  resumoDe(o: ObraMemoria): ResumoObra
  /** Mesma remoção de `admin_excluir_obra`, com o registro em `obra_excluida`. */
  removerObra(o: ObraMemoria, etapaNome: string | null): Exclusao
}

export function criarObrasAdminFixture(opc: OpcoesObrasAdminFixture): ObrasAdminFixture {
  const { obras, etapas, exigirAdmin, proximoId, nomeUsuario } = opc
  const exclusoes: Exclusao[] = []
  const VOCE = { nome: nomeUsuario }

  function resumoDe(ob: ObraMemoria): ResumoObra {
    return {
      registros: 0,
      fotos: 0,
      pavimentos: ob.pavimentos.length,
      participantes: 0,
      publicacoes_telegram: 0,
      ...opc.contagens(ob),
    }
  }

  function obraPorSlug(slug: string): ObraMemoria {
    const ob = obras.find((x) => x.slug === slug)
    if (!ob) throw new ErroAdmin('Obra não encontrada')
    return ob
  }
  const etapaDe = (ob: ObraMemoria): EtapaMemoria => etapas.find((e) => e.id === ob.etapa_id)!

  function removerObra(ob: ObraMemoria, etapaNome: string | null): Exclusao {
    const resumo = resumoDe(ob)
    obras.splice(obras.indexOf(ob), 1)
    const removidos = opc.removerArquivos(ob)
    const agora = new Date().toISOString()
    const exclusao: Exclusao = {
      id: `exclusao-${proximoId()}`,
      obra_id: ob.id,
      slug: ob.slug,
      nome: ob.nome,
      excluida_em: agora,
      excluida_por_nome: VOCE.nome,
      resumo,
      arquivos_removidos_em: agora,
      arquivos_removidos: removidos,
      arquivos_erro: null,
      etapa_nome: etapaNome,
    }
    exclusoes.unshift(exclusao)
    return exclusao
  }

  const ordenarPavs = (ob: ObraMemoria) =>
    [...ob.pavimentos].sort((a, b) => a.ordem - b.ordem || a.codigo.localeCompare(b.codigo))

  return {
    resumoDe,
    removerObra,

    async listarObras(): Promise<ObraLista[]> {
      exigirAdmin()
      return [...obras]
        .sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome))
        .map((o) => ({
          id: o.id,
          slug: o.slug,
          nome: o.nome,
          ordem: o.ordem,
          pavimentos: ordenarPavs(o).map(({ codigo, nome, ordem }) => ({ codigo, nome, ordem })),
          ambientes_ativos: o.pavimentos.reduce((s, p) => s + p.ambientes, 0),
          status: typeof o.config?.status === 'string' ? o.config.status : null,
          config_atualizada_em: o.config_atualizada_em,
          arquivada_em: o.arquivada_em,
          etapa_id: o.etapa_id,
          etapa_slug: etapaDe(o).slug,
          etapa_nome: etapaDe(o).nome,
          etapa_arquivada_em: etapaDe(o).arquivada_em,
        }))
    },

    async obterObra(slug): Promise<ObraAdmin> {
      exigirAdmin()
      const o = obraPorSlug(slug)
      const e = etapaDe(o)
      return copia({
        obra: {
          id: o.id,
          slug: o.slug,
          nome: o.nome,
          ordem: o.ordem,
          telegram_vinculado: o.telegram_chat_id !== null,
          arquivada_em: o.arquivada_em,
          etapa: {
            id: e.id,
            slug: e.slug,
            nome: e.nome,
            arquivada_em: e.arquivada_em,
            telegram_vinculado: e.telegram_chat_id !== null,
          },
        },
        pavimentos: ordenarPavs(o).map(
          (p): PavimentoAdmin => ({ ...p, ambientes_ativos: p.ambientes, plantas: p.ambientes > 0 ? 1 : 0 }),
        ),
        config: o.config,
        config_atualizada_em: o.config_atualizada_em,
        config_atualizada_por: o.config_atualizada_por,
      })
    },

    async salvarObra(d) {
      exigirAdmin()
      const nome = (d.nome ?? '').trim()
      if (!nome || nome.length > 120) throw new ErroAdmin('Informe o nome da obra (até 120 caracteres)')
      if (!Number.isInteger(d.ordem)) throw new ErroAdmin('O campo ordem precisa ser um número inteiro')
      const destino = d.etapa_id === undefined ? null : etapas.find((e) => e.id === d.etapa_id)
      if (destino === undefined) throw new ErroAdmin('Etapa não encontrada')
      if (d.id) {
        const o = obras.find((x) => x.id === d.id)
        if (!o) throw new ErroAdmin('Obra não encontrada')
        if (d.slug && d.slug !== o.slug) throw new ErroAdmin('O slug não pode ser alterado depois de criado')
        o.nome = nome
        o.ordem = d.ordem
        if (destino && destino.id !== o.etapa_id) {
          o.etapa_id = destino.id
          // Grupo diferente: o tópico vinculado não vale mais.
          if (o.telegram_chat_id !== destino.telegram_chat_id) o.telegram_chat_id = null
        }
        return { id: o.id, slug: o.slug, nome: o.nome, ordem: o.ordem }
      }
      const slug = d.slug ?? ''
      if (!SLUG.test(slug) || slug.length > 40) {
        throw new ErroAdmin('Slug inválido: use letras minúsculas, dígitos e hífen (até 40 caracteres)')
      }
      if (obras.some((x) => x.slug === slug)) throw new ErroAdmin(`Já existe uma obra com o slug ${slug}`)
      if (!destino) throw new ErroAdmin('Escolha a etapa da obra')
      const nova: ObraMemoria = {
        id: `obra-nova-${proximoId()}`,
        slug,
        nome,
        ordem: d.ordem,
        pavimentos: [],
        config: null,
        config_atualizada_em: null,
        config_atualizada_por: null,
        arquivada_em: null,
        etapa_id: destino.id,
        telegram_chat_id: null,
      }
      obras.push(nova)
      return { id: nova.id, slug, nome, ordem: nova.ordem }
    },

    async salvarPavimentos(slug, lista) {
      exigirAdmin()
      const o = obraPorSlug(slug)
      const vistos = new Set<string>()
      for (const p of lista) {
        if (!CODIGO.test(p.codigo) || p.codigo.length > 30) {
          throw new ErroAdmin(`Código de pavimento inválido: ${p.codigo}. Use letras minúsculas, dígitos e hífen (até 30)`)
        }
        if (!p.nome.trim() || p.nome.length > 80) {
          throw new ErroAdmin(`Informe o nome do pavimento ${p.codigo} (até 80 caracteres)`)
        }
        if (vistos.has(p.codigo)) throw new ErroAdmin(`Código de pavimento repetido: ${p.codigo}`)
        vistos.add(p.codigo)
      }
      const bloqueados = o.pavimentos.filter((p) => !vistos.has(p.codigo) && p.ambientes > 0)
      if (bloqueados.length > 0) {
        throw new ErroAdmin(
          `Não é possível apagar pavimento com ambientes ou plantas: ${bloqueados.map((p) => p.codigo).join(', ')}`,
        )
      }
      o.pavimentos = lista.map((p, i) => {
        const atual = o.pavimentos.find((x) => x.codigo === p.codigo)
        return {
          id: atual?.id ?? `${slug}-${p.codigo}`,
          codigo: p.codigo,
          nome: p.nome.trim(),
          ordem: Number.isInteger(p.ordem) ? p.ordem : i + 1,
          ambientes: atual?.ambientes ?? 0,
        }
      })
      return ordenarPavs(o).map(({ codigo, nome, ordem }) => ({ codigo, nome, ordem }))
    },

    async salvarConfig(slug, config) {
      exigirAdmin()
      const o = obraPorSlug(slug)
      if (typeof config !== 'object' || config === null || Array.isArray(config)) {
        throw new ErroAdmin('A configuração precisa ser um objeto JSON')
      }
      if (config.status !== undefined && config.status !== 'revisado' && config.status !== 'aguardando_revisao_humana') {
        throw new ErroAdmin('Status inválido: use aguardando_revisao_humana ou revisado')
      }
      o.config = copia(config)
      o.config_atualizada_em = new Date().toISOString()
      o.config_atualizada_por = VOCE.nome
    },

    async exportarObra(slug) {
      exigirAdmin()
      const o = obraPorSlug(slug)
      return {
        formato: 'miniappcofz-obra',
        versao: 1,
        exportado_em: new Date().toISOString(),
        obra: { slug: o.slug, nome: o.nome, ordem: o.ordem },
        pavimentos: ordenarPavs(o).map(({ codigo, nome, ordem }) => ({ codigo, nome, ordem })),
        config: copia(o.config),
        ambientes: [],
        plantas: [],
      }
    },

    async arquivarObra(slug, arquivada) {
      exigirAdmin()
      const o = obraPorSlug(slug)
      o.arquivada_em = arquivada ? (o.arquivada_em ?? new Date().toISOString()) : null
      return o.arquivada_em
    },

    async resumoObra(slug) {
      exigirAdmin()
      return resumoDe(obraPorSlug(slug))
    },

    async excluirObra(slug, confirmacao) {
      exigirAdmin()
      const o = obraPorSlug(slug)
      if ((confirmacao ?? '').trim() !== o.nome) {
        throw new ErroAdmin(`Para excluir, digite exatamente o nome da obra: ${o.nome}`)
      }
      const exclusao = removerObra(o, null)
      return { exclusao_id: exclusao.id, obra_id: o.id, arquivos_removidos: exclusao.arquivos_removidos ?? {}, pendente: false }
    },

    async listarExclusoes() {
      exigirAdmin()
      return copia(exclusoes)
    },

    async limparExclusao(id) {
      exigirAdmin()
      const e = exclusoes.find((x) => x.id === id)
      if (!e) throw new ErroAdmin('Exclusão não encontrada')
      e.arquivos_removidos_em = new Date().toISOString()
      e.arquivos_erro = null
      return { exclusao_id: e.id, obra_id: e.obra_id, arquivos_removidos: e.arquivos_removidos ?? {}, pendente: false }
    },
  }
}
