import { describe, expect, it, vi } from 'vitest'
import { contratoArmazenamento } from '../application/ports/Armazenamento.contract.ts'
import { criarArmazenamentoSupabase } from './ArmazenamentoSupabaseAdapter.ts'

const AGORA = Date.parse('2026-11-10T12:00:00Z')

function httpErro(status: number, erro: string) {
  return {
    name: 'FunctionsHttpError',
    context: new Response(JSON.stringify({ erro }), { status }),
  }
}

/** Servidor simulado: `functions.invoke` e `fetch` sobre um mapa em memória. */
function servidor(opcoes: { validadeS?: number } = {}) {
  const confirmados = new Map<string, Blob>()
  const enviados = new Map<string, Blob>()
  const chamadas: Array<Record<string, unknown>> = []
  const puts: string[] = []
  let contador = 0
  type Resp = { data: unknown; error: unknown }
  const invoke = vi.fn(
    async (_nome: string, { body }: { body: Record<string, unknown> }): Promise<Resp> => {
      chamadas.push(body)
      const chave = `${body.pasta}/${body.caminho}`
      switch (body.acao) {
        case 'enviar':
          if (confirmados.has(chave)) return { data: { situacao: 'ja_confirmado' }, error: null }
          return {
            data: {
              situacao: 'enviar',
              url: `https://r2.test/put/${chave}?n=${++contador}`,
              metodo: 'PUT',
              cabecalhos: { 'content-type': body.tipo },
            },
            error: null,
          }
        case 'confirmar': {
          const b = enviados.get(chave)
          if (!b) return { data: null, error: httpErro(404, 'nao_encontrado') }
          confirmados.set(chave, b)
          return { data: { situacao: 'confirmado' }, error: null }
        }
        case 'ler': {
          const urls: Record<string, string> = {}
          for (const i of body.itens as Array<{
            pasta: string
            caminho: string
          }>) {
            const k = `${i.pasta}/${i.caminho}`
            if (confirmados.has(k)) urls[k] = `https://r2.test/get/${k}?n=${++contador}`
          }
          return {
            data: {
              urls,
              expira_em: new Date(AGORA + (opcoes.validadeS ?? 3600) * 1000).toISOString(),
            },
            error: null,
          }
        }
        case 'excluir':
          confirmados.delete(chave)
          enviados.delete(chave)
          return { data: { situacao: 'excluido' }, error: null }
      }
      return { data: null, error: httpErro(400, 'entrada_invalida') }
    },
  )
  const http = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url))
    const chave = decodeURIComponent(u.pathname.replace(/^\/(put|get)\//, ''))
    if (init?.method === 'PUT') {
      puts.push(String(url))
      enviados.set(chave, init.body as Blob)
      return new Response(null, { status: 200 })
    }
    const b = confirmados.get(chave)
    return b
      ? ({
          ok: true,
          status: 200,
          blob: async () => b,
        } as unknown as Response)
      : new Response(null, { status: 404 })
  })
  return { invoke, http, chamadas, puts, confirmados }
}

function criar(s = servidor(), extra = {}) {
  return criarArmazenamentoSupabase({ functions: { invoke: s.invoke } } as never, {
    fetch: s.http as never,
    agora: () => AGORA,
    armazenamentoLocal: null,
    ...extra,
  })
}

contratoArmazenamento('supabase (simulado)', () => criar())

const JPEG = () => new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' })

describe('ArmazenamentoSupabaseAdapter', () => {
  it('envia na ordem enviar, PUT, confirmar, com tamanho e tipo', async () => {
    const s = servidor()
    await criar(s).enviar('fotos', 'o/r/f.jpg', JPEG(), 'image/jpeg')
    expect(s.chamadas[0]).toMatchObject({
      acao: 'enviar',
      tamanho: 4,
      tipo: 'image/jpeg',
    })
    expect(s.puts).toHaveLength(1)
    expect(s.chamadas[1]).toMatchObject({
      acao: 'confirmar',
      pasta: 'fotos',
      caminho: 'o/r/f.jpg',
    })
    expect(s.http.mock.calls[0][1]?.headers).toEqual({
      'content-type': 'image/jpeg',
    })
  })

  it('403 no PUT pede uma URL nova uma vez; o segundo 403 vira permissao', async () => {
    const s = servidor()
    let n = 0
    s.http.mockImplementation(async (url, init) => {
      if (init?.method === 'PUT') {
        n++
        s.puts.push(String(url))
        return new Response(null, { status: n === 1 ? 403 : 200 })
      }
      return new Response(null, { status: 404 })
    })
    s.invoke.mockImplementation(async (_n, { body }) => {
      s.chamadas.push(body)
      if (body.acao === 'enviar') {
        return {
          data: {
            situacao: 'enviar',
            url: `https://r2.test/put/x?n=${s.chamadas.length}`,
            cabecalhos: {},
          },
          error: null,
        }
      }
      return { data: { situacao: 'confirmado' }, error: null }
    })
    expect(await criar(s).enviar('fotos', 'a/b.jpg', JPEG(), 'image/jpeg')).toBe('enviado')
    expect(s.puts).toHaveLength(2)
    expect(s.puts[0]).not.toBe(s.puts[1])

    const s2 = servidor()
    s2.http.mockImplementation(async () => new Response(null, { status: 403 }))
    await expect(criar(s2).enviar('fotos', 'a/b.jpg', JPEG(), 'image/jpeg')).rejects.toMatchObject({
      tipo: 'permissao',
    })
    expect(s2.http).toHaveBeenCalledTimes(2)
  })

  it('falha de rede e timeout no PUT viram erro de rede', async () => {
    const s = servidor()
    s.http.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(criar(s).enviar('fotos', 'a/b.jpg', JPEG(), 'image/jpeg')).rejects.toMatchObject({
      tipo: 'rede',
    })

    const s2 = servidor()
    s2.http.mockImplementation(
      (_u, init) =>
        new Promise((_res, rej) => {
          init?.signal?.addEventListener('abort', () =>
            rej(new DOMException('abort', 'AbortError')),
          )
        }),
    )
    await expect(
      criar(s2, { timeoutPutMs: 5 }).enviar('fotos', 'a/b.jpg', JPEG(), 'image/jpeg'),
    ).rejects.toMatchObject({ tipo: 'rede' })
  })

  it('erros da function mapeiam para os tipos do app', async () => {
    const s = servidor()
    s.invoke.mockResolvedValueOnce({
      data: null,
      error: httpErro(403, 'sem_permissao'),
    })
    await expect(criar(s).enviar('fotos', 'a/b.jpg', JPEG(), 'image/jpeg')).rejects.toMatchObject({
      tipo: 'permissao',
    })
    s.invoke.mockResolvedValueOnce({
      data: null,
      error: httpErro(401, 'sem_sessao'),
    })
    await expect(criar(s).urls('fotos', ['x'])).rejects.toMatchObject({
      tipo: 'sessao',
    })
    s.invoke.mockResolvedValueOnce({
      data: null,
      error: { name: 'FunctionsFetchError' },
    })
    await expect(criar(s).excluir('fotos', 'x')).rejects.toMatchObject({
      tipo: 'rede',
    })
  })

  it('urls usa cache e renova quando faltam menos de 5 min para expirar', async () => {
    const s = servidor({ validadeS: 3600 })
    let t = AGORA
    const a = criar(s, { agora: () => t })
    await a.enviar('fotos', 'a.jpg', JPEG(), 'image/jpeg')
    const lerCount = () => s.chamadas.filter((c) => c.acao === 'ler').length
    const u1 = (await a.urls('fotos', ['a.jpg'])).get('a.jpg')
    await a.urls('fotos', ['a.jpg'])
    expect(lerCount()).toBe(1)
    t = AGORA + 3600_000 - 4 * 60_000
    s.invoke.mockClear()
    const u2 = (await a.urls('fotos', ['a.jpg'])).get('a.jpg')
    expect(lerCount()).toBe(2)
    expect(s.invoke).toHaveBeenCalledTimes(1)
    expect(u2).not.toBe(u1)
  })

  it('urls pede em lotes de até 200', async () => {
    const s = servidor()
    const caminhos = Array.from({ length: 450 }, (_, i) => `c${i}.jpg`)
    await criar(s).urls('fotos', caminhos)
    const lotes = s.chamadas
      .filter((c) => c.acao === 'ler')
      .map((c) => (c.itens as unknown[]).length)
    expect(lotes).toEqual([200, 200, 50])
  })

  it('logo da pasta organizacao persiste no localStorage e sobrevive a falhas dele', async () => {
    const s = servidor()
    const memoria = new Map<string, string>()
    const local = {
      getItem: (k: string) => memoria.get(k) ?? null,
      setItem: (k: string, v: string) => void memoria.set(k, v),
      removeItem: (k: string) => void memoria.delete(k),
    }
    const a = criar(s, { armazenamentoLocal: local })
    await a.enviar('organizacao', 'logo.png', JPEG(), 'image/png')
    const u1 = (await a.urls('organizacao', ['logo.png'])).get('logo.png')
    expect(memoria.size).toBe(1)

    // outra instância (reabertura do app) usa o valor persistido, sem chamar a function
    s.invoke.mockClear()
    const b = criar(s, { armazenamentoLocal: local })
    expect((await b.urls('organizacao', ['logo.png'])).get('logo.png')).toBe(u1)
    expect(s.invoke).not.toHaveBeenCalled()

    const quebrado = {
      getItem: () => {
        throw new Error('negado')
      },
      setItem: () => {
        throw new Error('cheio')
      },
      removeItem: () => {
        throw new Error('negado')
      },
    }
    const c = criar(s, { armazenamentoLocal: quebrado })
    expect((await c.urls('organizacao', ['logo.png'])).has('logo.png')).toBe(true)
  })
})
