/**
 * Repositório do site de administração no Supabase: sessão própria do site (persistida no
 * navegador, chave separada da do Mini App), Edge Function `admin-sessao` para entrar e
 * RPCs `admin_*` para os dados.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { criarClienteSupabase } from '../../dados/supabase.ts'
import type { RepositorioAdmin } from './repositorio.ts'
import {
  ErroAdmin,
  CAMINHO_LOGO,
  novoCaminhoLogo,
  problemaDoLogo,
  type Admin,
  type BucketObra,
  type ConfigObra,
  type Aditivo,
  type BoletimDaLista,
  type BoletimDetalhe,
  type BoletimEmitido,
  type EdicaoBoletim,
  type ListaTodosBoletins,
  type PedidoDaLista,
  type SnapshotBoletim,
  type EstadoEmissao,
  type ListaBoletins,
  type PedidoEmissao,
  type EtapaDetalhe,
  type EtapaLista,
  type Pessoa,
  type Responsavel,
  type Organizacao,
  type ResultadoExclusaoEtapa,
  type ResumoEtapa,
  type DadosEditorPlanta,
  type AmbienteRA,
  type DadosModelos,
  type QrAmbiente,
  type Exclusao,
  type ModeloAdmin,
  type Publicacao,
  type RegistroModelo,
  type ResultadoExclusao,
  type ResumoObra,
  type ResultadoPublicacao,
  type DadosWidget,
  type EstadoSessao,
  type ObraAdmin,
  type ObraLista,
  type ObraSalva,
  type PavimentoResumo,
  type UsuarioApp,
} from './tipos.ts'

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

const MENSAGEM_REDE = 'Sem conexão com o servidor. Verifique a internet e tente de novo.'

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

type Linha = Record<string, unknown>

export function criarRepositorioAdminSupabase(cliente: SupabaseClient = criarClienteAdmin()): RepositorioAdmin {
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

  /** Chama a `admin-sessao` e grava a sessão devolvida. */
  async function entrar(corpo: Record<string, unknown>, mensagens: Record<number, string>): Promise<void> {
    let resposta: Response
    try {
      resposta = await fetch(`${base}/functions/v1/admin-sessao`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: chave },
        body: JSON.stringify(corpo),
      })
    } catch (e) {
      throw new ErroAdmin(MENSAGEM_REDE, { cause: e })
    }
    if (resposta.status !== 200) {
      throw new ErroAdmin(mensagens[resposta.status] ?? 'Não foi possível entrar. Tente de novo.')
    }
    const s = (await resposta.json().catch(() => null)) as {
      access_token?: string
      refresh_token?: string
    } | null
    if (!s?.access_token || !s.refresh_token) throw new ErroAdmin('Não foi possível entrar. Tente de novo.')
    const { error } = await cliente.auth.setSession({
      access_token: s.access_token,
      refresh_token: s.refresh_token,
    })
    if (error) throw new ErroAdmin('Não foi possível guardar a sessão. Tente de novo.', { cause: error })
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

  const textoOuNulo = (v: unknown) => (v == null ? null : String(v))
  /** `obras` pode vir como contagem ou como lista. */
  const contagem = (v: unknown) => (Array.isArray(v) ? v.length : Number(v ?? 0))

  function organizacaoDe(l: Linha | null): Organizacao {
    const logo = typeof l?.logo_path === 'string' && l.logo_path ? l.logo_path : null
    return {
      nome: typeof l?.nome === 'string' && l.nome ? l.nome : 'CO-FZ',
      logo_path: logo,
      logo_url: logo ? `${base}/storage/v1/object/public/organizacao/${logo}` : null,
      cabecalho: Array.isArray(l?.cabecalho) ? l.cabecalho.map(String) : [],
    }
  }

  const numeroOuNulo = (v: unknown) => (v == null ? null : Number(v))
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
  /** Mensagem crua do Postgres para violação de unicidade (as das RPCs já vêm em português). */
  const ehMensagemBruta = (msg: string) => /duplicate key|violates unique|unique constraint/i.test(msg)
  const codigoDe = (e: unknown) => {
    const causa = (e as ErroAdmin).cause
    return causa && typeof causa === 'object' ? ((causa as ErroBruto).code as unknown) : undefined
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

  return {
    async estadoSessao(): Promise<EstadoSessao> {
      const { data } = await cliente.auth.getSession()
      const usuario = data.session?.user
      if (!usuario) return { tipo: 'sem_sessao' }
      const nome = String((usuario.user_metadata as { nome?: unknown } | undefined)?.nome ?? '')
      const { data: admin, error } = await cliente.rpc('sou_admin')
      if (error) {
        const e = erroDaRpc(error)
        // Sessão guardada que não vale mais: volta para a tela de entrada.
        if (/sessão expirou/.test(e.message)) return { tipo: 'sem_sessao' }
        throw e
      }
      return { tipo: admin === true ? 'admin' : 'negado', usuario: { id: usuario.id, nome } }
    },

    entrarComToken(token) {
      return entrar(
        { acao: 'trocar', token },
        { 401: 'Link inválido, expirado ou já usado. Peça outro pelo botão Administração no Mini App.' },
      )
    },

    entrarComWidget(dados: DadosWidget) {
      return entrar(
        { acao: 'widget', dados },
        {
          401: 'Não foi possível confirmar o login do Telegram. Tente de novo.',
          403: 'Esta conta do Telegram não é admin do Mini App.',
        },
      )
    },

    async sair() {
      await cliente.auth.signOut({ scope: 'local' })
    },

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

    async listarPessoas() {
      return ((await rpc<Linha[] | null>('admin_listar_pessoas')) ?? []).map(
        (l): Pessoa => ({
          id: String(l.id),
          nome: String(l.nome ?? ''),
          nome_exibicao: textoOuNulo(l.nome_exibicao),
          username: textoOuNulo(l.username),
          telegram_id: Number(l.telegram_id),
          eh_admin: l.eh_admin === true,
          participacoes: Array.isArray(l.participacoes)
            ? (l.participacoes as Linha[]).map((p) => ({
                obra_slug: String(p.obra_slug ?? ''),
                obra_nome: String(p.obra_nome ?? ''),
                etapa_nome: String(p.etapa_nome ?? ''),
                papel: String(p.papel ?? ''),
              }))
            : [],
        }),
      )
    },

    async definirNomeExibicao(usuarioId, nome) {
      const r = await rpc<Linha>('admin_definir_nome_exibicao', { p_usuario: usuarioId, p_nome: nome })
      return { id: String(r.id), nome: String(r.nome ?? ''), nome_exibicao: textoOuNulo(r.nome_exibicao) }
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

    async obterOrganizacao() {
      const d = await rpc<Linha | Linha[] | null>('organizacao')
      return organizacaoDe(Array.isArray(d) ? (d[0] ?? null) : d)
    },

    async salvarOrganizacao(dados) {
      return organizacaoDe(await rpc<Linha | null>('admin_salvar_organizacao', { p: dados }))
    },

    async enviarLogo(arquivo) {
      const problema = problemaDoLogo(arquivo)
      if (problema) throw new ErroAdmin(problema)
      const caminho = novoCaminhoLogo(arquivo.type)
      if (!CAMINHO_LOGO.test(caminho)) throw new ErroAdmin('Caminho do logo inválido.')
      let erro: unknown
      try {
        const { error } = await cliente.storage
          .from('organizacao')
          .upload(caminho, arquivo, { upsert: false, contentType: arquivo.type, cacheControl: '31536000' })
        erro = error
      } catch (e) {
        throw new ErroAdmin(MENSAGEM_REDE, { cause: e })
      }
      if (erro) {
        const msg = (erro as { message?: string }).message ?? ''
        if (/row-level security|unauthorized|403/i.test(msg)) {
          throw new ErroAdmin('Sem permissão para enviar o logo (bucket organizacao).', { cause: erro })
        }
        if (/payload too large|413|exceeded/i.test(msg)) throw new ErroAdmin('O logo pode ter no máximo 1 MB.', { cause: erro })
        throw new ErroAdmin(`Falha ao enviar o logo: ${msg || 'erro do Storage'}`, { cause: erro })
      }
      return caminho
    },

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

    obterEditorPlanta(slug) {
      return rpc<DadosEditorPlanta>('admin_editor_planta', { p_slug: slug })
    },

    async listarPublicacoes(slug) {
      return ((await rpc<Publicacao[]>('admin_listar_publicacoes', { p_slug: slug })) ?? []).map((l) => ({
        ...l,
        resumo: (l.resumo ?? {}) as Record<string, unknown>,
      }))
    },

    async enviarArquivo(bucket, caminho, arquivo, tipo) {
      let erro: unknown
      try {
        const { error } = await cliente.storage.from(bucket).upload(caminho, arquivo, { upsert: true, contentType: tipo })
        erro = error
      } catch (e) {
        throw new ErroAdmin(MENSAGEM_REDE, { cause: e })
      }
      if (erro) {
        const msg = (erro as { message?: string }).message ?? ''
        if (/row-level security|unauthorized|403/i.test(msg)) {
          throw new ErroAdmin(`Sem permissão para gravar ${caminho} no Storage (${bucket}).`, { cause: erro })
        }
        if (/payload too large|413|exceeded/i.test(msg)) {
          throw new ErroAdmin(`Arquivo grande demais para o bucket ${bucket}: ${caminho}.`, { cause: erro })
        }
        throw new ErroAdmin(`Falha ao enviar ${caminho}: ${msg || 'erro do Storage'}`, { cause: erro })
      }
    },

    async baixarOriginal(caminho) {
      const { data, error } = await cliente.storage.from('originais').download(caminho)
      if (error || !data) throw new ErroAdmin('Não foi possível baixar o PDF guardado.', { cause: error })
      return new Uint8Array(await data.arrayBuffer())
    },

    publicarRevisao(slug, payload) {
      return rpc<ResultadoPublicacao>('admin_publicar_revisao', { p_slug: slug, p: payload })
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

    async listarModelosAdmin(slug) {
      const d = await rpc<DadosModelos | null>('admin_listar_modelos', { p_slug: slug })
      const numero = (v: unknown) => (v == null ? null : Number(v))
      return {
        modelos: (d?.modelos ?? []).map((m) => ({ ...m, bytes: Number(m.bytes) })),
        historico: (d?.historico ?? []).map((h) => ({ ...h, bytes: numero(h.bytes), ifc_bytes: numero(h.ifc_bytes) })),
      }
    },

    async registrarModelo(slug, registro: RegistroModelo) {
      const m = await rpc<ModeloAdmin>('admin_registrar_modelo', { p_slug: slug, p: registro })
      return { ...m, bytes: Number(m.bytes) }
    },

    async retirarModelo(slug, sigla) {
      await rpc('admin_retirar_modelo', { p_slug: slug, p_sigla: sigla })
    },

    async listarRA(obraId) {
      const lista = (await rpc<AmbienteRA[] | null>('admin_listar_ra', { p_obra: obraId })) ?? []
      return lista.map((a) => ({
        ...a,
        y_piso: Number(a.y_piso),
        y_teto: Number(a.y_teto),
        contorno: a.contorno.map(([x, z]): [number, number] => [Number(x), Number(z)]),
        qr: a.qr
          ? {
              parede: Number(a.qr.parede),
              distancia_m: Number(a.qr.distancia_m),
              altura_m: Number(a.qr.altura_m),
              lado_m: Number(a.qr.lado_m),
            }
          : null,
      }))
    },

    async definirQr(ambienteId, qr: QrAmbiente) {
      await rpc('admin_definir_qr', {
        p_ambiente: ambienteId,
        p_parede: qr.parede,
        p_distancia_m: qr.distancia_m,
        p_altura_m: qr.altura_m,
        p_lado_m: qr.lado_m,
      })
    },

    async removerQr(ambienteId) {
      await rpc('admin_remover_qr', { p_ambiente: ambienteId })
    },

    async listarAdmins() {
      return ((await rpc<Linha[]>('admin_listar_admins')) ?? []).map(
        (l): Admin => ({
          usuario_id: String(l.usuario_id),
          nome: String(l.nome),
          username: l.username == null ? null : String(l.username),
          telegram_id: Number(l.telegram_id),
          criado_em: String(l.criado_em),
          criado_por_nome: l.criado_por_nome == null ? null : String(l.criado_por_nome),
        }),
      )
    },

    async incluirAdmin(usuarioId) {
      await rpc('admin_incluir_admin', { p_usuario: usuarioId })
    },

    async removerAdmin(usuarioId) {
      await rpc('admin_remover_admin', { p_usuario: usuarioId })
    },

    async listarUsuarios() {
      return ((await rpc<Linha[]>('admin_listar_usuarios')) ?? []).map(
        (l): UsuarioApp => ({
          id: String(l.id),
          nome: String(l.nome),
          username: l.username == null ? null : String(l.username),
          telegram_id: Number(l.telegram_id),
          eh_admin: l.eh_admin === true,
        }),
      )
    },
  }
}
