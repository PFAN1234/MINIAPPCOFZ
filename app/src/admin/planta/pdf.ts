/**
 * Leitura do PDF com o pdf.js: texto com posição (spans iguais aos do PyMuPDF) e tamanho da
 * página. O módulo do pdf.js é recebido de fora: no navegador, o build normal com o worker
 * servido pelo Vite (`carregarPdfJs.ts`); nos testes (Node), o build `legacy`.
 */
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import { lerMetricasFontes, metricaDaFonte, type MetricaFonte, type MetricasFontes } from './metricasFonte.ts'
import { montarSpans, type ItemPdf } from './spans.ts'
import { ErroPlanta, type PaginaLida } from './tipos.ts'

/** O que usamos do módulo `pdfjs-dist` (o normal e o legacy têm a mesma interface). */
export interface ModuloPdfJs {
  getDocument: (src: Record<string, unknown>) => { promise: Promise<PDFDocumentProxy>; destroy?: () => Promise<void> }
}

export interface PdfAberto {
  doc: PDFDocumentProxy
  /** Cópia dos bytes (o pdf.js transfere o buffer que recebe para o worker). */
  bytes: Uint8Array
  metricas: MetricasFontes
  paginas: number
}

/**
 * Abre o PDF. `opcoes` vai direto para o `getDocument` (ex.: `BinaryDataFactory`). As
 * fontes são carregadas com `fontExtraProperties` para o nome do PDF chegar ao cliente.
 */
export async function abrirPdf(
  pdfjs: ModuloPdfJs,
  bytes: Uint8Array,
  opcoes: Record<string, unknown> = {},
): Promise<PdfAberto> {
  const copia = bytes.slice()
  let doc: PDFDocumentProxy
  try {
    doc = await pdfjs.getDocument({
      data: bytes.slice(),
      fontExtraProperties: true,
      isEvalSupported: false,
      verbosity: 0,
      ...opcoes,
    }).promise
  } catch (e) {
    const nome = (e as { name?: string } | null)?.name
    if (nome === 'PasswordException') throw new ErroPlanta('O PDF está protegido por senha.')
    throw new ErroPlanta('Não foi possível ler o PDF: o arquivo parece inválido ou corrompido.')
  }
  return { doc, bytes: copia, metricas: await lerMetricasFontes(copia), paginas: doc.numPages }
}

export interface PaginaPdf extends PaginaLida {
  pagina: PDFPageProxy
}

interface FonteCarregada {
  name?: string
  ascent?: number
  descent?: number
}

/** Lê a página `numero` (1 = primeira): tamanho em pontos e spans de texto. */
export async function lerPagina(pdf: PdfAberto, numero: number): Promise<PaginaPdf> {
  if (!Number.isInteger(numero) || numero < 1 || numero > pdf.paginas) {
    throw new ErroPlanta(`O PDF tem ${pdf.paginas} página(s); a página ${numero} não existe.`)
  }
  const pagina = await pdf.doc.getPage(numero)
  const viewport = pagina.getViewport({ scale: 1 })
  // A lista de operações carrega as fontes em `commonObjs`, com o nome do PDF.
  await pagina.getOperatorList()
  const conteudo = await pagina.getTextContent({ disableNormalization: true })
  const estilos = conteudo.styles as Record<string, { ascent?: number; descent?: number }>
  const cache = new Map<string, MetricaFonte>()
  function metrica(fontName: string): MetricaFonte {
    const pronta = cache.get(fontName)
    if (pronta) return pronta
    let fonte: FonteCarregada | null
    try {
      fonte = pagina.commonObjs.has(fontName) ? (pagina.commonObjs.get(fontName) as FonteCarregada) : null
    } catch {
      fonte = null
    }
    const doDescritor = metricaDaFonte(pdf.metricas, fonte?.name)
    const estilo = estilos[fontName]
    // Sem FontDescriptor (ou Ascent 0): o MuPDF usa a métrica da própria fonte, como o pdf.js.
    const m =
      doDescritor && doDescritor.ascent !== 0
        ? doDescritor
        : { ascent: estilo?.ascent ?? fonte?.ascent ?? 0.8, descent: estilo?.descent ?? fonte?.descent ?? -0.2 }
    cache.set(fontName, m)
    return m
  }
  const itens = conteudo.items.filter((i): i is ItemPdf & typeof i => 'str' in i) as ItemPdf[]
  const spans = montarSpans(itens, {
    transformViewport: viewport.transform,
    largura: viewport.width,
    altura: viewport.height,
    metrica,
  })
  // O MuPDF guarda o tamanho da página em float32 (2908,320068… em vez de 2908,32).
  return { pagina, largura: Math.fround(viewport.width), altura: Math.fround(viewport.height), spans }
}
