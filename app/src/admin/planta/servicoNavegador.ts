/** `ServicoPdf` do navegador: pdf.js (worker local) + canvas do DOM. */
import { OPCOES_PDFJS, pdfjs } from './carregarPdfJs.ts'
import { abrirPdf, lerPagina, type ModuloPdfJs } from './pdf.ts'
import { codificarPng, codificarWebp, desenharProva, renderizarRecorte, type CanvasPlanta } from './render.ts'
import type { DocumentoPdf, ImagemGerada, PaginaAberta, ServicoPdf } from './servico.ts'

function criarCanvas(largura: number, altura: number): CanvasPlanta {
  const c = document.createElement('canvas')
  c.width = largura
  c.height = altura
  return c as unknown as CanvasPlanta
}

async function paraUrl(canvas: CanvasPlanta): Promise<ImagemGerada> {
  const blob = await codificarPng(canvas)
  return { url: URL.createObjectURL(blob), largura: canvas.width, altura: canvas.height }
}

export const servicoNavegador: ServicoPdf = {
  async abrir(bytes): Promise<DocumentoPdf> {
    const pdf = await abrirPdf(pdfjs as unknown as ModuloPdfJs, bytes, OPCOES_PDFJS)
    return {
      paginas: pdf.paginas,
      async pagina(numero): Promise<PaginaAberta> {
        const p = await lerPagina(pdf, numero)
        const paginaPt = { largura: p.largura, altura: p.altura }
        return {
          numero,
          largura: p.largura,
          altura: p.altura,
          spans: p.spans,
          async previa(larguraPx) {
            const escala = larguraPx / p.largura
            const largura = Math.round(p.largura * escala)
            const altura = Math.round(p.altura * escala)
            const canvas = criarCanvas(largura, altura)
            const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
            await p.pagina.render({ canvas: null, canvasContext: ctx, viewport: p.pagina.getViewport({ scale: escala }) })
              .promise
            return paraUrl(canvas)
          },
          async recorte(img, mascaras) {
            return paraUrl(await renderizarRecorte(p.pagina, img, mascaras, paginaPt, criarCanvas))
          },
          async webp(img, mascaras) {
            return codificarWebp(await renderizarRecorte(p.pagina, img, mascaras, paginaPt, criarCanvas))
          },
          async prova(img, mascaras, pinos) {
            const base = await renderizarRecorte(p.pagina, img, mascaras, paginaPt, criarCanvas)
            const prova = desenharProva(base, img, paginaPt, pinos, criarCanvas)
            const blob = await codificarPng(prova)
            return { url: URL.createObjectURL(blob), largura: prova.width, altura: prova.height, blob }
          },
        }
      },
      fechar: () => pdf.doc.loadingTask.destroy(),
    }
  },
}
