import { afterEach, describe, expect, it, vi } from 'vitest'
import { listarModelos, urlModelo } from './modelos.ts'

function resposta(corpo: string, tipo: string, status = 200) {
  return new Response(corpo, { status, headers: { 'content-type': tipo } })
}

describe('listarModelos', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('lê o manifesto da obra', async () => {
    const modelo = { sigla: 'ARQ', revisao: 'R06', arquivo: 'ARQ.frag', bytes: 10, hash: 'h' }
    const f = vi.fn().mockResolvedValue(resposta(JSON.stringify({ modelos: [modelo] }), 'application/json'))
    vi.stubGlobal('fetch', f)
    expect(await listarModelos('hto')).toEqual([modelo])
    expect(f).toHaveBeenCalledWith('/modelos/hto/manifesto.json')
  })

  it('devolve lista vazia quando não há manifesto (404 ou index.html do Vite)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resposta('', 'text/plain', 404)))
    expect(await listarModelos('hto')).toEqual([])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resposta('<html>', 'text/html')))
    expect(await listarModelos('hto')).toEqual([])
  })

  it('falha do servidor sobe como erro', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resposta('{}', 'application/json', 500)))
    await expect(listarModelos('hto')).rejects.toThrow()
  })
})

it('urlModelo inclui o hash para invalidar o cache', () => {
  const m = { sigla: 'ARQ', revisao: null, arquivo: 'ARQ.frag', bytes: 1, hash: 'abc' }
  expect(urlModelo('hto', m)).toBe('/modelos/hto/ARQ.frag?v=abc')
})
