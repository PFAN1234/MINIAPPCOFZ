/**
 * Spans de texto a partir dos itens do pdf.js, no formato do `spans_da_pagina` do extrator
 * Python (PyMuPDF `get_text("dict")`).
 *
 * Regras do MuPDF reproduzidas (stext-device.c):
 * - um item novo continua a linha se tem a mesma direção, está a menos de 0,8 × tamanho
 *   da linha de base e o avanço desde o fim do anterior fica entre -0,15 e 0,8 × tamanho
 *   (acima de 0,15 entra um espaço); fora disso começa outra linha;
 * - dentro da linha, um span novo quando muda a fonte ou o tamanho;
 * - altura do caractere: linha de base − Ascent × tamanho até linha de base − Descent ×
 *   tamanho, com Ascent/Descent do FontDescriptor (ver `metricasFonte.ts`); se
 *   Ascent − Descent < 1, os dois são normalizados para somar 1 (como o PyMuPDF);
 * - caracteres totalmente fora da página são descartados (`TEXT_MEDIABOX_CLIP`);
 * - "negrito falso": o mesmo caractere desenhado de novo quase no mesmo lugar é ignorado;
 * - o texto final perde os espaços das pontas e spans vazios somem.
 *
 * Coordenadas em pontos com origem no canto superior esquerdo da página exibida: o
 * `transform` do viewport do pdf.js (escala 1) já considera a rotação, o `userUnit` e o
 * deslocamento do `viewBox`.
 */
import type { MetricaFonte } from './metricasFonte.ts'
import type { Retangulo, Span } from './tipos.ts'

const SPACE_DIST = 0.15
const SPACE_MAX_DIST = 0.8
const BASE_MAX_DIST = 0.8
const FAKE_BOLD_MAX_DIST = 0.1

/** O que interessa de um `TextItem` do pdf.js. */
export interface ItemPdf {
  str: string
  transform: number[]
  width: number
  height: number
  fontName: string
}

export interface OpcoesSpans {
  /** `viewport.transform` do pdf.js com escala 1. */
  transformViewport: number[]
  largura: number
  altura: number
  /** Ascent/Descent da fonte (`fontName` do item do pdf.js). */
  metrica: (fontName: string) => MetricaFonte
}

type Matriz = [number, number, number, number, number, number]

/** Igual a `Util.transform(m1, m2)` do pdf.js: aplica `m2` e depois `m1`. */
export function multiplicar(m1: number[], m2: number[]): Matriz {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ]
}

/** Arredonda como `round(v, casas)` do Python (para os valores que aparecem aqui). */
export function arredondar(v: number, casas: number): number {
  const r = Number(v.toFixed(casas))
  return Object.is(r, -0) ? 0 : r
}

/** Ascent/Descent ajustados como no PyMuPDF (`JM_char_quad`). */
export function ajustarMetrica({ ascent, descent }: MetricaFonte): MetricaFonte {
  let asc = ascent
  let dsc = descent
  if (asc < 1e-3) {
    asc = 0.9
    dsc = -0.1
  }
  const total = asc - dsc + Number.EPSILON
  if (total < 1) {
    asc /= total
    dsc /= total
  }
  return { ascent: asc, descent: dsc }
}

interface SpanEmMontagem {
  fonte: string
  tamanho: number
  texto: string
  caixa: Retangulo
  direcao: [number, number]
}

function uniao(a: Retangulo, b: Retangulo): Retangulo {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]
}

/** Caixa alinhada aos eixos do quadrilátero entre `p0` e `p1` na linha de base. */
function caixaDoTrecho(p0: [number, number], p1: [number, number], cima: [number, number], m: MetricaFonte): Retangulo {
  const xs: number[] = []
  const ys: number[] = []
  for (const p of [p0, p1]) {
    for (const k of [m.ascent, m.descent]) {
      xs.push(p[0] + cima[0] * k)
      ys.push(p[1] + cima[1] * k)
    }
  }
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

export function montarSpans(itens: ItemPdf[], opcoes: OpcoesSpans): Span[] {
  const vp = opcoes.transformViewport
  const escalaVp = Math.hypot(vp[0], vp[1])
  const linhas: SpanEmMontagem[][] = []
  let linha: SpanEmMontagem[] | null = null
  let fimAnterior: [number, number] | null = null
  let direcaoAnterior: [number, number] | null = null
  let ultimoTexto = ''
  let origemAnterior: [number, number] | null = null

  for (const item of itens) {
    if (!item.str) continue
    // Espaço inserido pelo pdf.js entre trechos (altura 0): o MuPDF decide pelo espaçamento.
    if (item.height === 0 && item.str.trim() === '') continue
    const m = multiplicar(vp, item.transform)
    const tamanho = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]))
    const compX = Math.hypot(m[0], m[1])
    if (tamanho === 0 || compX === 0) continue
    const direcao: [number, number] = [m[0] / compX, m[1] / compX]
    const cima: [number, number] = [m[2], m[3]]
    const origem: [number, number] = [m[4], m[5]]
    const avanco = item.width * escalaVp
    const fim: [number, number] = [origem[0] + direcao[0] * avanco, origem[1] + direcao[1] * avanco]
    const metrica = ajustarMetrica(opcoes.metrica(item.fontName))
    const caixa = caixaDoTrecho(origem, fim, cima, metrica)
    if (caixa[2] < 0 || caixa[0] > opcoes.largura || caixa[3] < 0 || caixa[1] > opcoes.altura) continue

    // Negrito falso (MuPDF): o mesmo caractere de novo, a menos de 0,1 × tamanho da origem anterior.
    if (
      origemAnterior &&
      [...item.str].length === 1 &&
      ultimoTexto.slice(-1) === item.str &&
      Math.hypot(origem[0] - origemAnterior[0], origem[1] - origemAnterior[1]) < FAKE_BOLD_MAX_DIST * tamanho
    ) {
      continue
    }

    let novaLinha = linha === null || direcaoAnterior === null || fimAnterior === null
    let espaco = false
    if (!novaLinha) {
      const cosseno = direcao[0] * direcaoAnterior![0] + direcao[1] * direcaoAnterior![1]
      if (cosseno < 0.999) {
        novaLinha = true
      } else {
        const dx = origem[0] - fimAnterior![0]
        const dy = origem[1] - fimAnterior![1]
        const espacamento = (direcao[0] * dx + direcao[1] * dy) / tamanho
        const desvioBase = (-direcao[1] * dx + direcao[0] * dy) / tamanho
        if (Math.abs(desvioBase) >= BASE_MAX_DIST) novaLinha = true
        else if (Math.abs(espacamento) < SPACE_DIST) espaco = false
        else if (espacamento > 0 && espacamento < SPACE_MAX_DIST) espaco = true
        else novaLinha = true
      }
    }
    if (novaLinha) {
      linha = []
      linhas.push(linha)
      espaco = false
    }
    const atual = linha!
    const tamanhoArred = arredondar(tamanho, 3)
    let span = atual[atual.length - 1]
    if (!span || span.fonte !== item.fontName || span.tamanho !== tamanhoArred) {
      span = { fonte: item.fontName, tamanho: tamanhoArred, texto: '', caixa, direcao: atual[0]?.direcao ?? direcao }
      atual.push(span)
    }
    if (espaco && !/\s$/.test(ultimoTexto) && !/^\s/.test(item.str)) {
      // Espaço sintético do MuPDF: vai do fim do anterior até a origem do novo.
      span.texto += ' '
      span.caixa = uniao(span.caixa, caixaDoTrecho(fimAnterior!, origem, cima, metrica))
    }
    span.texto += item.str
    span.caixa = uniao(span.caixa, caixa)
    fimAnterior = fim
    origemAnterior = [origem[0] + direcao[0] * (avanco - avanco / Math.max(1, [...item.str].length)), origem[1] + direcao[1] * (avanco - avanco / Math.max(1, [...item.str].length))]
    direcaoAnterior = direcao
    ultimoTexto = item.str
  }

  const spans: Span[] = []
  for (const l of linhas) {
    for (const s of l) {
      const texto = s.texto.trim()
      if (!texto) continue
      spans.push({
        text: texto,
        bbox: s.caixa.map((v) => arredondar(v, 3)) as Retangulo,
        size: s.tamanho,
        direction: [s.direcao[0] === 0 ? 0 : s.direcao[0], s.direcao[1] === 0 ? 0 : s.direcao[1]],
      })
    }
  }
  return spans
}
