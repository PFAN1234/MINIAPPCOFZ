import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { criarRepositorioFixture } from '../dados/fixture.ts'
import type { Repositorio } from '../dados/repositorio.ts'
import { criarRepositorioSupabase } from '../dados/supabase.ts'
import { renderizarApp } from '../test/renderApp.tsx'
import type { TelegramWebApp } from '../telegram.ts'

afterEach(() => {
  delete window.Telegram
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Obras: botão Administração', () => {
  it('não aparece para quem não é admin', async () => {
    renderizarApp('/')
    expect(await screen.findByRole('heading', { name: 'Equipe de serviço' })).toBeInTheDocument()
    await screen.findByRole('heading', { name: 'Equipe de serviço' })
    expect(screen.queryByRole('button', { name: 'Administração' })).not.toBeInTheDocument()
  })

  it('não aparece se a consulta falhar', async () => {
    const repo: Repositorio = {
      ...criarRepositorioFixture({ admin: true }),
      souAdmin: () => Promise.reject(new Error('falhou')),
    }
    renderizarApp('/', repo)
    await screen.findByRole('heading', { name: 'Equipe de serviço' })
    expect(screen.queryByRole('button', { name: 'Administração' })).not.toBeInTheDocument()
  })

  it('para admin, fora do Telegram, abre o link numa nova aba', async () => {
    const abrir = vi.spyOn(window, 'open').mockReturnValue(null)
    const usuario = userEvent.setup()
    renderizarApp('/', criarRepositorioFixture({ admin: true }))
    await usuario.click(await screen.findByRole('button', { name: 'Administração' }))
    await waitFor(() => expect(abrir).toHaveBeenCalledTimes(1))
    expect(abrir.mock.calls[0][0]).toMatch(/\/admin\/#entrar=fixture$/)
    expect(abrir.mock.calls[0][1]).toBe('_blank')
  })

  it('dentro do Telegram usa openLink', async () => {
    const openLink = vi.fn()
    const abrir = vi.spyOn(window, 'open').mockReturnValue(null)
    window.Telegram = {
      WebApp: {
        initData: 'query_id=x&hash=y',
        colorScheme: 'light',
        themeParams: {},
        BackButton: { show: vi.fn(), hide: vi.fn(), onClick: vi.fn(), offClick: vi.fn() },
        ready: vi.fn(),
        expand: vi.fn(),
        enableClosingConfirmation: vi.fn(),
        disableClosingConfirmation: vi.fn(),
        openLink,
      } satisfies TelegramWebApp,
    }
    const repo: Repositorio = {
      ...criarRepositorioFixture({ admin: true }),
      criarLinkAdmin: async () => ({ url: 'https://exemplo.test/admin/#entrar=abc', expira_em: '' }),
    }
    const usuario = userEvent.setup()
    renderizarApp('/', repo)
    await usuario.click(await screen.findByRole('button', { name: 'Administração' }))
    await waitFor(() => expect(openLink).toHaveBeenCalledWith('https://exemplo.test/admin/#entrar=abc'))
    expect(abrir).not.toHaveBeenCalled()
  })

  it('erro ao criar o link aparece como alerta', async () => {
    const repo: Repositorio = {
      ...criarRepositorioFixture({ admin: true }),
      criarLinkAdmin: () => Promise.reject(new Error('Apenas admins do Mini App podem abrir a administração.')),
    }
    const usuario = userEvent.setup()
    renderizarApp('/', repo)
    await usuario.click(await screen.findByRole('button', { name: 'Administração' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Apenas admins')
  })
})

describe('Supabase: administração', () => {
  function cliente(admin: unknown, sessao: { access_token: string } | null = { access_token: 'JWT' }) {
    return {
      rpc: vi.fn().mockResolvedValue({ data: admin, error: null }),
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: sessao } }) },
    }
  }

  it('souAdmin chama a RPC sou_admin', async () => {
    const c = cliente(true)
    expect(await criarRepositorioSupabase(c as never).souAdmin()).toBe(true)
    expect(c.rpc).toHaveBeenCalledWith('sou_admin')
    expect(await criarRepositorioSupabase(cliente(null) as never).souAdmin()).toBe(false)
  })

  it('criarLinkAdmin manda o JWT da sessão para a admin-sessao', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://proj.supabase.test/')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'pk')
    const f = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ url: 'https://site.test/admin/#entrar=t', expira_em: 'x' }), { status: 200 }),
    )
    vi.stubGlobal('fetch', f)
    const link = await criarRepositorioSupabase(cliente(true) as never).criarLinkAdmin()
    expect(link).toEqual({ url: 'https://site.test/admin/#entrar=t', expira_em: 'x' })
    const [url, init] = f.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://proj.supabase.test/functions/v1/admin-sessao')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer JWT', apikey: 'pk' })
    expect(JSON.parse(String(init.body))).toEqual({ acao: 'criar' })
    vi.unstubAllEnvs()
  })

  it('criarLinkAdmin: 403 vira permissão; sem sessão vira sessão', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"erro":"Acesso negado"}', { status: 403 })))
    await expect(criarRepositorioSupabase(cliente(true) as never).criarLinkAdmin()).rejects.toMatchObject({
      tipo: 'permissao',
    })
    await expect(criarRepositorioSupabase(cliente(true, null) as never).criarLinkAdmin()).rejects.toMatchObject({
      tipo: 'sessao',
    })
  })
})

