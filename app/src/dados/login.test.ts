import { describe, expect, it, vi } from 'vitest'
import { entrarComTelegram, type ClienteAuth, type DependenciasLogin } from './login.ts'

function sessao(telegramId?: number) {
  return { user: { app_metadata: telegramId === undefined ? {} : { telegram_id: telegramId } } }
}

function criarCliente(guardada: ReturnType<typeof sessao> | null) {
  let atual = guardada
  const auth = {
    getSession: vi.fn(async () => ({ data: { session: atual } })),
    signOut: vi.fn(async () => {
      atual = null
    }),
    setSession: vi.fn(async () => {
      atual = sessao(1)
      return { error: null }
    }),
  }
  return { auth } satisfies ClienteAuth
}

function resposta(status: number, corpo: unknown) {
  return { status, json: async () => corpo } as Response
}

function deps(sobrescritas: Partial<DependenciasLogin> & { cliente: ClienteAuth }): DependenciasLogin {
  return {
    urlSupabase: 'https://x.supabase.co',
    chave: 'chave-publicavel',
    initData: 'query_id=1&hash=abc',
    idTelegram: 1,
    online: true,
    fetch: vi.fn(async () =>
      resposta(200, { access_token: 'a', refresh_token: 'r', expires_at: 1, usuario: {} }),
    ) as unknown as typeof fetch,
    ...sobrescritas,
  }
}

describe('entrarComTelegram', () => {
  it('troca o initData por sessão e chama setSession', async () => {
    const cliente = criarCliente(null)
    const fetchFalso = vi.fn(async () =>
      resposta(200, { access_token: 'a', refresh_token: 'r' }),
    ) as unknown as typeof fetch
    expect(await entrarComTelegram(deps({ cliente, fetch: fetchFalso }))).toBe(true)

    const [url, init] = vi.mocked(fetchFalso).mock.calls[0]
    expect(url).toBe('https://x.supabase.co/functions/v1/auth-telegram')
    expect(init?.method).toBe('POST')
    expect((init?.headers as Record<string, string>).apikey).toBe('chave-publicavel')
    expect(JSON.parse(String(init?.body))).toEqual({ initData: 'query_id=1&hash=abc' })
    expect(cliente.auth.setSession).toHaveBeenCalledWith({ access_token: 'a', refresh_token: 'r' })
  })

  it('sem sinal, abre com a sessão guardada sem chamar a função', async () => {
    const cliente = criarCliente(sessao(1))
    const d = deps({ cliente, online: false })
    expect(await entrarComTelegram(d)).toBe(true)
    expect(d.fetch).not.toHaveBeenCalled()
  })

  it('falha de rede com sessão guardada continua entrando', async () => {
    const cliente = criarCliente(sessao(1))
    const fetchFalso = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    expect(await entrarComTelegram(deps({ cliente, fetch: fetchFalso }))).toBe(true)
  })

  it('401 sem sessão guardada não entra', async () => {
    const cliente = criarCliente(null)
    const fetchFalso = vi.fn(async () => resposta(401, { erro: 'assinatura inválida' })) as unknown as typeof fetch
    expect(await entrarComTelegram(deps({ cliente, fetch: fetchFalso }))).toBe(false)
    expect(cliente.auth.setSession).not.toHaveBeenCalled()
  })

  it('500 com sessão guardada do mesmo usuário continua entrando', async () => {
    const cliente = criarCliente(sessao(1))
    const fetchFalso = vi.fn(async () => resposta(500, { erro: 'falha' })) as unknown as typeof fetch
    expect(await entrarComTelegram(deps({ cliente, fetch: fetchFalso }))).toBe(true)
  })

  it('troca de usuário descarta a sessão guardada e não a reaproveita se o login falha', async () => {
    const cliente = criarCliente(sessao(1))
    const fetchFalso = vi.fn(async () => resposta(401, { erro: 'x' })) as unknown as typeof fetch
    expect(await entrarComTelegram(deps({ cliente, idTelegram: 2, fetch: fetchFalso }))).toBe(false)
    expect(cliente.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('troca de usuário com login bem-sucedido entra com a nova sessão', async () => {
    const cliente = criarCliente(sessao(1))
    expect(await entrarComTelegram(deps({ cliente, idTelegram: 2 }))).toBe(true)
    expect(cliente.auth.signOut).toHaveBeenCalled()
    expect(cliente.auth.setSession).toHaveBeenCalled()
  })

  it('o tempo limite aborta a chamada e cai na sessão guardada', async () => {
    const cliente = criarCliente(sessao(1))
    const fetchFalso = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_ok, falha) => {
          init?.signal?.addEventListener('abort', () => falha(new DOMException('abortado', 'AbortError')))
        }),
    ) as unknown as typeof fetch
    expect(await entrarComTelegram(deps({ cliente, fetch: fetchFalso, tempoLimiteMs: 20 }))).toBe(true)
  })

  it('fora do Telegram (sem initData) só confere a sessão guardada', async () => {
    const d = deps({ cliente: criarCliente(null), initData: '', idTelegram: null })
    expect(await entrarComTelegram(d)).toBe(false)
    expect(d.fetch).not.toHaveBeenCalled()
  })
})
