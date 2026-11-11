import { afterEach, describe, expect, it, vi } from 'vitest'
import { modeloComCache } from './cacheModelo.ts'

/** Cache API mínima em memória (o jsdom não tem). */
function cacheFalso() {
  const mapa = new Map<string, Response>()
  const cache = {
    match: async (url: string) => mapa.get(url)?.clone(),
    put: async (url: string, r: Response) => void mapa.set(url, r),
    keys: async () => [...mapa.keys()].map((u) => ({ url: `http://localhost${u}` }) as Request),
    delete: async (req: Request) => mapa.delete(new URL(req.url).pathname),
  }
  vi.stubGlobal('caches', { open: async () => cache })
  return mapa
}

const bytes = (...n: number[]) => new Uint8Array(n).buffer

describe('modeloComCache', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('baixa na primeira vez e reutiliza o cache com o mesmo hash', async () => {
    cacheFalso()
    const baixar = vi.fn().mockResolvedValue(bytes(1, 2))
    expect(new Uint8Array(await modeloComCache('hto/ARQ@h1', baixar))).toEqual(new Uint8Array([1, 2]))
    expect(new Uint8Array(await modeloComCache('hto/ARQ@h1', baixar))).toEqual(new Uint8Array([1, 2]))
    expect(baixar).toHaveBeenCalledTimes(1)
  })

  it('hash novo baixa de novo e apaga a versão antiga da mesma disciplina', async () => {
    const mapa = cacheFalso()
    await modeloComCache('hto/ARQ@h1', async () => bytes(1))
    await modeloComCache('hto/ANT@h9', async () => bytes(9))
    await modeloComCache('hto/ARQ@h2', async () => bytes(2))
    expect([...mapa.keys()].sort()).toEqual(['/__modelo-cache/hto/ANT@h9', '/__modelo-cache/hto/ARQ@h2'])
  })

  it('sem Cache API só baixa', async () => {
    vi.stubGlobal('caches', undefined)
    expect(new Uint8Array(await modeloComCache('hto/ARQ@h1', async () => bytes(5)))).toEqual(new Uint8Array([5]))
  })

  it('falha do cache não impede abrir o modelo', async () => {
    vi.stubGlobal('caches', {
      open: async () => ({
        match: async () => undefined,
        keys: async () => [],
        put: async () => {
          throw new Error('cheio')
        },
      }),
    })
    expect(new Uint8Array(await modeloComCache('hto/ARQ@h1', async () => bytes(7)))).toEqual(new Uint8Array([7]))
  })

  it('erro do download sobe', async () => {
    cacheFalso()
    await expect(
      modeloComCache('hto/ARQ@h1', async () => {
        throw new Error('rede')
      }),
    ).rejects.toThrow('rede')
  })
})
