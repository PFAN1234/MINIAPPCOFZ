import { describe, expect, it, vi } from 'vitest'
import { criarRepositorioSupabase } from './supabase.ts'

const OBRA = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4e01'

/** Cliente falso: `obra` devolve a obra; `modelo` devolve as linhas; Storage devolve o blob. */
function cliente(linhas: unknown[], download: { data: Blob | null; error: unknown }) {
  const baixar = vi.fn().mockResolvedValue(download)
  const consultaModelo = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: linhas, error: null }),
  }
  const consultaObra = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { id: OBRA, slug: 'hto', nome: 'HTO' }, error: null }),
  }
  const fake = {
    from: vi.fn((tabela: string) => (tabela === 'obra' ? consultaObra : consultaModelo)),
    storage: { from: vi.fn(() => ({ download: baixar })) },
  }
  return { fake, baixar, consultaModelo }
}

describe('Supabase: modelos', () => {
  it('lista os .frag da obra, ordenados por sigla, com o caminho no bucket', async () => {
    const { fake, consultaModelo } = cliente(
      [{ sigla: 'ARQ', revisao: 'R06', caminho: `${OBRA}/ARQ.frag`, bytes: '12443107', hash: 'abc' }],
      { data: null, error: null },
    )
    const modelos = await criarRepositorioSupabase(fake as never).listarModelos('hto')
    expect(modelos).toEqual([
      { sigla: 'ARQ', revisao: 'R06', arquivo: `${OBRA}/ARQ.frag`, bytes: 12443107, hash: 'abc' },
    ])
    expect(fake.from).toHaveBeenCalledWith('modelo')
    expect(consultaModelo.eq).toHaveBeenCalledWith('obra_id', OBRA)
    expect(consultaModelo.order).toHaveBeenCalledWith('sigla')
  })

  it('baixa do bucket privado `modelos` pelo caminho', async () => {
    const { fake, baixar } = cliente([], { data: new Blob([new Uint8Array([1, 2, 3])]), error: null })
    const m = { sigla: 'ARQ', revisao: null, arquivo: `${OBRA}/ARQ.frag`, bytes: 3, hash: 'abc' }
    const dados = await criarRepositorioSupabase(fake as never).baixarModelo('hto', m)
    expect(new Uint8Array(dados)).toEqual(new Uint8Array([1, 2, 3]))
    expect(fake.storage.from).toHaveBeenCalledWith('modelos')
    expect(baixar).toHaveBeenCalledWith(`${OBRA}/ARQ.frag`)
  })

  it('erro de acesso do Storage vira ErroEnvio de permissão', async () => {
    const { fake } = cliente([], { data: null, error: { statusCode: '403', message: 'Unauthorized' } })
    const m = { sigla: 'ARQ', revisao: null, arquivo: 'x', bytes: 1, hash: 'h' }
    await expect(criarRepositorioSupabase(fake as never).baixarModelo('hto', m)).rejects.toMatchObject({
      tipo: 'permissao',
    })
  })
})
