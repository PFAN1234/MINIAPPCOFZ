import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { FotoRA } from '../../../ra/tipos.ts'
import { useFotosEscolhidas } from './useFotosEscolhidas.ts'

vi.mock('../../infra/browser/imagem.ts', () => ({
  prepararFoto: vi.fn(async (_arquivo: File, opcoes?: { id?: string }) => ({
    id: opcoes?.id ?? crypto.randomUUID(),
    blob: new Blob(['jpeg'], { type: 'image/jpeg' }),
    largura: 1200,
    altura: 900,
    bytes: 4,
  })),
}))

beforeAll(() => {
  let n = 0
  URL.createObjectURL = () => `blob:teste/${++n}`
  URL.revokeObjectURL = () => {}
})

function parRA(): FotoRA[] {
  const idA = '11111111-1111-4111-8111-111111111111'
  const idB = '22222222-2222-4222-8222-222222222222'
  const base = {
    modelos: [{ sigla: 'ELT', revisao: 'R03', hash: 'abc' }],
    alinhamento: 'cantos' as const,
    pose: { posicao: [0, 1.4, 0] as [number, number, number], rumo: 0, fov: 60 },
  }
  return [
    {
      id: idA,
      arquivo: new File(['a'], 'limpa.jpg', { type: 'image/jpeg' }),
      origem: 'ra_limpa',
      ra: { ...base, par: idB },
    },
    {
      id: idB,
      arquivo: new File(['b'], 'modelo.jpg', { type: 'image/jpeg' }),
      origem: 'ra_modelo',
      ra: { ...base, par: idA },
    },
  ]
}

describe('useFotosEscolhidas', () => {
  it('remove o ponteiro ra.par da foto sobrevivente quando a parceira do par é removida', async () => {
    const par = parRA()
    const { result } = renderHook(() => useFotosEscolhidas())
    act(() => {
      result.current.adicionar(
        par.map((p) => p.arquivo),
        par,
      )
    })
    await waitFor(() => expect(result.current.fotos.every((f) => f.estado === 'pronta')).toBe(true))

    const chaveLimpa = result.current.fotos[0].chave
    act(() => {
      result.current.remover(chaveLimpa)
    })

    expect(result.current.fotos).toHaveLength(1)
    expect(result.current.fotos[0].ra?.ra.par).toBeUndefined()
    expect(result.current.fotos[0].preparada?.ra?.par).toBeUndefined()
  })
})
