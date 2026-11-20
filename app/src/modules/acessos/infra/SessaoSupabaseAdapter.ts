import type { SupabaseClient } from '@supabase/supabase-js'
import { ErroEnvio, erroDoSupabase } from '../../../dados/erros.ts'
import { entrarComTelegram } from '../../../dados/login.ts'
import { dentroDoTelegram, idUsuarioTelegram, initData } from '../../../shared/infra/telegram/telegram.ts'
import type { SessaoRepositorio } from '../application/ports/SessaoRepositorio.port.ts'
import type { LinkAdmin } from '../domain/tipos.ts'

export function criarSessaoSupabase(cliente: SupabaseClient): SessaoRepositorio {
  return {
    async temSessao() {
      return entrarComTelegram({
        cliente,
        urlSupabase: String(import.meta.env.VITE_SUPABASE_URL).replace(/\/+$/, ''),
        chave: String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY),
        initData: dentroDoTelegram() ? initData() : '',
        idTelegram: idUsuarioTelegram(),
        online: navigator.onLine,
        fetch: (...args) => fetch(...args),
      })
    },

    async idUsuario() {
      const { data } = await cliente.auth.getSession()
      return data.session?.user.id ?? null
    },

    async souAdmin() {
      try {
        const { data, error } = await cliente.rpc('sou_admin')
        if (error) throw error
        return data === true
      } catch (e) {
        throw erroDoSupabase(e)
      }
    },

    async criarLinkAdmin(): Promise<LinkAdmin> {
      const { data } = await cliente.auth.getSession()
      const jwt = data.session?.access_token
      if (!jwt) throw new ErroEnvio('sessao', 'Sua sessão expirou. Abra o app novamente pelo Telegram.')
      const base = String(import.meta.env.VITE_SUPABASE_URL).replace(/\/+$/, '')
      let resposta: Response
      try {
        resposta = await fetch(`${base}/functions/v1/admin-sessao`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY),
            Authorization: `Bearer ${jwt}`,
          },
          body: JSON.stringify({ acao: 'criar' }),
        })
      } catch (e) {
        throw erroDoSupabase(e)
      }
      if (resposta.status === 403) {
        throw new ErroEnvio('permissao', 'Apenas admins do Mini App podem abrir a administração.')
      }
      const corpo = (await resposta.json().catch(() => null)) as Partial<LinkAdmin> | null
      if (!resposta.ok || typeof corpo?.url !== 'string' || !/^https?:\/\//.test(corpo.url)) {
        throw new ErroEnvio('desconhecido', 'Não foi possível abrir a administração. Tente de novo.')
      }
      return { url: corpo.url, expira_em: String(corpo.expira_em ?? '') }
    },
  }
}
