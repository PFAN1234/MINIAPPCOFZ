/**
 * Ascent e Descent das fontes, lidos dos `/FontDescriptor` do PDF.
 *
 * O PyMuPDF (MuPDF) monta a altura de cada span com o Ascent/Descent do FontDescriptor
 * (ex.: ArialMT 1040/-325), enquanto o pdf.js informa os valores da tabela `hhea` da fonte
 * embutida (0,905/-0,212). Para os bboxes baterem com os do extrator Python, os valores do
 * descritor são lidos direto dos bytes do PDF: dicionários soltos e também os guardados em
 * object streams (`/Type /ObjStm` com FlateDecode).
 */

export interface MetricaFonte {
  ascent: number
  descent: number
}

/** Nome da fonte no PDF → métrica (por `/FontName`, com e sem o prefixo de subconjunto `ABCDEF+`). */
export type MetricasFontes = Map<string, MetricaFonte>

function latin1(bytes: Uint8Array): string {
  let s = ''
  const passo = 0x8000
  for (let i = 0; i < bytes.length; i += passo) {
    s += String.fromCharCode(...bytes.subarray(i, i + passo))
  }
  return s
}

/** Decodifica `#xx` dos nomes PDF. */
function nomePdf(bruto: string): string {
  return bruto.replace(/#([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
}

/** Início (`<<`) do dicionário que contém a posição `pos`. */
function inicioDoDicionario(texto: string, pos: number): number {
  let profundidade = 0
  for (let i = pos; i > 0; i--) {
    if (texto[i] === '>' && texto[i - 1] === '>') {
      profundidade++
      i--
    } else if (texto[i] === '<' && texto[i - 1] === '<') {
      if (profundidade === 0) return i - 1
      profundidade--
      i--
    }
  }
  return -1
}

/** Fim (logo depois do `>>`) do dicionário que começa em `inicio`. */
function fimDoDicionario(texto: string, inicio: number): number {
  let profundidade = 0
  for (let i = inicio; i < texto.length - 1; i++) {
    if (texto[i] === '<' && texto[i + 1] === '<') {
      profundidade++
      i++
    } else if (texto[i] === '>' && texto[i + 1] === '>') {
      profundidade--
      i++
      if (profundidade === 0) return i + 1
    }
  }
  return -1
}

function numero(dic: string, chave: string): number | null {
  const m = new RegExp(`/${chave}\\s*(-?\\d+(?:\\.\\d+)?|-?\\.\\d+)`).exec(dic)
  return m ? Number(m[1]) : null
}

/** Descritores de fonte num trecho de texto PDF (sem descompactar nada). */
export function descritoresNoTexto(texto: string, destino: MetricasFontes = new Map()): MetricasFontes {
  const re = /\/Type\s*\/FontDescriptor\b/g
  for (let m = re.exec(texto); m; m = re.exec(texto)) {
    const inicio = inicioDoDicionario(texto, m.index)
    if (inicio < 0) continue
    const fim = fimDoDicionario(texto, inicio)
    if (fim < 0) continue
    const dic = texto.slice(inicio, fim)
    const nome = /\/FontName\s*\/([^\s/<>[\]()]+)/.exec(dic)
    const ascent = numero(dic, 'Ascent')
    const descent = numero(dic, 'Descent')
    if (!nome || ascent === null || descent === null) continue
    const metrica = { ascent: ascent / 1000, descent: descent / 1000 }
    const completo = nomePdf(nome[1])
    destino.set(completo, metrica)
    const semSubconjunto = completo.replace(/^[A-Z]{6}\+/, '')
    if (!destino.has(semSubconjunto)) destino.set(semSubconjunto, metrica)
  }
  return destino
}

async function inflar(dados: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === 'undefined') return null
  try {
    const fluxo = new Blob([dados as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'))
    return new Uint8Array(await new Response(fluxo).arrayBuffer())
  } catch {
    return null
  }
}

/** Ascent/Descent de todas as fontes com FontDescriptor no PDF. */
export async function lerMetricasFontes(bytes: Uint8Array): Promise<MetricasFontes> {
  const texto = latin1(bytes)
  const metricas = descritoresNoTexto(texto)
  // Object streams: dicionários compactados (PDF 1.5+).
  const re = /\/Type\s*\/ObjStm\b/g
  for (let m = re.exec(texto); m; m = re.exec(texto)) {
    const inicio = inicioDoDicionario(texto, m.index)
    const fim = inicio < 0 ? -1 : fimDoDicionario(texto, inicio)
    if (fim < 0) continue
    const dic = texto.slice(inicio, fim)
    if (!/\/Filter\s*\/FlateDecode\b/.test(dic) && !/\/Filter\s*\[\s*\/FlateDecode\s*\]/.test(dic)) continue
    const abre = /^\s*stream\r?\n/.exec(texto.slice(fim, fim + 20))
    if (!abre) continue
    const comeco = fim + abre[0].length
    const comprimento = numero(dic, 'Length')
    const final = comprimento !== null && !/\/Length\s+\d+\s+\d+\s+R/.test(dic)
      ? comeco + comprimento
      : texto.indexOf('endstream', comeco)
    if (final <= comeco) continue
    const inflado = await inflar(bytes.subarray(comeco, final))
    if (inflado) descritoresNoTexto(latin1(inflado), metricas)
  }
  return metricas
}

/** Métrica pelo nome da fonte no pdf.js (com ou sem prefixo de subconjunto). */
export function metricaDaFonte(metricas: MetricasFontes, nome: string | undefined | null): MetricaFonte | null {
  if (!nome) return null
  return metricas.get(nome) ?? metricas.get(nome.replace(/^[A-Z]{6}\+/, '')) ?? null
}
