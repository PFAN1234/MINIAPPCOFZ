import { afterEach, describe, expect, it, vi } from 'vitest'
import { criarRepositorioSupabase, urlPublicaLogo } from './supabase.ts'

const ETAPA = { id: 'e2', slug: '2a-etapa', nome: '2ª ETAPA', ordem: 2 }

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('Supabase: etapas e organização', () => {
  it('listarObras pede a etapa embutida e a devolve em cada obra', async () => {
    const segundaOrdem = vi.fn().mockResolvedValue({
      data: [{ id: 'o1', slug: 'hto', nome: 'HTO', etapa: ETAPA }],
      error: null,
    })
    const consulta = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnValueOnce({ order: segundaOrdem }),
    }
    const fake = { from: vi.fn(() => consulta) }
    const obras = await criarRepositorioSupabase(fake as never).listarObras()
    expect(fake.from).toHaveBeenCalledWith('obra')
    expect(consulta.select).toHaveBeenCalledWith('id, slug, nome, etapa(id, slug, nome, ordem)')
    expect(obras).toEqual([{ id: 'o1', slug: 'hto', nome: 'HTO', etapa: ETAPA }])
  })

  it('obrasDisponiveis traz a etapa de cada obra', async () => {
    const fake = {
      rpc: vi.fn().mockResolvedValue({
        data: [
          { id: 'o3', slug: 'demo', nome: 'Demo', solicitacao: null, etapa_id: 'e3', etapa_nome: '3ª ETAPA', etapa_ordem: 3 },
        ],
        error: null,
      }),
    }
    expect(await criarRepositorioSupabase(fake as never).obrasDisponiveis()).toEqual([
      { id: 'o3', slug: 'demo', nome: 'Demo', solicitacao: null, etapa_id: 'e3', etapa_nome: '3ª ETAPA', etapa_ordem: 3 },
    ])
    expect(fake.rpc).toHaveBeenCalledWith('obras_disponiveis')
  })

  it('organizacao chama a RPC e monta a URL pública do logo', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://proj.supabase.test/')
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: { nome: 'CO-FZ', logo_path: 'logo-0123456789abcdef.png' }, error: null })
      .mockResolvedValueOnce({ data: { nome: 'CO-FZ', logo_path: null }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'falhou' } })
    const repo = criarRepositorioSupabase({ rpc } as never)
    expect(await repo.organizacao()).toEqual({
      nome: 'CO-FZ',
      logo_url: 'https://proj.supabase.test/storage/v1/object/public/organizacao/logo-0123456789abcdef.png',
    })
    expect(rpc).toHaveBeenCalledWith('organizacao')
    expect(await repo.organizacao()).toEqual({ nome: 'CO-FZ', logo_url: null })
    await expect(repo.organizacao()).rejects.toThrow()
  })

  it('urlPublicaLogo escapa o caminho', () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://proj.supabase.test')
    expect(urlPublicaLogo('pasta/logo novo.png')).toBe(
      'https://proj.supabase.test/storage/v1/object/public/organizacao/pasta/logo%20novo.png',
    )
  })
})
