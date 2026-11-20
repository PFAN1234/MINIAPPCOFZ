// @vitest-environment node
import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { descritoresNoTexto, lerMetricasFontes, metricaDaFonte } from './metricasFonte.ts'
import { ajustarMetrica, montarSpans, type ItemPdf } from './spans.ts'

// Página A4 deitada com origem no centro (como as pranchas): viewport do pdf.js em escala 1.
const VIEWPORT = [1, 0, 0, -1, 500, 300]
const opcoes = {
  transformViewport: VIEWPORT,
  largura: 1000,
  altura: 600,
  metrica: (f: string) => (f === 'arial' ? { ascent: 1.04, descent: -0.325 } : { ascent: 0.963, descent: -0.236 }),
}

/** Item horizontal com a linha de base em (x, y) na página (origem no canto superior esquerdo). */
function item(str: string, x: number, y: number, largura: number, fonte = 'futura', tamanho = 5.5): ItemPdf {
  return { str, transform: [tamanho, 0, 0, tamanho, x - 500, 300 - y], width: largura, height: tamanho, fontName: fonte }
}

describe('montarSpans', () => {
  it('caixa com Ascent/Descent do descritor, texto sem espaços nas pontas', () => {
    const [s] = montarSpans([item(' WC FEM ', 100, 200, 20)], opcoes)
    expect(s).toEqual({ text: 'WC FEM', bbox: [100, 200 - 0.963 * 5.5, 120, 200 + 0.236 * 5.5].map((v) => Number(v.toFixed(3))), size: 5.5, direction: [1, 0] })
  })

  it('junta trechos da mesma linha (com espaço) e separa os distantes', () => {
    const spans = montarSpans(
      [item('APTO.', 100, 200, 15), item('101', 116.5, 200, 9), item('MO5', 140, 200, 10)],
      opcoes,
    )
    expect(spans.map((s) => s.text)).toEqual(['APTO. 101', 'MO5'])
    expect(spans[0].bbox[2]).toBe(125.5)
  })

  it('outra fonte na mesma linha vira outro span; outra linha de base, outra linha', () => {
    const spans = montarSpans([item('A=', 100, 200, 6), item('5 m²', 106, 200, 10, 'arial'), item('X', 106, 210, 3)], opcoes)
    expect(spans.map((s) => s.text)).toEqual(['A=', '5 m²', 'X'])
  })

  it('ignora espaço falso do pdf.js, negrito falso e o que está fora da página', () => {
    const espaco = { ...item(' ', 110, 200, 2), height: 0 }
    const spans = montarSpans(
      [item('S', 100, 200, 4), item('S', 100.2, 200, 4), espaco, item('FORA', 1200, 200, 20)],
      opcoes,
    )
    expect(spans.map((s) => s.text)).toEqual(['S'])
  })

  it('texto vertical: direção e caixa giradas', () => {
    const vertical: ItemPdf = { str: 'TELHADO', transform: [0, 6, -6, 0, -100, 0], width: 30, height: 6, fontName: 'arial' }
    const [s] = montarSpans([vertical], opcoes)
    expect(s.direction).toEqual([0, -1])
    expect(s.bbox[3] - s.bbox[1]).toBeCloseTo(30, 3)
  })

  it('métrica com Ascent − Descent < 1 é normalizada como no PyMuPDF', () => {
    const m = ajustarMetrica({ ascent: 0.7, descent: -0.2 })
    expect(m.ascent - m.descent).toBeCloseTo(1, 6)
    expect(ajustarMetrica({ ascent: 0, descent: 0 })).toEqual({ ascent: 0.9, descent: -0.1 })
  })
})

describe('métricas das fontes (FontDescriptor)', () => {
  const desc = (nome: string, asc: number, dsc: number) =>
    `<</Type/FontDescriptor/Ascent ${asc}/CIDSet 25 0 R/Descent ${dsc}/FontBBox[-665 -325 2000 1040]/FontName/${nome}/Style<</Panose<01>>>>>`

  it('lê dicionários soltos, com e sem o prefixo de subconjunto', () => {
    const m = descritoresNoTexto(`1 0 obj ${desc('FXMBPV+ArialMT', 1040, -325)} endobj`)
    expect(metricaDaFonte(m, 'FXMBPV+ArialMT')).toEqual({ ascent: 1.04, descent: -0.325 })
    expect(metricaDaFonte(m, 'ABCDEF+ArialMT')).toEqual({ ascent: 1.04, descent: -0.325 })
    expect(metricaDaFonte(m, 'Calibri')).toBeNull()
  })

  it('lê descritores dentro de object streams compactados', async () => {
    const conteudo = deflateSync(Buffer.from(`5 0 ${desc('XX+Calibri', 1026, -312)}`, 'latin1'))
    const pdf = Buffer.concat([
      Buffer.from(`%PDF-1.6\n9 0 obj <</Type/ObjStm/N 1/First 4/Filter/FlateDecode/Length ${conteudo.length}>>stream\n`, 'latin1'),
      conteudo,
      Buffer.from('\nendstream endobj\n', 'latin1'),
    ])
    const m = await lerMetricasFontes(new Uint8Array(pdf))
    expect(metricaDaFonte(m, 'XX+Calibri')).toEqual({ ascent: 1.026, descent: -0.312 })
  })
})
