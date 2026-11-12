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
  type EtapaLista,
  type EtapaSalva,
  type Organizacao,
  type ResultadoExclusaoEtapa,
  type ResumoEtapa,
  type DadosEditorPlanta,
  type DadosModelos,
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
    }
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
        }),
      )
    },

    async salvarEtapa(dados) {
      try {
        return await rpc<EtapaSalva>('admin_salvar_etapa', { p: dados })
      } catch (e) {
        const codigo = (e as ErroAdmin).cause && ((e as ErroAdmin).cause as ErroBruto).code
        if (codigo === '23505') throw new ErroAdmin(`Já existe uma etapa com o slug ${dados.slug ?? ''}`, { cause: e })
        throw e
      }
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
