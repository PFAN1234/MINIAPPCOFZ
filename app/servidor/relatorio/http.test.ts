// @vitest-environment node
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import type { Dependencias } from '../boletim/gerador.js'
import { ErroRpc } from '../boletim/supabase.js'
import { relatorioExemplo } from './exemplo.js'
import { respostaDeErroRelatorio, subDoJwt, tratarRelatorio } from './http.js'
import type { AcessoRelatorio, FonteRelatorio } from './supabase.js'
import type { RelatorioPendencias } from './tipos.js'

const SUB = '22222222-2222-4222-8222-222222222222'
const ETAPA = '11111111-1111-4111-8111-111111111111'
const OBRA = '33333333-3333-4333-8333-333333333333'
const jwt = (sub: string = SUB) => `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.assinatura`

async function jpegDeTeste(): Promise<Uint8Array> {
  return sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#888' } }).jpeg().toBuffer()
}

function montar(opcoes: { erro?: ErroRpc; relatorio?: RelatorioPendencias } = {}) {
  const enviados: { bucket: string; caminho: string; tipo: string; tamanho: number }[] = []
  const baixados: string[] = []
  const chamadas: unknown[][] = []
  const html: string[] = []
  const jpeg = jpegDeTeste()
  const fonte: FonteRelatorio = {
    async baixar(bucket, caminho) {
      baixados.push(`${bucket}/${caminho}`)
      if (caminho === 'e/o/b1.jpg') throw new Error('sumiu')
      return bucket === 'organizacao' ? new Uint8Array([0x89, 0x50, 0x4e, 0x47]) : jpeg
    },
    async enviar(bucket, caminho, bytes, tipo) {
      enviados.push({ bucket, caminho, tipo, tamanho: bytes.length })
    },
    async assinar(bucket, caminho, segundos) {
      return `https://exemplo/${bucket}/${caminho}?exp=${segundos}`
    },
  }
  const acesso = (j: string): AcessoRelatorio => ({
    async relatorioPendencias(etapa, obra) {
      chamadas.push([j, etapa, obra])
      if (opcoes.erro) throw opcoes.erro
      return opcoes.relatorio ?? relatorioExemplo({ obra: obra ? { id: obra, slug: 'hto', nome: 'HTO' } : null })
    },
  })
  const logs: string[] = []
  const deps = {
    abrirNavegador: async () => ({ close: async () => undefined }),
    gerarPdf: async (_n: unknown, h: string) => {
      html.push(h)
      return Buffer.from('%PDF-falso')
    },
    log: (m: string) => logs.push(m),
  } as unknown as Dependencias
  return { ctx: { fonte, acesso, deps }, enviados, baixados, chamadas, html, logs }
}

const pedido = (corpo: unknown, headers: Record<string, string> = { authorization: `Bearer ${jwt()}` }, method = 'POST') =>
  new Request('https://x/api/relatorio-pendencias', { method, headers, body: method === 'POST' ? JSON.stringify(corpo) : undefined })

describe('tratarRelatorio', () => {
  it('405 fora do POST', async () => {
    expect((await tratarRelatorio(pedido(null, {}, 'GET'), montar().ctx)).status).toBe(405)
  })

  it('401 sem Bearer ou com token sem sub UUID', async () => {
    const m = montar()
    expect((await tratarRelatorio(pedido({ etapa_id: ETAPA }, {}), m.ctx)).status).toBe(401)
    const r = await tratarRelatorio(pedido({ etapa_id: ETAPA }, { authorization: 'Bearer lixo' }), m.ctx)
    expect(r.status).toBe(401)
    expect(((await r.json()) as { erro: string }).erro).toBe('Sua sessão expirou. Entre de novo.')
    expect(subDoJwt(jwt('../x'))).toBeNull()
    expect(m.chamadas).toHaveLength(0)
  })

  it('400 com UUIDs inválidos ou corpo que não é JSON', async () => {
    const m = montar()
    expect((await tratarRelatorio(pedido({ etapa_id: 'abc' }), m.ctx)).status).toBe(400)
    expect((await tratarRelatorio(pedido({ etapa_id: ETAPA, obra_id: 'abc' }), m.ctx)).status).toBe(400)
    expect((await tratarRelatorio(pedido({}), m.ctx)).status).toBe(400)
    const ruim = new Request('https://x/', { method: 'POST', headers: { authorization: `Bearer ${jwt()}` }, body: 'nao json' })
    expect((await tratarRelatorio(ruim, m.ctx)).status).toBe(400)
  })

  it('erros da RPC: 403, 404 e 400', async () => {
    for (const [codigo, status] of [['42501', 403], ['P0002', 404], ['22023', 400]] as const) {
      const m = montar({ erro: new ErroRpc('relatorio_pendencias: Acesso negado', codigo) })
      const r = await tratarRelatorio(pedido({ etapa_id: ETAPA, obra_id: null }), m.ctx)
      expect(r.status).toBe(status)
      expect(((await r.json()) as { erro: string }).erro).toBe('Acesso negado')
    }
  })

  it('gera, grava em pendencias/<sub>/<etapa>-<obra>.pdf com upsert e devolve a URL assinada', async () => {
    const m = montar()
    const r = await tratarRelatorio(pedido({ etapa_id: ETAPA, obra_id: OBRA }), m.ctx)
    expect(r.status).toBe(200)
    expect(m.chamadas[0]).toEqual([jwt(), ETAPA, OBRA])
    const caminho = `pendencias/${SUB}/2a-etapa-hto.pdf`
    expect(m.enviados).toEqual([{ bucket: 'relatorios', caminho, tipo: 'application/pdf', tamanho: 10 }])
    expect(((await r.json()) as { url: string }).url).toBe(`https://exemplo/relatorios/${caminho}?exp=600`)
  })

  it('sem obra, o nome termina em "-etapa"; foto que não baixa vira "indisponível" e é registrada', async () => {
    const m = montar()
    const r = await tratarRelatorio(pedido({ etapa_id: ETAPA, obra_id: null }), m.ctx)
    expect(r.status).toBe(200)
    expect(m.enviados[0].caminho).toBe(`pendencias/${SUB}/2a-etapa-etapa.pdf`)
    expect(m.html[0]).toContain('foto indisponível')
    expect(m.html[0]).toContain('data:image/jpeg;base64,')
    expect(m.logs.some((l) => l.includes('e/o/b1.jpg'))).toBe(true)
    expect(m.baixados).toContain('organizacao/logo.png')
  })

  it('erro inesperado vira 500 com mensagem genérica', async () => {
    const r = respostaDeErroRelatorio(new Error('quebrou'), () => undefined)
    expect(r.status).toBe(500)
    expect(((await r.json()) as { erro: string }).erro).toBe('Não foi possível gerar o relatório. Tente de novo.')
  })
})
