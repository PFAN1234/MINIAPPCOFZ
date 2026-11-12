import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { criarRepositorioFixture, ETAPA_2, ETAPA_3 } from '../dados/fixture.ts'
import type { Repositorio } from '../dados/repositorio.ts'
import { criarRepositorioSupabase } from '../dados/supabase.ts'
import { renderizarApp } from '../test/renderApp.tsx'
import type { TelegramWebApp } from '../telegram.ts'
import { chaveEtapaGuardada } from '../util/etapas.ts'

afterEach(() => {
  delete window.Telegram
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Obras: botão Administração', () => {
  it('não aparece para quem não é admin', async () => {
    renderizarApp('/')
    expect(await screen.findByRole('heading', { name: 'Últimos registros' })).toBeInTheDocument()
    await screen.findAllByText('Serviço')
    expect(screen.queryByRole('button', { name: 'Administração' })).not.toBeInTheDocument()
  })

  it('não aparece se a consulta falhar', async () => {
    const repo: Repositorio = {
      ...criarRepositorioFixture({ admin: true }),
      souAdmin: () => Promise.reject(new Error('falhou')),
    }
    renderizarApp('/', repo)
    await screen.findAllByText('Serviço')
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

describe('Obras: seletor de etapa', () => {
  const CHAVE = chaveEtapaGuardada('usuario-teste')

  it('começa na primeira etapa (por ordem) e troca a lista e as "Outras obras"', async () => {
    const usuario = userEvent.setup()
    renderizarApp('/')
    const seletor = await screen.findByRole('combobox', { name: 'Etapa' })
    expect(within(seletor).getAllByRole('option').map((o) => o.textContent)).toEqual(['2ª ETAPA', '3ª ETAPA'])
    expect(seletor).toHaveValue(ETAPA_2.id)
    expect(await screen.findByRole('link', { name: /Residencial Aurora/ })).toBeInTheDocument()
    expect(await screen.findByText('Obra Demonstração')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Bloco de Alojamentos/ })).not.toBeInTheDocument()

    await usuario.selectOptions(seletor, ETAPA_3.id)
    expect(screen.getByRole('link', { name: /Bloco de Alojamentos/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^HTO/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Obra Demonstração')).not.toBeInTheDocument()
    // Os últimos registros continuam com todas as obras.
    expect(screen.getByRole('heading', { name: 'Últimos registros' })).toBeInTheDocument()
    expect(screen.getAllByText('Serviço').length).toBeGreaterThan(0)
    expect(localStorage.getItem(CHAVE)).toBe(ETAPA_3.id)
  })

  it('lembra a etapa escolhida ao abrir de novo', async () => {
    localStorage.setItem(CHAVE, ETAPA_3.id)
    renderizarApp('/')
    expect(await screen.findByRole('combobox', { name: 'Etapa' })).toHaveValue(ETAPA_3.id)
    expect(await screen.findByRole('link', { name: /Bloco de Alojamentos/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^HTO/ })).not.toBeInTheDocument()
  })

  it('etapa guardada que não existe mais: vale a primeira da lista', async () => {
    localStorage.setItem(CHAVE, 'etapa-que-sumiu')
    renderizarApp('/')
    expect(await screen.findByRole('combobox', { name: 'Etapa' })).toHaveValue(ETAPA_2.id)
    expect(await screen.findByRole('link', { name: /^HTO/ })).toBeInTheDocument()
  })

  it('com uma etapa só, mostra o nome dela sem seletor', async () => {
    const fixture = criarRepositorioFixture()
    const repo: Repositorio = {
      ...fixture,
      listarObras: async () => (await fixture.listarObras()).filter((o) => o.etapa.id === ETAPA_2.id),
    }
    renderizarApp('/', repo)
    expect(await screen.findByRole('link', { name: /^HTO/ })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Etapa' })).not.toBeInTheDocument()
    const cabecalho = screen.getByRole('heading', { level: 1, name: 'Obras' }).closest('header')!
    expect(within(cabecalho).getByText('2ª ETAPA')).toBeInTheDocument()
  })

  it('a etapa pode vir só das "Outras obras" (sem obra própria nela)', async () => {
    const usuario = userEvent.setup()
    const repo: Repositorio = {
      ...criarRepositorioFixture(),
      obrasDisponiveis: async () => [
        { id: 'o9', slug: 'quartel', nome: 'Quartel', solicitacao: null, etapa_id: 'e1', etapa_nome: '1ª ETAPA', etapa_ordem: 1 },
      ],
    }
    renderizarApp('/', repo)
    const seletor = await screen.findByRole('combobox', { name: 'Etapa' })
    await waitFor(() =>
      expect(within(seletor).getAllByRole('option').map((o) => o.textContent)).toEqual([
        '1ª ETAPA',
        '2ª ETAPA',
        '3ª ETAPA',
      ]),
    )
    await usuario.selectOptions(seletor, 'e1')
    expect(screen.getByText('Quartel')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^HTO/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Você ainda não tem acesso a nenhuma obra')).not.toBeInTheDocument()
  })

  it('sem localStorage, o seletor funciona só nesta abertura', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado')
    })
    const usuario = userEvent.setup()
    renderizarApp('/')
    const seletor = await screen.findByRole('combobox', { name: 'Etapa' })
    await usuario.selectOptions(seletor, ETAPA_3.id)
    expect(await screen.findByRole('link', { name: /Bloco de Alojamentos/ })).toBeInTheDocument()
  })
})
