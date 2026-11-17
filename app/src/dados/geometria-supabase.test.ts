import { describe, expect, it, vi } from 'vitest'
import { criarRepositorioSupabase } from './supabase.ts'

const OBRA = { id: '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4e01', slug: 'hto' }
const AMB = { id: '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4e02', codigo: 'terreo-apto-101' }

type Resposta = { data: unknown; error: { code?: string; message: string } | null }

function clienteFake(respostas: {
  geometria?: (colunas: string) => Resposta
  qr?: Resposta
  referencial?: Resposta
  modelo?: Resposta
}) {
  const consulta = (tabela: string) => {
    let colunas = ''
    const c = {
      select: vi.fn((sel: string) => {
        colunas = sel
        return c
      }),
      eq: vi.fn(() => c),
      not: vi.fn(() => c),
      order: vi.fn(async () => ({ data: [], error: null })),
      maybeSingle: vi.fn(async () => {
        if (tabela === 'ambiente_geometria') {
          return (
            respostas.geometria?.(colunas) ?? {
              data: {
                contorno: [
                  [0, 0],
                  [4, 0],
                  [4, 3],
                  [0, 3],
                ],
                contorno_pagina: [
                  [0.1, 0.1],
                  [0.2, 0.1],
                  [0.2, 0.2],
                  [0.1, 0.2],
                ],
                y_piso: -0.8,
                y_teto: 1.8,
              },
              error: null,
            }
          )
        }
        if (tabela === 'ambiente_qr') return respostas.qr ?? { data: null, error: null }
        if (tabela === 'ra_referencial') return respostas.referencial ?? { data: null, error: null }
        return { data: null, error: null }
      }),
      then: (resolve: (v: Resposta) => unknown, reject?: (e: unknown) => unknown) => {
        const res =
          tabela === 'modelo'
            ? (respostas.modelo ?? { data: [], error: null })
            : { data: [], error: null }
        return Promise.resolve(res).then(resolve, reject)
      },
    }
    return c
  }
  return { from: vi.fn(consulta) }
}

describe('Supabase: obterGeometria (resiliência de cache e erro)', () => {
  it('rejeita em erro de rede/servidor para preservar o cache offline', async () => {
    const fake = clienteFake({
      geometria: () => ({ data: null, error: { message: 'Failed to fetch' } }),
    })
    await expect(criarRepositorioSupabase(fake as never).obterGeometria(OBRA, AMB)).rejects.toThrow(
      'Failed to fetch',
    )
  })

  it('devolve null apenas quando a tabela ainda não existe (migration pendente)', async () => {
    const fake = clienteFake({
      geometria: () => ({
        data: null,
        error: { code: 'PGRST205', message: 'Could not find the table public.ambiente_geometria' },
      }),
    })
    await expect(criarRepositorioSupabase(fake as never).obterGeometria(OBRA, AMB)).resolves.toBeNull()
  })

  it('tenta sem contorno_pagina apenas quando a coluna não existe', async () => {
    const fake = clienteFake({
      geometria: (colunas) =>
        colunas.includes('contorno_pagina')
          ? { data: null, error: { code: '42703', message: 'column contorno_pagina does not exist' } }
          : {
              data: {
                contorno: [
                  [0, 0],
                  [4, 0],
                  [4, 3],
                ],
                y_piso: 0,
                y_teto: 2.6,
              },
              error: null,
            },
    })
    const g = await criarRepositorioSupabase(fake as never).obterGeometria(OBRA, AMB)
    expect(g?.contorno).toEqual([
      [0, 0],
      [4, 0],
      [4, 3],
    ])
    expect(g?.contornoPagina).toBeUndefined()
  })

  it('rejeita se ambiente_qr, ra_referencial ou modelo falharem por rede', async () => {
    const fakeQr = clienteFake({ qr: { data: null, error: { message: 'timeout' } } })
    await expect(criarRepositorioSupabase(fakeQr as never).obterGeometria(OBRA, AMB)).rejects.toThrow('timeout')

    const fakeRef = clienteFake({ referencial: { data: null, error: { message: '502 Bad Gateway' } } })
    await expect(criarRepositorioSupabase(fakeRef as never).obterGeometria(OBRA, AMB)).rejects.toThrow(
      '502 Bad Gateway',
    )

    const fakeMod = clienteFake({ modelo: { data: null, error: { message: 'network error' } } })
    await expect(criarRepositorioSupabase(fakeMod as never).obterGeometria(OBRA, AMB)).rejects.toThrow(
      'network error',
    )
  })
})
