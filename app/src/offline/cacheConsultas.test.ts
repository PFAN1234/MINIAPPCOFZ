import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { criarArmazenamentoMemoria, type Armazenamento } from './armazenamento.ts'
import { IDADE_MAXIMA_MS, persistirCache, restaurarCache, VERSAO_CACHE } from './cacheConsultas.ts'

function novoQc(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

async function popular(qc: QueryClient) {
  await qc.fetchQuery({ queryKey: ['obras'], queryFn: async () => [{ slug: 'hto' }] })
  await qc.fetchQuery({ queryKey: ['sessao'], queryFn: async () => true })
  await qc.fetchQuery({ queryKey: ['usuario'], queryFn: async () => 'u1' })
  await qc.fetchQuery({ queryKey: ['imagens', 'fotos', 'x'], queryFn: async () => ({ a: 'url' }) })
  await qc.fetchQuery({ queryKey: ['quebrada'], queryFn: async () => { throw new Error('x') } }).catch(() => {})
}

describe('cache de consultas', () => {
  let a: Armazenamento
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    a = criarArmazenamentoMemoria()
  })
  afterEach(() => vi.useRealTimers())

  it('grava com debounce de 1 s, só consultas com sucesso e sem sessao/usuario', async () => {
    const qc = novoQc()
    const cancelar = persistirCache(qc, a, 'u1')
    await popular(qc)
    expect(await a.lerCache('u1')).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1000)
    const salvo = await a.lerCache('u1')
    expect(salvo?.versao).toBe(VERSAO_CACHE)
    const chaves = (salvo!.estado as { queries: { queryKey: unknown[] }[] }).queries.map((q) => q.queryKey[0])
    expect(chaves.sort()).toEqual(['imagens', 'obras'])
    cancelar()
  })

  it('cancelar impede a gravação pendente', async () => {
    const qc = novoQc()
    const cancelar = persistirCache(qc, a, 'u1')
    await qc.fetchQuery({ queryKey: ['obras'], queryFn: async () => 1 })
    cancelar()
    await vi.advanceTimersByTimeAsync(5000)
    expect(await a.lerCache('u1')).toBeUndefined()
  })

  it('restaura por usuário e limpa os caches dos outros', async () => {
    const qc = novoQc()
    const cancelar = persistirCache(qc, a, 'u1')
    await popular(qc)
    await vi.advanceTimersByTimeAsync(1000)
    cancelar()
    await a.salvarCache('u2', { versao: VERSAO_CACHE, salvoEm: Date.now(), estado: { mutations: [], queries: [] } })

    const novo = novoQc()
    await restaurarCache(novo, a, 'u1')
    expect(novo.getQueryData(['obras'])).toEqual([{ slug: 'hto' }])
    expect(novo.getQueryData(['sessao'])).toBeUndefined()
    expect(await a.lerCache('u2')).toBeUndefined()
    expect(await a.lerCache('u1')).toBeDefined()

    const outro = novoQc()
    await restaurarCache(outro, a, 'u3')
    expect(outro.getQueryData(['obras'])).toBeUndefined()
  })

  it('descarta o cache vencido e o de versão diferente', async () => {
    const estado = { mutations: [], queries: [{ queryKey: ['obras'], queryHash: '["obras"]', state: { data: [1], dataUpdateCount: 1, dataUpdatedAt: 1, error: null, errorUpdateCount: 0, errorUpdatedAt: 0, fetchFailureCount: 0, fetchFailureReason: null, fetchMeta: null, isInvalidated: false, status: 'success', fetchStatus: 'idle' } }] }
    await a.salvarCache('u1', { versao: VERSAO_CACHE, salvoEm: Date.now() - IDADE_MAXIMA_MS - 1, estado })
    const vencido = novoQc()
    await restaurarCache(vencido, a, 'u1')
    expect(vencido.getQueryData(['obras'])).toBeUndefined()

    await a.salvarCache('u1', { versao: VERSAO_CACHE + 1, salvoEm: Date.now(), estado })
    const outraVersao = novoQc()
    await restaurarCache(outraVersao, a, 'u1')
    expect(outraVersao.getQueryData(['obras'])).toBeUndefined()

    await a.salvarCache('u1', { versao: VERSAO_CACHE, salvoEm: Date.now() - IDADE_MAXIMA_MS + 1000, estado })
    const valido = novoQc()
    await restaurarCache(valido, a, 'u1')
    expect(valido.getQueryData(['obras'])).toEqual([1])
  })

  it('erros do armazenamento não derrubam', async () => {
    const quebrado: Armazenamento = {
      ...a,
      lerCache: async () => { throw new Error('x') },
      salvarCache: async () => { throw new Error('x') },
      limparCachesExceto: async () => { throw new Error('x') },
    }
    const qc = novoQc()
    await expect(restaurarCache(qc, quebrado, 'u1')).resolves.toBeUndefined()
    const cancelar = persistirCache(qc, quebrado, 'u1')
    await qc.fetchQuery({ queryKey: ['obras'], queryFn: async () => 1 })
    await vi.advanceTimersByTimeAsync(1000)
    cancelar()
  })
})

describe('cache de consultas restaurado e app em segundo plano', () => {
  it('o cache restaurado fica vencido (menos imagens), para ser refeito ao montar', async () => {
    const a = criarArmazenamentoMemoria()
    const origem = novoQc()
    const cancelar = persistirCache(origem, a, 'u1')
    await popular(origem)
    window.dispatchEvent(new Event('pagehide'))
    await vi.waitFor(async () => expect(await a.lerCache('u1')).toBeDefined())
    cancelar()

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } })
    await restaurarCache(qc, a, 'u1')
    expect(qc.getQueryData(['obras'])).toEqual([{ slug: 'hto' }])
    expect(qc.getQueryState(['obras'])?.isInvalidated).toBe(true)
    expect(qc.getQueryState(['imagens', 'fotos', 'x'])?.isInvalidated).toBe(false)
  })

  it('grava na hora quando a página vai para segundo plano', async () => {
    const a = criarArmazenamentoMemoria()
    const qc = novoQc()
    const cancelar = persistirCache(qc, a, 'u1')
    await qc.fetchQuery({ queryKey: ['obras'], queryFn: async () => [] })
    expect(await a.lerCache('u1')).toBeUndefined()
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(async () => expect(await a.lerCache('u1')).toBeDefined())
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    cancelar()
  })
})
