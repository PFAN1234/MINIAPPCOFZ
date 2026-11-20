// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function carregarSw(fetchMock: ReturnType<typeof vi.fn<FetchFn>>, iniciais: Record<string, Record<string, Response>> = {}) {
  const stores = new Map<string, Map<string, Response>>()
  for (const [nome, entradas] of Object.entries(iniciais)) {
    stores.set(nome, new Map(Object.entries(entradas)))
  }
  const cacheObj = (mapa: Map<string, Response>) => ({
    match: async (req: Request | string, opts?: { ignoreSearch?: boolean }) => {
      const url = typeof req === 'string' ? req : req.url
      const semBusca = (u: string) => u.split('?')[0]
      for (const [k, v] of mapa.entries()) {
        if (opts?.ignoreSearch ? semBusca(k) === semBusca(url) : k === url) return v.clone()
      }
      return undefined
    },
    put: async (req: Request | string, res: Response) => {
      const url = typeof req === 'string' ? req : req.url
      mapa.set(url, res.clone())
    },
    addAll: async (reqs: (Request | string)[]) => {
      for (const r of reqs) {
        const res = await fetchMock(r)
        mapa.set(typeof r === 'string' ? r : r.url, res.clone())
      }
    },
    keys: async () => [...mapa.keys()].map((u) => new Request(u)),
    delete: async (req: Request | string) => mapa.delete(typeof req === 'string' ? req : req.url),
  })

  const caches = {
    open: async (nome: string) => {
      if (!stores.has(nome)) stores.set(nome, new Map())
      return cacheObj(stores.get(nome)!)
    },
    keys: async () => [...stores.keys()],
    delete: async (nome: string) => stores.delete(nome),
    match: async (req: Request | string, opts?: { ignoreSearch?: boolean }) => {
      for (const mapa of stores.values()) {
        const achado = await cacheObj(mapa).match(req, opts)
        if (achado) return achado
      }
      return undefined
    },
  }

  const ouvintes = new Map<string, (ev: unknown) => void>()
  const selfObj = {
    location: { origin: 'https://app.exemplo' },
    addEventListener: (tipo: string, fn: (ev: unknown) => void) => ouvintes.set(tipo, fn),
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  }

  const codigo = readFileSync(fileURLToPath(new URL('../../../../public/sw.js', import.meta.url)), 'utf8')
  const resolver = (input: RequestInfo | URL) =>
    typeof input === 'string' && input.startsWith('/') ? `https://app.exemplo${input}` : input
  const RequestSW = class extends Request {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(resolver(input), init)
    }
  }
  vm.runInNewContext(codigo, {
    self: selfObj,
    caches,
    fetch: (input: RequestInfo | URL, init?: RequestInit) => fetchMock(resolver(input), init),
    URL,
    Request: RequestSW,
    Response,
    Promise,
    setTimeout,
  })

  async function disparar(tipo: string, extra: Record<string, unknown> = {}) {
    const fn = ouvintes.get(tipo)
    let p: Promise<unknown> = Promise.resolve()
    fn?.({ ...extra, waitUntil: (w: Promise<unknown>) => (p = w), respondWith: (w: Promise<unknown>) => (p = w) })
    return p
  }

  return { stores, disparar }
}

describe('sw.js: cache dedicado do motor 3D e worker', () => {
  it('guarda motor-3d, jsQR e worker em motor-3d-v1 e os preserva após novo deploy', async () => {
    const fetchMock = vi.fn<FetchFn>(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.endsWith('/precache-manifest.json')) {
        return new Response(JSON.stringify({ versao: 'nova123', arquivos: ['/index.html'] }), { status: 200 })
      }
      return new Response('ok', { status: 200 })
    })

    const { stores, disparar } = carregarSw(fetchMock, {
      'app-antiga': { 'https://app.exemplo/index.html': new Response('old', { status: 200 }) },
      'modelos-v1': { 'https://app.exemplo/hto/ELT': new Response('frag', { status: 200 }) },
    })

    // 1. Uso online busca o worker e os chunks 3D: vão para `motor-3d-v1`.
    for (const caminho of ['/assets/worker-A41rJlzC.mjs', '/assets/motor-3d-aTzt9cBV.js', '/assets/jsQR-CDyTT7Ur.js']) {
      const res = (await disparar('fetch', {
        request: new Request(`https://app.exemplo${caminho}`, { method: 'GET' }),
      })) as Response
      expect(res.status).toBe(200)
    }
    expect(stores.get('motor-3d-v1')?.has('https://app.exemplo/assets/worker-A41rJlzC.mjs')).toBe(true)
    expect(stores.get('motor-3d-v1')?.has('https://app.exemplo/assets/motor-3d-aTzt9cBV.js')).toBe(true)
    expect(stores.get('motor-3d-v1')?.has('https://app.exemplo/assets/jsQR-CDyTT7Ur.js')).toBe(true)

    // 2. Novo deploy: instala `app-nova123` e ativa apagando `app-antiga`, mas mantém `motor-3d-v1` e `modelos-v1`.
    await disparar('install')
    await disparar('activate')
    expect(stores.has('app-antiga')).toBe(false)
    expect(stores.has('app-nova123')).toBe(true)
    expect(stores.has('modelos-v1')).toBe(true)
    expect(stores.has('motor-3d-v1')).toBe(true)

    // 3. Offline após o deploy: `worker` e `motor-3d` respondem do cache sem ir à rede.
    fetchMock.mockClear()
    fetchMock.mockRejectedValue(new Error('offline'))
    const workerOffline = (await disparar('fetch', {
      request: new Request('https://app.exemplo/assets/worker-A41rJlzC.mjs', { method: 'GET' }),
    })) as Response
    expect(workerOffline.status).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
