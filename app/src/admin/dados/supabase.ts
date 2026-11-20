/**
 * Repositório do site de administração no Supabase: sessão própria do site (persistida no
 * navegador, chave separada da do Mini App), Edge Function `admin-sessao` para entrar e
 * RPCs `admin_*` para os dados.
 */
import { criarAcessosAdminSupabase } from '@modules/acessos/infra/AcessosAdminSupabaseAdapter.ts'
import { criarSessaoAdminSupabase } from '@modules/acessos/infra/SessaoAdminSupabaseAdapter.ts'
import { criarEtapasAdminSupabase } from '@modules/obras/infra/EtapasAdminSupabaseAdapter.ts'
import { criarObrasAdminSupabase } from '@modules/obras/infra/ObrasAdminSupabaseAdapter.ts'
import { criarOrganizacaoAdminSupabase } from '@modules/obras/infra/OrganizacaoAdminSupabaseAdapter.ts'
import { codigoDe, ehMensagemBruta, MENSAGEM_REDE, textoOuNulo, type Linha } from '@modules/obras/infra/validacao.ts'
import { criarModelosSupabase } from '@modules/modelos/infra/ModelosSupabaseAdapter.ts'
import { criarPlantasSupabase } from '@modules/plantas/infra/PlantasSupabaseAdapter.ts'
import { criarRaSupabase } from '@modules/ra/infra/RaSupabaseAdapter.ts'
import type { SupabaseClient } from '@supabase/supabase-js'
import { criarClienteSupabase } from '../../dados/supabase.ts'
import { configurarEnvioErros } from '../../shared/infra/erros.ts'
import type { RepositorioAdmin } from './repositorio.ts'
import { ErroAdmin, type ErroCliente, type ResumoOrfaos, type BoletimDaLista, type BoletimDetalhe, type BoletimEmitido, type EdicaoBoletim, type ListaTodosBoletins, type PedidoDaLista, type SnapshotBoletim, type EstadoEmissao, type ListaBoletins, type PedidoEmissao } from './tipos.ts'

export const CHAVE_SESSAO_ADMIN = 'miniappcofz-admin-auth'

/** Validade da URL assinada do PDF de um boletim (abre numa aba nova logo em seguida). */
const SEGUNDOS_URL_PDF = 300
const SEGUNDOS_URL_FOTO = 3600
/** Gerador do boletim (função da Vercel no mesmo domínio do site). */
const URL_PREVIA = '/api/previa-boletim'

const ESTADOS: EstadoEmissao[] = ['pendente', 'gerando', 'emitido', 'falhou']

type LinhaBoletim = Record<string, unknown>

export function boletimDe(l: LinhaBoletim): BoletimEmitido {
  return {
    id: String(l.id),
    data: String(l.data),
    revisao: Number(l.revisao ?? 0),
    numero: String(l.numero ?? ''),
    emitido_em: String(l.emitido_em ?? ''),
    emitido_por_nome: l.emitido_por_nome == null ? null : String(l.emitido_por_nome),
    pdf_path: l.pdf_path == null ? null : String(l.pdf_path),
    publicado: l.publicado === true,
    publicacao_estado: l.publicacao_estado == null ? null : String(l.publicacao_estado),
    publicacao_erro: l.publicacao_erro == null ? null : String(l.publicacao_erro),
    publicacao_tentativas: Number(l.publicacao_tentativas ?? 0),
  }
}

export function pedidoDe(l: LinhaBoletim): PedidoEmissao {
  const estado = ESTADOS.includes(l.estado as EstadoEmissao) ? (l.estado as EstadoEmissao) : 'pendente'
  return {
    id: Number(l.id ?? 0),
    data: String(l.data ?? ''),
    revisao: Number(l.revisao ?? 0),
    estado,
    tentativas: Number(l.tentativas ?? 0),
    erro: l.erro == null ? null : String(l.erro),
    atualizado_em: String(l.atualizado_em ?? ''),
    ...(typeof l.numero === 'string' ? { numero: l.numero } : {}),
  }
}

/**
 * `admin_listar_boletins` devolve `{boletins: [...], pedidos: [...]}`; aceita também só a lista
 * de boletins (sem pedidos).
 */
export function listaBoletinsDe(r: unknown): ListaBoletins {
  if (Array.isArray(r)) return { boletins: (r as LinhaBoletim[]).map(boletimDe), pedidos: [] }
  const o = (r && typeof r === 'object' ? r : {}) as { boletins?: unknown; pedidos?: unknown }
  return {
    boletins: Array.isArray(o.boletins) ? (o.boletins as LinhaBoletim[]).map(boletimDe) : [],
    pedidos: Array.isArray(o.pedidos) ? (o.pedidos as LinhaBoletim[]).map(pedidoDe) : [],
  }
}

export function boletimDaListaDe(l: LinhaBoletim): BoletimDaLista {
  return {
    ...boletimDe(l),
    etapa_slug: String(l.etapa_slug ?? ''),
    etapa_nome: String(l.etapa_nome ?? ''),
    base_numero: l.base_numero == null ? null : String(l.base_numero),
    editado: l.editado === true,
    tem_rascunho: l.tem_rascunho === true,
  }
}

export function pedidoDaListaDe(l: LinhaBoletim): PedidoDaLista {
  return {
    ...pedidoDe(l),
    etapa_slug: String(l.etapa_slug ?? ''),
    etapa_nome: String(l.etapa_nome ?? ''),
    editado: l.editado === true,
  }
}

/** `admin_listar_todos_boletins`: `{boletins, pedidos}` com etapa e marcas de edição. */
export function listaTodosBoletinsDe(r: unknown): ListaTodosBoletins {
  const o = (r && typeof r === 'object' ? r : {}) as { boletins?: unknown; pedidos?: unknown }
  return {
    boletins: Array.isArray(o.boletins) ? (o.boletins as LinhaBoletim[]).map(boletimDaListaDe) : [],
    pedidos: Array.isArray(o.pedidos) ? (o.pedidos as LinhaBoletim[]).map(pedidoDaListaDe) : [],
  }
}

function edicaoDe(v: unknown): EdicaoBoletim | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as EdicaoBoletim) : null
}

/** `admin_boletim`. O snapshot vem do banco já no formato do gerador; só garante as listas. */
export function boletimDetalheDe(l: LinhaBoletim): BoletimDetalhe {
  const snap = (l.snapshot && typeof l.snapshot === 'object' ? l.snapshot : {}) as Partial<SnapshotBoletim>
  const r = l.rascunho && typeof l.rascunho === 'object' ? (l.rascunho as LinhaBoletim) : null
  return {
    id: String(l.id),
    etapa_slug: String(l.etapa_slug ?? ''),
    etapa_nome: String(l.etapa_nome ?? ''),
    data: String(l.data ?? ''),
    revisao: Number(l.revisao ?? 0),
    numero: String(l.numero ?? ''),
    emitido_em: String(l.emitido_em ?? ''),
    emitido_por_nome: l.emitido_por_nome == null ? null : String(l.emitido_por_nome),
    pdf_path: l.pdf_path == null ? null : String(l.pdf_path),
    publicado: l.publicado === true,
    publicacao_estado: l.publicacao_estado == null ? null : String(l.publicacao_estado),
    ultima_revisao: l.ultima_revisao !== false,
    emissao_em_andamento: l.emissao_em_andamento === true,
    base_numero: l.base_numero == null ? null : String(l.base_numero),
    edicao: edicaoDe(l.edicao),
    snapshot: { ...snap, data: String(snap.data ?? l.data ?? ''), obras: snap.obras ?? [], tardios: snap.tardios ?? [] },
    rascunho: r
      ? {
          edicao: edicaoDe(r.edicao) ?? {},
          atualizado_em: String(r.atualizado_em ?? ''),
          atualizado_por_nome: r.atualizado_por_nome == null ? null : String(r.atualizado_por_nome),
        }
      : null,
  }
}

export function criarClienteAdmin(): SupabaseClient {
  return criarClienteSupabase({
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // O hash `#entrar=` é nosso; nada de sessão vinda da URL.
      detectSessionInUrl: false,
      storageKey: CHAVE_SESSAO_ADMIN,
    },
  })
}

interface ErroBruto {
  message?: unknown
  code?: unknown
}

function erroDaRpc(e: unknown): ErroAdmin {
  if (e instanceof ErroAdmin) return e
  if (e instanceof TypeError) return new ErroAdmin(MENSAGEM_REDE, { cause: e })
  const b = (typeof e === 'object' && e !== null ? e : {}) as ErroBruto
  const msg = typeof b.message === 'string' ? b.message : ''
  if (b.code === '42501') return new ErroAdmin('Acesso negado: apenas admins do Mini App.', { cause: e })
  if (b.code === '40001') return new ErroAdmin(msg || 'Os dados mudaram. Recarregue a página.', { cause: e })
  if (b.code === '28000' || /jwt/i.test(msg)) {
    return new ErroAdmin('Sua sessão expirou. Entre de novo.', { cause: e })
  }
  if (/failed to fetch|networkerror|load failed/i.test(msg)) return new ErroAdmin(MENSAGEM_REDE, { cause: e })
  return new ErroAdmin(msg || 'Não foi possível concluir a operação.', { cause: e })
}

export function criarRepositorioAdminSupabase(cliente: SupabaseClient = criarClienteAdmin()): RepositorioAdmin {
  configurarEnvioErros(cliente, 'admin')
  const base = String(import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '')
  const chave = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '')

  async function rpc<T>(nome: string, args?: Record<string, unknown>): Promise<T> {
    try {
      const { data, error } = await cliente.rpc(nome, args)
      if (error) throw error
      return data as T
    } catch (e) {
      throw erroDaRpc(e)
    }
  }

  /** Chama a Edge Function `admin-excluir-obra` com a sessão do admin; devolve o JSON da resposta. */
  async function funcaoExcluir(corpo: Record<string, unknown>, naoEncontrado: string): Promise<Record<string, unknown>> {
    const { data } = await cliente.auth.getSession()
    const token = data.session?.access_token
    if (!token) throw new ErroAdmin('Sua sessão expirou. Entre de novo.')
    let resposta: Response
    try {
      resposta = await fetch(`${base}/functions/v1/admin-excluir-obra`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: chave, Authorization: `Bearer ${token}` },
        body: JSON.stringify(corpo),
      })
    } catch (e) {
      throw new ErroAdmin(MENSAGEM_REDE, { cause: e })
    }
    const json = (await resposta.json().catch(() => null)) as Record<string, unknown> | null
    if (resposta.status !== 200 || !json) {
      const texto = [json?.erro, json?.mensagem, json?.error].find((v) => typeof v === 'string') as string | undefined
      const padrao: Record<number, string> = {
        401: 'Sua sessão expirou. Entre de novo.',
        403: 'Acesso negado: apenas admins do Mini App.',
        404: naoEncontrado,
      }
      throw new ErroAdmin(texto ?? padrao[resposta.status] ?? 'Não foi possível excluir. Tente de novo.')
    }
    return json
  }

  /** Chama o gerador (`/api/previa-boletim`) com o JWT do admin e devolve o PDF. */
  async function buscarPrevia(url: string, init: RequestInit, naoEncontrado: string): Promise<Blob> {
    const { data: sessao } = await cliente.auth.getSession()
    const token = sessao.session?.access_token
    if (!token) throw new ErroAdmin('Sua sessão expirou. Entre de novo.')
    let resposta: Response
    try {
      resposta = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` } })
    } catch (e) {
      throw new ErroAdmin(MENSAGEM_REDE, { cause: e })
    }
    if (resposta.status !== 200) {
      const json = (await resposta.json().catch(() => null)) as { erro?: unknown } | null
      const padrao: Record<number, string> = {
        401: 'Sua sessão expirou. Entre de novo.',
        403: 'Acesso negado: apenas admins do Mini App.',
        404: naoEncontrado,
      }
      throw new ErroAdmin(
        typeof json?.erro === 'string' ? json.erro : (padrao[resposta.status] ?? 'Não foi possível gerar a prévia. Tente de novo.'),
      )
    }
    return await resposta.blob()
  }

  const ra = criarRaSupabase(cliente, rpc)
  const modelos = criarModelosSupabase(cliente, rpc)
  const plantas = criarPlantasSupabase(cliente, rpc)
  const sessao = criarSessaoAdminSupabase(cliente, erroDaRpc)
  const acessos = criarAcessosAdminSupabase(rpc)
  const etapas = criarEtapasAdminSupabase(rpc, funcaoExcluir)
  const organizacao = criarOrganizacaoAdminSupabase(cliente, rpc, base)
  const obras = criarObrasAdminSupabase(rpc, funcaoExcluir)

  return {
    listarRA: ra.listarRA,
    definirQr: ra.definirQr,
    removerQr: ra.removerQr,
    estadoSessao: sessao.estadoSessao,
    entrarComToken: sessao.entrarComToken,
    entrarComWidget: sessao.entrarComWidget,
    sair: sessao.sair,
    meuId: sessao.meuId,
    listarPessoas: acessos.listarPessoas,
    definirNomeExibicao: acessos.definirNomeExibicao,
    matrizAcessos: acessos.matrizAcessos,
    definirAcesso: acessos.definirAcesso,
    listarAdmins: acessos.listarAdmins,
    incluirAdmin: acessos.incluirAdmin,
    removerAdmin: acessos.removerAdmin,
    listarUsuarios: acessos.listarUsuarios,

    async listarBoletins(slug) {
      const r = await rpc<unknown>('admin_listar_boletins', { p_slug: slug })
      return listaBoletinsDe(r)
    },

    async pedirEmissao(slug, data) {
      try {
        const r = await rpc<Linha | null>('admin_pedir_emissao', { p_slug: slug, p_data: data })
        return pedidoDe(r ?? {})
      } catch (e) {
        if (codigoDe(e) === '23505' && ehMensagemBruta((e as ErroAdmin).message)) {
          throw new ErroAdmin('Já existe um pedido de emissão em andamento para esta data', { cause: e })
        }
        throw e
      }
    },

    async reenviarBoletim(slug, boletimId) {
      await rpc('admin_reenviar_boletim', { p_slug: slug, p_boletim: boletimId })
    },

    async excluirBoletim(_slug, boletimId) {
      const json = await funcaoExcluir({ acao: 'excluir_boletim', boletim_id: boletimId }, 'Boletim não encontrado')
      const m = (json.mensagens ?? {}) as { apagadas?: unknown; falhas?: unknown }
      return {
        numero: String(json.numero),
        data: String(json.data),
        revisoes: Number(json.revisoes ?? 0),
        mensagens: { apagadas: Number(m.apagadas ?? 0), falhas: Number(m.falhas ?? 0) },
        arquivos_erro: typeof json.arquivos_erro === 'string' ? json.arquivos_erro : null,
      }
    },

    async urlPdfBoletim(caminho) {
      try {
        const { data, error } = await cliente.storage.from('boletins').createSignedUrl(caminho, SEGUNDOS_URL_PDF)
        if (error) throw error
        return data.signedUrl
      } catch (e) {
        throw erroDaRpc(e)
      }
    },

    async previaBoletim(slug, data) {
      return await buscarPrevia(`${URL_PREVIA}?${new URLSearchParams({ etapa: slug, data })}`, {}, 'Etapa não encontrada')
    },

    async previaBoletimEditado(id, edicao) {
      return await buscarPrevia(
        URL_PREVIA,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ boletim_id: id, edicao }) },
        'Boletim não encontrado',
      )
    },

    async listarTodosBoletins(filtro = {}) {
      const r = await rpc<unknown>('admin_listar_todos_boletins', {
        p_etapa: filtro.etapa || null,
        p_de: filtro.de || null,
        p_ate: filtro.ate || null,
      })
      return listaTodosBoletinsDe(r)
    },

    async boletim(id) {
      return boletimDetalheDe(await rpc<Linha>('admin_boletim', { p_id: id }))
    },

    async salvarRascunhoBoletim(id, edicao) {
      const r = await rpc<Linha | null>('admin_salvar_rascunho_boletim', { p_id: id, p_edicao: edicao })
      return r && r.atualizado_em != null ? { atualizado_em: String(r.atualizado_em) } : null
    },

    async retificarBoletim(id, edicao) {
      try {
        return pedidoDe((await rpc<Linha | null>('admin_retificar_boletim', { p_id: id, p_edicao: edicao })) ?? {})
      } catch (e) {
        if (codigoDe(e) === '23505' && ehMensagemBruta((e as ErroAdmin).message)) {
          throw new ErroAdmin('Já há uma emissão em andamento para este dia', { cause: e })
        }
        throw e
      }
    },

    async urlsFotos(paths) {
      const unicos = [...new Set(paths)]
      if (unicos.length === 0) return {}
      try {
        const { data, error } = await cliente.storage.from('fotos').createSignedUrls(unicos, SEGUNDOS_URL_FOTO)
        if (error) throw error
        const r: Record<string, string> = {}
        for (const x of data ?? []) if (x.path && x.signedUrl && !x.error) r[x.path] = x.signedUrl
        return r
      } catch (e) {
        throw erroDaRpc(e)
      }
    },

    listarEtapas: etapas.listarEtapas,
    salvarEtapa: etapas.salvarEtapa,
    obterEtapa: etapas.obterEtapa,
    salvarAditivo: etapas.salvarAditivo,
    removerAditivo: etapas.removerAditivo,
    definirResponsaveis: etapas.definirResponsaveis,
    arquivarEtapa: etapas.arquivarEtapa,
    desvincularEtapa: etapas.desvincularEtapa,
    resumoEtapa: etapas.resumoEtapa,
    excluirEtapa: etapas.excluirEtapa,
    obterOrganizacao: organizacao.obterOrganizacao,
    salvarOrganizacao: organizacao.salvarOrganizacao,
    enviarLogo: organizacao.enviarLogo,
    listarObras: obras.listarObras,
    obterObra: obras.obterObra,
    salvarObra: obras.salvarObra,
    salvarPavimentos: obras.salvarPavimentos,
    salvarConfig: obras.salvarConfig,
    exportarObra: obras.exportarObra,
    arquivarObra: obras.arquivarObra,
    resumoObra: obras.resumoObra,
    excluirObra: obras.excluirObra,
    listarExclusoes: obras.listarExclusoes,
    limparExclusao: obras.limparExclusao,

    obterEditorPlanta: plantas.obterEditorPlanta,
    listarPublicacoes: plantas.listarPublicacoes,
    enviarArquivo: plantas.enviarArquivo,
    baixarOriginal: plantas.baixarOriginal,
    publicarRevisao: plantas.publicarRevisao,
    listarModelosAdmin: modelos.listarModelosAdmin,
    registrarModelo: modelos.registrarModelo,
    retirarModelo: modelos.retirarModelo,

    async listarErrosCliente(limite = 200) {
      return ((await rpc<Linha[]>('admin_listar_erros_cliente', { p_limite: limite })) ?? []).map(
        (l): ErroCliente => ({
          id: Number(l.id),
          criado_em: String(l.criado_em),
          usuario_id: l.usuario_id == null ? null : String(l.usuario_id),
          usuario_nome: l.usuario_nome == null ? null : String(l.usuario_nome),
          app: l.app === 'admin' ? 'admin' : 'miniapp',
          versao: l.versao == null ? null : String(l.versao),
          rota: l.rota == null ? null : String(l.rota),
          mensagem: String(l.mensagem),
          pilha: l.pilha == null ? null : String(l.pilha),
          agente: l.agente == null ? null : String(l.agente),
          contexto: (l.contexto ?? null) as Record<string, unknown> | null,
        }),
      )
    },

    async resumoOrfaos() {
      const r = (await rpc<Linha>('admin_resumo_orfaos')) ?? {}
      const lista = (v: unknown) => (Array.isArray(v) ? (v as Linha[]) : [])
      const numeroOuNulo = (v: unknown) => (v == null ? null : Number(v))
      return {
        buckets: lista(r.buckets).map((b) => ({
          bucket: String(b.bucket),
          quantidade: Number(b.quantidade),
          bytes: Number(b.bytes),
        })),
        maiores: lista(r.maiores).map((m) => ({
          bucket: String(m.bucket),
          caminho: String(m.caminho),
          tamanho: numeroOuNulo(m.tamanho),
          criado_em: textoOuNulo(m.criado_em),
          detectado_em: String(m.detectado_em),
        })),
      } satisfies ResumoOrfaos
    },
  }
}
