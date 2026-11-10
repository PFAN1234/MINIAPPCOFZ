/**
 * Login real (modo Supabase): troca o `initData` do Telegram por uma sessão
 * Supabase na Edge Function `auth-telegram`. Sem sinal, ou se a função falhar,
 * o app abre com a sessão guardada no aparelho, se ela ainda for válida.
 */

export const TEMPO_LIMITE_LOGIN_MS = 10_000

interface SessaoGuardada {
  user: { app_metadata?: object }
}

/** Parte do cliente Supabase usada aqui (facilita simular nos testes). */
export interface ClienteAuth {
  auth: {
    getSession(): Promise<{ data: { session: SessaoGuardada | null } }>
    signOut(opcoes?: { scope: 'local' }): Promise<unknown>
    setSession(sessao: { access_token: string; refresh_token: string }): Promise<{
      error: unknown
    }>
  }
}

export interface DependenciasLogin {
  cliente: ClienteAuth
  /** Base do projeto, sem barra final (`VITE_SUPABASE_URL`). */
  urlSupabase: string
  /** Chave publicável, enviada no cabeçalho `apikey`. */
  chave: string
  /** `initData` bruto do Telegram; vazio fora dele. */
  initData: string
  /** Id do usuário atual no Telegram, se conhecido. */
  idTelegram: number | null
  online: boolean
  fetch: typeof fetch
  tempoLimiteMs?: number
}

function telegramIdGuardado(sessao: SessaoGuardada): string | null {
  const id = (sessao.user.app_metadata as { telegram_id?: unknown } | undefined)?.telegram_id
  return id === undefined || id === null ? null : String(id)
}

/**
 * True se, ao final, há sessão utilizável. Nunca lança: qualquer falha da
 * função de login cai de volta na sessão guardada.
 */
export async function entrarComTelegram(d: DependenciasLogin): Promise<boolean> {
  let { data } = await d.cliente.auth.getSession()
  let guardada = data.session

  // Outra pessoa abriu o app neste aparelho: a sessão anterior não vale.
  if (guardada && d.idTelegram !== null) {
    const idGuardado = telegramIdGuardado(guardada)
    if (idGuardado !== null && idGuardado !== String(d.idTelegram)) {
      await d.cliente.auth.signOut({ scope: 'local' })
      guardada = null
    }
  }

  if (d.initData !== '' && d.online) {
    const controle = new AbortController()
    const timer = setTimeout(() => controle.abort(), d.tempoLimiteMs ?? TEMPO_LIMITE_LOGIN_MS)
    try {
      const resposta = await d.fetch(`${d.urlSupabase}/functions/v1/auth-telegram`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: d.chave },
        body: JSON.stringify({ initData: d.initData }),
        signal: controle.signal,
      })
      if (resposta.status === 200) {
        const corpo = (await resposta.json()) as {
          access_token?: string
          refresh_token?: string
        }
        if (corpo.access_token && corpo.refresh_token) {
          const { error } = await d.cliente.auth.setSession({
            access_token: corpo.access_token,
            refresh_token: corpo.refresh_token,
          })
          if (!error) return true
        }
      }
    } catch {
      // Rede, tempo esgotado ou resposta inválida: segue com a sessão guardada.
    } finally {
      clearTimeout(timer)
    }
  }

  if (!guardada) return false
  ;({ data } = await d.cliente.auth.getSession())
  return data.session !== null
}
