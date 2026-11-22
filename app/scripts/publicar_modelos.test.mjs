import { describe, expect, it } from 'vitest'
import { enviarModelo, obterSegredo } from './publicar_modelos.mjs'

function resposta(corpo, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => corpo, text: async () => JSON.stringify(corpo) }
}

function fetchFalso(falharEm) {
  const chamadas = []
  const f = async (url, opcoes) => {
    const corpo = typeof opcoes.body === 'string' ? JSON.parse(opcoes.body) : null
    chamadas.push({ url, opcoes, corpo })
    const acao = corpo?.acao ?? 'put'
    if (acao === falharEm) return resposta({ erro: 'divergente' }, acao === 'put' ? 403 : 409)
    if (acao === 'enviar') {
      return resposta({
        situacao: 'enviar',
        url: 'https://r2.exemplo/assinada?sig=ASSINATURA',
        metodo: 'PUT',
        cabecalhos: { 'content-type': 'application/octet-stream' },
        expira_em: 'x',
      })
    }
    if (acao === 'confirmar') return resposta({ situacao: 'confirmado' })
    return resposta({})
  }
  return { f, chamadas }
}

describe('enviarModelo', () => {
  it('faz enviar, PUT e confirmar, com segredo e cabeçalhos certos', async () => {
    const { f, chamadas } = fetchFalso()
    const bytes = new Uint8Array([1, 2, 3])
    await enviarModelo('https://p.supabase.co', 'CHAVE', 'SEG', 'O/ARQ.frag', bytes, f)
    expect(chamadas.map((c) => c.corpo?.acao ?? 'put')).toEqual(['enviar', 'put', 'confirmar'])
    expect(chamadas[0].url).toBe('https://p.supabase.co/functions/v1/armazenamento')
    expect(chamadas[0].opcoes.headers['x-segredo-interno']).toBe('SEG')
    expect(chamadas[0].corpo).toEqual({
      acao: 'enviar', pasta: 'modelos', caminho: 'O/ARQ.frag', tamanho: 3, tipo: 'application/octet-stream',
    })
    expect(chamadas[1].url).toContain('https://r2.exemplo/assinada')
    expect(chamadas[1].opcoes.method).toBe('PUT')
    expect(chamadas[1].opcoes.headers).toEqual({ 'content-type': 'application/octet-stream' })
    expect(chamadas[1].opcoes.body).toBe(bytes)
    expect(chamadas[2].corpo).toEqual({ acao: 'confirmar', pasta: 'modelos', caminho: 'O/ARQ.frag' })
  })

  it('para no confirmar divergente sem vazar chave, segredo nem URL assinada', async () => {
    const { f } = fetchFalso('confirmar')
    const erro = await enviarModelo('https://p.supabase.co', 'CHAVE', 'SEG', 'O/a.frag', new Uint8Array(1), f).catch((e) => e)
    expect(erro.message).toContain('409')
    expect(erro.message).toContain('divergente')
    expect(erro.message).not.toMatch(/CHAVE|SEG\b|ASSINATURA/)
  })

  it('não confirma se o PUT falha', async () => {
    const { f, chamadas } = fetchFalso('put')
    const erro = await enviarModelo('https://p.supabase.co', 'CHAVE', 'SEG', 'O/a.frag', new Uint8Array(1), f).catch((e) => e)
    expect(erro.message).toContain('403')
    expect(erro.message).not.toContain('ASSINATURA')
    expect(chamadas).toHaveLength(2)
  })
})

describe('obterSegredo', () => {
  it('usa o ambiente ou a RPC', async () => {
    expect(await obterSegredo('u', 'c', { SEGREDO_INTERNO: 'AMB' })).toBe('AMB')
    const f = async (url) => {
      expect(url).toBe('https://p.supabase.co/rest/v1/rpc/segredo_interno')
      return resposta('RPC')
    }
    expect(await obterSegredo('https://p.supabase.co', 'c', {}, f)).toBe('RPC')
  })
})
