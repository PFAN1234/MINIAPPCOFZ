/**
 * Renderização das imagens de planta com o pdf.js (port do `gerar_plantas.py`): página
 * recortada, máscaras brancas, prova com os pinos e codificação WebP.
 *
 * O canvas vem de uma fábrica (no navegador, `document.createElement('canvas')`; nos testes,
 * `@napi-rs/canvas`). O pixel (0, 0) de cada imagem é o canto do pixmap do PyMuPDF
 * (`areaPixmap`), para as imagens ficarem alinhadas com as do Python.
 */
import type { PDFPageProxy } from 'pdfjs-dist'
import { mascarasNaImagem, pontoNaImagem, QUALIDADE_WEBP, type ImagemCalculada } from './plantas.ts'
import { ErroPlanta, type Retangulo } from './tipos.ts'

/** O mínimo de canvas que usamos (HTMLCanvasElement, OffscreenCanvas ou o do Node). */
export interface CanvasPlanta {
  width: number
  height: number
  getContext(tipo: '2d'): unknown
  toBlob?: (cb: (b: Blob | null) => void, tipo?: string, qualidade?: number) => void
  convertToBlob?: (opcoes?: { type?: string; quality?: number }) => Promise<Blob>
}

export type FabricaCanvas = (largura: number, altura: number) => CanvasPlanta

export const COR_PINO = 'rgb(220, 38, 38)'

type Contexto2D = CanvasRenderingContext2D

function contexto(canvas: CanvasPlanta): Contexto2D {
  const ctx = canvas.getContext('2d') as Contexto2D | null
  if (!ctx) throw new ErroPlanta('O navegador não conseguiu criar a imagem (canvas 2D indisponível).')
  return ctx
}

/** Renderiza o recorte `img` da página em `img.escala`, com fundo branco e as máscaras. */
export async function renderizarRecorte(
  pagina: PDFPageProxy,
  img: ImagemCalculada,
  mascaras: Retangulo[],
  paginaPt: { largura: number; altura: number },
  criarCanvas: FabricaCanvas,
): Promise<CanvasPlanta> {
  const canvas = criarCanvas(img.largura, img.altura)
  const ctx = contexto(canvas)
  const viewport = pagina.getViewport({ scale: img.escala, offsetX: -img.origem[0], offsetY: -img.origem[1] })
  await pagina.render({ canvas: null, canvasContext: ctx, viewport, background: 'rgb(255,255,255)' }).promise
  ctx.fillStyle = '#ffffff'
  // Mesma conta do Python (origem no recorte em pontos × escala), em pixels inteiros.
  for (const [x0, y0, x1, y1] of mascarasNaImagem(mascaras, paginaPt, img)) {
    const a = Math.round(x0)
    const b = Math.round(y0)
    ctx.fillRect(a, b, Math.round(x1) - a + 1, Math.round(y1) - b + 1)
  }
  return canvas
}

/** Pino em gota com a ponta logo acima do nome (mesmo desenho do Python). */
export function desenharPino(ctx: Contexto2D, cx: number, topoNome: number, raio: number): void {
  const ponta = topoNome - raio * 0.35
  const cy = ponta - raio * 2.0
  ctx.fillStyle = COR_PINO
  ctx.beginPath()
  ctx.moveTo(cx - raio * 0.75, cy + raio * 0.6)
  ctx.lineTo(cx + raio * 0.75, cy + raio * 0.6)
  ctx.lineTo(cx, ponta)
  ctx.closePath()
  ctx.fill()
  const borda = Math.max(2, Math.trunc(raio / 4))
  ctx.beginPath()
  ctx.arc(cx, cy, raio, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = borda
  ctx.beginPath()
  ctx.arc(cx, cy, Math.max(0, raio - borda / 2), 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(cx, cy, raio * 0.38, 0, Math.PI * 2)
  ctx.fill()
}

/** Prova: cópia da visão geral com todos os pinos (raio de 4 pt na escala da imagem). */
export function desenharProva(
  base: CanvasPlanta,
  img: ImagemCalculada,
  paginaPt: { largura: number; altura: number },
  pinos: { x: number; y: number }[],
  criarCanvas: FabricaCanvas,
): CanvasPlanta {
  const prova = criarCanvas(base.width, base.height)
  const ctx = contexto(prova)
  ctx.drawImage(base as unknown as CanvasImageSource, 0, 0)
  const raio = 4.0 * img.escala
  for (const p of pinos) {
    const [cx, topo] = pontoNaImagem(p.x, p.y, paginaPt, img)
    desenharPino(ctx, cx, topo, raio)
  }
  return prova
}

/** Bytes de um WebP de verdade ("RIFF....WEBP")? */
export function ehWebp(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false
  const txt = (i: number, n: number) => String.fromCharCode(...bytes.subarray(i, i + n))
  return txt(0, 4) === 'RIFF' && txt(8, 4) === 'WEBP'
}

async function blobDoCanvas(canvas: CanvasPlanta, tipo: string, qualidade?: number): Promise<Blob | null> {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type: tipo, quality: qualidade })
  if (canvas.toBlob) return new Promise((r) => canvas.toBlob!((b) => r(b), tipo, qualidade))
  return null
}

/** Encoder WASM (Safari não gera WebP pelo canvas). Carregado só quando preciso. */
async function webpWasm(canvas: CanvasPlanta): Promise<Blob> {
  const ctx = contexto(canvas)
  const dados = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const { default: encode } = await import('@jsquash/webp/encode')
  const buffer = await encode(dados, { quality: QUALIDADE_WEBP, method: 4 })
  return new Blob([buffer], { type: 'image/webp' })
}

/** WebP pelo canvas quando o navegador gera WebP; senão pelo encoder WASM. */
export async function codificarWebp(canvas: CanvasPlanta): Promise<Blob> {
  const nativo = await blobDoCanvas(canvas, 'image/webp', QUALIDADE_WEBP / 100).catch(() => null)
  if (nativo && nativo.type === 'image/webp' && ehWebp(new Uint8Array(await nativo.slice(0, 12).arrayBuffer()))) {
    return nativo
  }
  const wasm = await webpWasm(canvas)
  if (!ehWebp(new Uint8Array(await wasm.slice(0, 12).arrayBuffer()))) {
    throw new ErroPlanta('Não foi possível gerar a imagem WebP neste navegador.')
  }
  return wasm
}

export async function codificarPng(canvas: CanvasPlanta): Promise<Blob> {
  const b = await blobDoCanvas(canvas, 'image/png')
  if (!b) throw new ErroPlanta('Não foi possível gerar a imagem de prova.')
  return b
}
