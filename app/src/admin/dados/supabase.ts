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
  type Admin,
  type ConfigObra,
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
        }),
      )
    },

    obterObra(slug) {
      return rpc<ObraAdmin>('admin_obter_obra', { p_slug: slug })
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
