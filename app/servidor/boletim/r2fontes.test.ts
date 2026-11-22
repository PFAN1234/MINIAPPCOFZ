import { describe, expect, it } from 'vitest'
import type { ClienteR2 } from '../_compartilhado/r2.js'
import { criarFonteRelatorio } from '../relatorio/supabase.js'
import { criarFonteSupabase } from './supabase.js'

const cfg = { url: 'http://localhost:1', chaveSecreta: 'x' }

function r2Falso(falha = false) {
  const eventos: string[] = []
  const r2 = {
    async gravar(chave: string, bytes: Uint8Array, tipo: string) {
      if (falha) throw new Error('r2 fora')
      eventos.push(`gravar ${chave} ${bytes.length} ${tipo}`)
    },
    async baixar(chave: string) {
      if (falha) throw new Error('r2 fora')
      eventos.push(`baixar ${chave}`)
      return new Uint8Array([1, 2])
    },
    async urlAssinada(m: string, chave: string, s: number) {
      if (falha) throw new Error('r2 fora')
      return `https://r2/${m}/${chave}?s=${s}`
    },
  } as unknown as ClienteR2
  return { r2, eventos }
}

/** Troca o fetch global para capturar a RPC (o supabase-js usa fetch). */
async function comRpc(status: number, fn: () => Promise<unknown>) {
  const original = globalThis.fetch
  const chamadas: { url: string; corpo: unknown }[] = []
  globalThis.fetch = (async (url: unknown, init?: { body?: string }) => {
    chamadas.push({ url: String(url), corpo: init?.body ? JSON.parse(init.body) : null })
    return new Response(status === 200 ? 'null' : JSON.stringify({ message: 'caminho_invalido', code: 'P0001' }), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
  try {
    const erro = await fn().then(
      () => null,
      (e: unknown) => e as Error,
    )
    return { erro, chamadas }
  } finally {
    globalThis.fetch = original
  }
}

describe.each([
  ['boletim', (r2: ClienteR2) => criarFonteSupabase(cfg, r2)],
  ['relatório', (r2: ClienteR2) => criarFonteRelatorio(cfg, r2)],
])('fonte %s no R2', (_n, criar) => {
  it('baixa com a chave <pasta>/<caminho>', async () => {
    const { r2, eventos } = r2Falso()
    expect(await criar(r2).baixar('fotos', 'a/b.jpg')).toEqual(new Uint8Array([1, 2]))
    expect(eventos).toEqual(['baixar fotos/a/b.jpg'])
  })

  it('envia, depois registra o arquivo na RPC', async () => {
    const { r2, eventos } = r2Falso()
    const { erro, chamadas } = await comRpc(200, () => criar(r2).enviar('boletins', 'x/y.pdf', new Uint8Array(5), 'application/pdf'))
    expect(erro).toBeNull()
    expect(eventos).toEqual(['gravar boletins/x/y.pdf 5 application/pdf'])
    expect(chamadas).toHaveLength(1)
    expect(chamadas[0].url).toContain('/rpc/arquivo_registrar_servico')
    expect(chamadas[0].corpo).toEqual({ p_pasta: 'boletins', p_caminho: 'x/y.pdf', p_tamanho: 5, p_tipo: 'application/pdf' })
  })

  it('lança se o R2 falhar, sem registrar', async () => {
    const { r2 } = r2Falso(true)
    const { erro, chamadas } = await comRpc(200, () => criar(r2).enviar('boletins', 'x.pdf', new Uint8Array(1), 'application/pdf'))
    expect(erro?.message).toMatch(/enviar boletins\/x.pdf/)
    expect(chamadas).toHaveLength(0)
    await expect(criar(r2).baixar('fotos', 'a.jpg')).rejects.toThrow(/baixar fotos\/a.jpg/)
  })

  it('lança se a RPC falhar', async () => {
    const { r2 } = r2Falso()
    const { erro } = await comRpc(400, () => criar(r2).enviar('boletins', 'x.pdf', new Uint8Array(1), 'application/pdf'))
    expect(erro?.message).toMatch(/arquivo_registrar_servico/)
  })
})

describe('fonte do relatório: assinar', () => {
  it('usa a URL assinada de GET do R2', async () => {
    const { r2 } = r2Falso()
    expect(await criarFonteRelatorio(cfg, r2).assinar('relatorios', 'p/r.pdf', 600)).toBe('https://r2/GET/relatorios/p/r.pdf?s=600')
  })
  it('lança se o R2 falhar', async () => {
    await expect(criarFonteRelatorio(cfg, r2Falso(true).r2).assinar('relatorios', 'p/r.pdf', 600)).rejects.toThrow(/assinar/)
  })
})
