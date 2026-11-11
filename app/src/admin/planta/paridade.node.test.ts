// @vitest-environment node
/**
 * Paridade com o Python: os PDFs de HTO (2) e COFZ (1), lidos com o pdf.js (build legacy) e
 * passados pelo port do extrator, têm de dar o `data/<slug>/ambientes.json` e as contas do
 * `data/<slug>/plantas.json` gerados pelo PyMuPDF.
 *
 * Tolerâncias: pinos e caixas de rótulo em 0,002 (normalizado); recortes em 0,5 pt; imagens
 * em 1 px. Os desvios medidos ficam bem abaixo (ver docs/admin.md, "Paridade com o Python").
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createCanvas } from '@napi-rs/canvas'
import { beforeAll, describe, expect, it } from 'vitest'
import { extrair, validarObra } from './extrair.ts'
import { abrirPdf, lerPagina, type ModuloPdfJs, type PaginaPdf } from './pdf.ts'
import { calcularPlanta } from './plantas.ts'
import { desenharProva, renderizarRecorte, type CanvasPlanta } from './render.ts'
import type { BaseExtracao, ObraConfig, ResultadoExtracao } from './tipos.ts'

const RAIZ = fileURLToPath(new URL('../../../../', import.meta.url))
const ler = <T>(rel: string): T => JSON.parse(readFileSync(RAIZ + rel, 'utf8')) as T

interface PlantasJson {
  pavimentos: {
    id: string
    pagina_pt: [number, number]
    recorte_pt: number[]
    imagens: Record<'planta' | 'planta-hd', { largura: number; altura: number; escala_px_por_pt: number }>
    detalhes: Record<string, { recorte_pt: number[]; largura: number; altura: number }>
  }[]
}

const TOL_NORMALIZADO = 0.002
const TOL_PT = 0.5
const TOL_PX = 1

const paginas: Record<string, Record<string, PaginaPdf>> = {}

async function lerObra(slug: string) {
  const obra = ler<ObraConfig>(`data/${slug}/obra.json`)
  const resultado: Record<string, PaginaPdf> = {}
  for (const pav of obra.pavimentos) {
    const bytes = new Uint8Array(readFileSync(`${RAIZ}${obra.pasta_pdf}/${pav.pdf}`))
    const pdf = await abrirPdf(pdfjs as unknown as ModuloPdfJs, bytes)
    resultado[pav.codigo] = await lerPagina(pdf, pav.pagina ?? 1)
  }
  return resultado
}

beforeAll(async () => {
  paginas.hto = await lerObra('hto')
  paginas.cofz = await lerObra('cofz')
}, 120_000)

describe.each(['hto', 'cofz'])('paridade %s', (slug) => {
  const obra = ler<ObraConfig>(`data/${slug}/obra.json`)
  const esperado = ler<ResultadoExtracao>(`data/${slug}/ambientes.json`)
  const plantas = ler<PlantasJson>(`data/${slug}/plantas.json`)

  it('página do mesmo tamanho (pontos, float32 como o MuPDF)', () => {
    for (const p of plantas.pavimentos) {
      expect(paginas[slug][p.id].largura).toBe(p.pagina_pt[0])
      expect(paginas[slug][p.id].altura).toBe(p.pagina_pt[1])
    }
  })

  it('base vazia: mesmos ambientes, nomes, categorias, áreas e pinos', () => {
    validarObra(obra, slug)
    const r = extrair(obra, paginas[slug], null)
    expect(r.ambientes.map((a) => a.id)).toEqual(esperado.ambientes.map((a) => a.id))
    let maior = 0
    r.ambientes.forEach((a, i) => {
      const e = esperado.ambientes[i]
      expect({ ...a, marcadores: a.marcadores.length }).toEqual({ ...e, marcadores: e.marcadores.length })
      a.marcadores.forEach((m, k) => {
        const em = e.marcadores[k]
        const desvios = [m.x - em.x, m.y - em.y, ...m.rotulo_bbox.map((v, j) => v - em.rotulo_bbox[j])].map(Math.abs)
        maior = Math.max(maior, ...desvios)
      })
    })
    expect(maior).toBeLessThanOrEqual(TOL_NORMALIZADO)
    expect(r.revisar).toEqual(esperado.revisar)
    expect(r.pavimentos).toEqual(esperado.pavimentos)
    console.info(`[paridade ${slug}] ${r.ambientes.length} ambientes; maior desvio de pino/rótulo: ${maior.toExponential(2)}`)
  })

  it('base = ambientes.json: mesmas diferenças e removidos (execução idempotente)', () => {
    const r = extrair(obra, paginas[slug], JSON.parse(JSON.stringify(esperado)) as BaseExtracao)
    expect(r.diferencas).toEqual(esperado.diferencas)
    expect(r.ambientes_removidos).toEqual(esperado.ambientes_removidos)
    expect(r.status).toBe(esperado.status)
  })

  it('recortes e tamanhos das imagens iguais aos do plantas.json', () => {
    const r = extrair(obra, paginas[slug], null)
    let maiorPt = 0
    let maiorPx = 0
    for (const p of plantas.pavimentos) {
      const c = calcularPlanta(obra.prancha, paginas[slug][p.id], r.ambientes.filter((a) => a.pavimento === p.id))
      maiorPt = Math.max(maiorPt, ...c.recorte_pt.map((v, i) => Math.abs(v - p.recorte_pt[i])))
      for (const k of ['planta', 'planta-hd'] as const) {
        maiorPx = Math.max(maiorPx, Math.abs(c.imagens[k].largura - p.imagens[k].largura))
        maiorPx = Math.max(maiorPx, Math.abs(c.imagens[k].altura - p.imagens[k].altura))
        expect(c.imagens[k].escala).toBeCloseTo(p.imagens[k].escala_px_por_pt, 5)
      }
      expect(Object.keys(c.detalhes).sort()).toEqual(Object.keys(p.detalhes).sort())
      for (const [id, d] of Object.entries(p.detalhes)) {
        const e = c.detalhes[id]
        maiorPt = Math.max(maiorPt, ...e.recorte_pt.map((v, i) => Math.abs(v - d.recorte_pt[i])))
        maiorPx = Math.max(maiorPx, Math.abs(e.largura - d.largura), Math.abs(e.altura - d.altura))
      }
    }
    expect(maiorPt).toBeLessThanOrEqual(TOL_PT)
    expect(maiorPx).toBeLessThanOrEqual(TOL_PX)
    console.info(`[paridade ${slug}] recortes: maior desvio ${maiorPt.toFixed(4)} pt; tamanhos: ${maiorPx} px`)
  })
})

describe('renderização (pdf.js + @napi-rs/canvas)', () => {
  const criar = (w: number, h: number) => createCanvas(w, h) as unknown as CanvasPlanta

  it('recorte de detalhe do tamanho calculado, com desenho, e máscara branca', async () => {
    const obra = ler<ObraConfig>('data/cofz/obra.json')
    const pagina = paginas.cofz.terreo
    const r = extrair(obra, paginas.cofz, null)
    const c = calcularPlanta(obra.prancha, pagina, r.ambientes)
    const copa = c.detalhes['terreo-copa']
    const canvas = await renderizarRecorte(pagina.pagina, copa, c.mascaras, pagina, criar)
    expect([canvas.width, canvas.height]).toEqual([881, 501])
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
    const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    let escuros = 0
    for (let i = 0; i < px.length; i += 4) if (px[i] < 128) escuros++
    expect(escuros).toBeGreaterThan(1000)

    // Visão geral: o canto da máscara (carimbo, embaixo à direita) fica branco.
    const vg = await renderizarRecorte(pagina.pagina, c.imagens.planta, c.mascaras, pagina, criar)
    expect([vg.width, vg.height]).toEqual([2401, 1056])
    const g = (vg.getContext('2d') as CanvasRenderingContext2D).getImageData(vg.width - 40, vg.height - 40, 30, 30).data
    expect([...g].every((v) => v === 255)).toBe(true)
    const prova = desenharProva(vg, c.imagens.planta, pagina, r.ambientes.flatMap((a) => a.marcadores), criar)
    expect([prova.width, prova.height]).toEqual([2401, 1056])
  }, 60_000)
})
