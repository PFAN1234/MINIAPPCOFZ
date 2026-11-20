import { afterEach, beforeEach, vi } from 'vitest'
import { criarModelosFixture } from '../../infra/ModelosFixtureAdapter.ts'
import { contratoModelosRepositorio } from './ModelosRepositorio.contract.ts'

const ARQ = { sigla: 'ARQ', revisao: 'R06', arquivo: 'ARQ.frag', bytes: 3, hash: 'abc' }

// A fixture lê o manifesto e o `.frag` por `fetch` em `/modelos/<obra>/`.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.endsWith('manifesto.json')
        ? new Response(JSON.stringify({ modelos: [ARQ] }), { headers: { 'content-type': 'application/json' } })
        : new Response(new Uint8Array([1, 2, 3])),
    ),
  )
})
afterEach(() => vi.unstubAllGlobals())

contratoModelosRepositorio(
  'fixture',
  () => {
    const arquivos = new Map<string, number>()
    return {
      repo: criarModelosFixture({ tamanhoArquivo: (c) => arquivos.get(c) }),
      depositar: (caminho, bytes) => arquivos.set(caminho, bytes),
      obraId: 'obra-hto',
    }
  },
  ARQ,
)
