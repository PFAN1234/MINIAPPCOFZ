import { afterEach, describe, expect, it, vi } from 'vitest'
import { criarRepositorioSupabase } from './supabase.ts'

const ETAPA = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4b02'
const OBRA = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4e01'

function cliente(rpcResposta: { data: unknown; error: unknown } = { data: null, error: null }, token: string | null = 'jwt-x') {
  return {
    rpc: vi.fn().mockResolvedValue(rpcResposta),
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: token ? { access_token: token } : null } }) },
  }
}

function resposta(status: number, corpo: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => corpo }
}

afterEach(() => vi.unstubAllGlobals())

describe('Supabase: painel de relatórios', () => {
  it('chama painel_relatorios e converte os números', async () => {
    const fake = cliente({
      error: null,
      data: {
        etapa: { id: ETAPA, slug: '2a-etapa', nome: '2ª ETAPA', hoje: '2026-11-13' },
        obras: [{ id: OBRA, slug: 'hto', nome: 'HTO' }],
        dias: [{ obra_id: OBRA, dia: '2026-11-10', servicos: '1', pendencias: 2, resolvidas: null }],
      },
    })
    const p = await criarRepositorioSupabase(fake as never).painelRelatorios(ETAPA)
    expect(fake.rpc).toHaveBeenCalledWith('painel_relatorios', { p_etapa: ETAPA })
    expect(p.etapa.hoje).toBe('2026-11-13')
    expect(p.obras).toEqual([{ id: OBRA, slug: 'hto', nome: 'HTO' }])
    expect(p.dias[0]).toEqual({ obra_id: OBRA, dia: '2026-11-10', servicos: 1, pendencias: 2, resolvidas: 0 })
  })

  it('exportarPendencias: POST com Bearer e devolve a url', async () => {
    const f = vi.fn().mockResolvedValue(resposta(200, { url: 'https://u/p.pdf' }))
    vi.stubGlobal('fetch', f)
    const url = await criarRepositorioSupabase(cliente() as never).exportarPendencias(ETAPA, OBRA)
    expect(url).toBe('https://u/p.pdf')
    const [rota, init] = f.mock.calls[0]
    expect(rota).toBe('/api/relatorio-pendencias')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer jwt-x')
    expect(JSON.parse(init.body)).toEqual({ etapa_id: ETAPA, obra_id: OBRA })
  })

  it('exportarPendencias: etapa inteira envia obra_id nulo', async () => {
    const f = vi.fn().mockResolvedValue(resposta(200, { url: 'https://u/p.pdf' }))
    vi.stubGlobal('fetch', f)
    await criarRepositorioSupabase(cliente() as never).exportarPendencias(ETAPA, null)
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ etapa_id: ETAPA, obra_id: null })
  })

  it('erro HTTP usa a mensagem do corpo', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resposta(403, { erro: 'Acesso negado' })))
    await expect(criarRepositorioSupabase(cliente() as never).exportarPendencias(ETAPA, null)).rejects.toThrow('Acesso negado')
  })

  it('erro HTTP sem corpo usa a mensagem padrão', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => Promise.reject(new Error('x')) }))
    await expect(criarRepositorioSupabase(cliente() as never).exportarPendencias(ETAPA, null)).rejects.toThrow(
      'Não foi possível gerar o relatório. Tente de novo.',
    )
  })

  it('sem sessão não chama a rota', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    await expect(criarRepositorioSupabase(cliente(undefined, null) as never).exportarPendencias(ETAPA, null)).rejects.toThrow(/sessão/)
    expect(f).not.toHaveBeenCalled()
  })
})
