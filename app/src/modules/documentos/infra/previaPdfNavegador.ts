/** `PreviaPdf` do navegador: pdf.js com worker local, desenhando no canvas na resolução física. */
import type { PdfPrevia, PreviaPdf } from '../application/ports/PreviaPdf.port.ts'
import { OPCOES_PDFJS, pdfjs } from '@modules/plantas/infra/pdf/carregarPdfJs.ts'

export const previaPdfNavegador: PreviaPdf = {
  async abrirPdf(bytes): Promise<PdfPrevia> {
    // O pdf.js toma posse do buffer: passa uma cópia.
    const tarefa = pdfjs.getDocument({ ...OPCOES_PDFJS, data: bytes.slice() })
    const doc = await tarefa.promise
    const emCurso = new WeakMap<HTMLCanvasElement, { cancel(): void }>()
    return {
      paginas: doc.numPages,
      async tamanho(pagina) {
        const v = (await doc.getPage(pagina)).getViewport({ scale: 1 })
        return { largura: v.width, altura: v.height }
      },
      async desenhar(pagina, escala, canvas) {
        emCurso.get(canvas)?.cancel()
        const p = await doc.getPage(pagina)
        const dpr = window.devicePixelRatio || 1
        const viewport = p.getViewport({ scale: escala * dpr })
        canvas.width = Math.round(viewport.width)
        canvas.height = Math.round(viewport.height)
        canvas.style.width = `${Math.round(viewport.width / dpr)}px`
        canvas.style.height = `${Math.round(viewport.height / dpr)}px`
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
        const render = p.render({ canvas, canvasContext: ctx, viewport })
        emCurso.set(canvas, render)
        try {
          await render.promise
        } catch (e) {
          // Cancelado por um desenho mais novo: não é erro.
          if ((e as Error)?.name === 'RenderingCancelledException') return
          throw e
        }
      },
      fechar: () => void tarefa.destroy(),
    }
  },
}
