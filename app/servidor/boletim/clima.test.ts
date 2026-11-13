// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import type { Browser, BrowserContext } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromiumDisponivel } from './__fixtures__/navegador.js'
import { capturarClima, idadeDaLeitura } from './clima.js'
import { URL_OBSERVATORIO } from './estacoes.js'
import { FIXTURES } from './exemplo.js'
import { abrirNavegador } from './pdf.js'

const PAGINA = readFileSync(path.join(FIXTURES, 'observatorio-reduzida.html'), 'utf8')
const AGORA = new Date('2026-11-13T11:00:00Z') // 08:00 em Fortaleza

/** Serve a cópia gravada no lugar da página real (sem rede); `trocar` altera o HTML. */
const servir = (trocar: (html: string) => string = (h) => h) => async (ctx: BrowserContext) => {
  await ctx.route('**/*', (rota) =>
    rota.request().url() === URL_OBSERVATORIO
      ? rota.fulfill({ contentType: 'text/html; charset=utf-8', body: trocar(PAGINA) })
      : rota.abort(),
  )
}

/** Muda o "há N min" da linha da estação na tabela "Últimas 24 horas" (a última com o código). */
const idade = (codigo: string, texto: string) => (html: string) => {
  const i = html.lastIndexOf(`data-estacao="${codigo}"`)
  const a = html.indexOf('<small>', i) + '<small>'.length
  const b = html.indexOf('</small>', a)
  return html.slice(0, a) + texto + html.slice(b)
}

describe('idade da leitura', () => {
  it('reconhece minutos, horas, dias, "agora" e horário', () => {
    expect(idadeDaLeitura('Montese\nhá 20 min', AGORA)).toBe(20)
    expect(idadeDaLeitura('há 3 h', AGORA)).toBe(180)
    expect(idadeDaLeitura('há 2 horas', AGORA)).toBe(120)
    expect(idadeDaLeitura('há 1 dia', AGORA)).toBe(1440)
    expect(idadeDaLeitura('agora', AGORA)).toBe(0)
    expect(idadeDaLeitura('07:40', AGORA)).toBe(20)
    expect(idadeDaLeitura('23:50', AGORA)).toBe(490)
    expect(idadeDaLeitura('Montese', AGORA)).toBeNull()
  })
})

describe.skipIf(!chromiumDisponivel())('captura do clima (cópia gravada da página)', () => {
  let navegador: Browser
  beforeAll(async () => {
    navegador = await abrirNavegador()
  })
  afterAll(async () => {
    await navegador?.close()
  })

  it('copia só a linha da estação principal, da última tabela, em escala 2', async () => {
    const r = await capturarClima(navegador, { principal: '8836', reserva: '9281', agora: () => AGORA, preparar: servir() })
    expect(r.clima).toEqual({
      fonte: 'Observatório de Riscos Climáticos de Fortaleza (Prefeitura de Fortaleza)',
      estacao: { codigo: '8836', nome: 'Montese' },
      leitura: '07:50',
      copiado_em: AGORA.toISOString(),
      imagem_path: null,
    })
    const meta = await sharp(r.imagem!).metadata()
    expect(meta.format).toBe('png')
    // a linha da tabela "Últimas 24 horas" (larga e baixa), não a do mosaico de 30 dias
    expect(meta.width).toBeGreaterThan(2000)
    expect(meta.height).toBeLessThan(200)
    expect(meta.height).toBeGreaterThan(60)
  })

  it('leitura com mais de 3 h → reserva', async () => {
    const r = await capturarClima(navegador, {
      principal: '8836',
      reserva: '9281',
      agora: () => AGORA,
      preparar: servir(idade('8836', 'há 4 h')),
    })
    expect(r.clima).toMatchObject({ estacao: { codigo: '9281', nome: 'Benfica' }, leitura: '07:40' })
    expect(r.imagem).not.toBeNull()
  })

  it('linha ausente → reserva; nenhuma das duas → indisponível com os motivos', async () => {
    const semMontese = await capturarClima(navegador, { principal: '1234', reserva: '9281', agora: () => AGORA, preparar: servir() })
    expect(semMontese.clima).toMatchObject({ estacao: { codigo: '9281' } })

    const r = await capturarClima(navegador, {
      principal: '1234',
      reserva: '9281',
      agora: () => AGORA,
      preparar: servir(idade('9281', 'há 5 h')),
    })
    expect(r).toEqual({
      clima: {
        indisponivel: true,
        motivo: 'estação 1234 não encontrada na tabela; leitura da estação 9281 com mais de 3 h',
      },
      imagem: null,
    })
  })

  it('página fora do ar ou lenta → indisponível', async () => {
    const fora = await capturarClima(navegador, {
      principal: '8836',
      reserva: null,
      agora: () => AGORA,
      preparar: async (ctx) => ctx.route('**/*', (rota) => rota.fulfill({ status: 500, body: 'erro' })),
      tempoMaximoMs: 3000,
    })
    expect(fora.imagem).toBeNull()
    expect(fora.clima).toMatchObject({ indisponivel: true })
    expect((fora.clima as { motivo: string }).motivo).toMatch(/falha ao abrir a página|tempo esgotado/)

    const lenta = await capturarClima(navegador, {
      principal: '8836',
      reserva: null,
      agora: () => AGORA,
      preparar: async (ctx) => ctx.route('**/*', () => new Promise(() => undefined)),
      tempoMaximoMs: 1500,
    })
    expect(lenta.clima).toEqual({ indisponivel: true, motivo: 'tempo esgotado (2 s)' })
  })

  it('etapa sem estação → indisponível sem abrir a página', async () => {
    const r = await capturarClima(navegador, { principal: null, reserva: null })
    expect(r.clima).toEqual({ indisponivel: true, motivo: 'etapa sem estação meteorológica' })
  })
})
