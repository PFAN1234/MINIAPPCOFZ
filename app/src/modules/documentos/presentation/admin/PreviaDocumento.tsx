/**
 * Prévia de um documento sobre a área do visualizador 3D (o motor continua montado por baixo).
 * PDF: uma página por vez num canvas (pdf.js), ajustada à largura ao abrir, com paginação e zoom.
 * Outros formatos não têm prévia: mostra os metadados e o botão Baixar.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { mensagemDe } from '../../../../admin/componentes.tsx'
import { useRepositorioAdmin } from '../../../../admin/dados/contexto.tsx'
import type { PdfPrevia } from '../../application/ports/PreviaPdf.port.ts'
import { temPrevia, type Documento } from '../../domain/documentos.ts'
import { usePreviaPdf } from './previaPdf.tsx'
import { salvarBlob } from './salvarBlob.ts'

interface Props {
  doc: Documento
  aoFechar(): void
}

const ZOOM_MIN = 0.25
const ZOOM_MAX = 5
const PASSO = 0.25
const MARGEM = 32

const limitar = (n: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n))

export default function PreviaDocumento({ doc, aoFechar }: Props) {
  const repo = useRepositorioAdmin()
  const carregarPrevia = usePreviaPdf()
  const [pdf, setPdf] = useState<PdfPrevia | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [pagina, setPagina] = useState(1)
  const [escala, setEscala] = useState(1)
  const canvas = useRef<HTMLCanvasElement>(null)
  const area = useRef<HTMLDivElement>(null)
  const pdf_ = temPrevia(doc)

  // Escala que ocupa a largura da área de rolagem (sem área medida, 100%).
  const ajuste = useCallback((larguraPagina: number): number => {
    const disponivel = (area.current?.clientWidth ?? 0) - MARGEM
    return disponivel > 0 && larguraPagina > 0 ? limitar(disponivel / larguraPagina) : 1
  }, [])

  // Abre o PDF; ao sair (ou trocar de documento), fecha.
  useEffect(() => {
    if (!pdf_) return
    let ativo = true
    let aberto: PdfPrevia | null = null
    void (async () => {
      try {
        const blob = await repo.baixarDocumento(doc.caminho)
        const bytes = new Uint8Array(await blob.arrayBuffer())
        const previa = await (await carregarPrevia()).abrirPdf(bytes)
        if (!ativo) {
          previa.fechar()
          return
        }
        aberto = previa
        const { largura } = await previa.tamanho(1)
        if (!ativo) return
        setEscala(ajuste(largura))
        setPdf(previa)
      } catch (e) {
        if (ativo) setErro(mensagemDe(e, 'Não foi possível abrir o PDF.'))
      }
    })()
    return () => {
      ativo = false
      aberto?.fechar()
    }
  }, [doc.caminho, pdf_, repo, carregarPrevia, ajuste])

  useEffect(() => {
    if (!pdf || !canvas.current) return
    let ativo = true
    pdf.desenhar(pagina, escala, canvas.current).catch((e) => ativo && setErro(mensagemDe(e, 'Falha ao desenhar a página.')))
    return () => {
      ativo = false
    }
  }, [pdf, pagina, escala])

  const total = pdf?.paginas ?? 0
  const irPara = useCallback((n: number) => setPagina(Math.min(Math.max(1, n), Math.max(1, total))), [total])

  async function ajustarALargura() {
    if (!pdf) return
    const { largura } = await pdf.tamanho(pagina)
    setEscala(ajuste(largura))
  }

  async function baixar() {
    try {
      salvarBlob(await repo.baixarDocumento(doc.caminho), doc.arquivoNome)
    } catch (e) {
      setErro(mensagemDe(e))
    }
  }

  useEffect(() => {
    function tecla(e: KeyboardEvent) {
      const alvo = e.target as HTMLElement | null
      if (alvo && (alvo.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(alvo.tagName))) return
      if (e.key === 'Escape') aoFechar()
      else if (e.key === 'PageDown') irPara(pagina + 1)
      else if (e.key === 'PageUp') irPara(pagina - 1)
      else if (e.key === '+' || e.key === '=') setEscala((s) => limitar(s + PASSO))
      else if (e.key === '-') setEscala((s) => limitar(s - PASSO))
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [aoFechar, irPara, pagina])

  return (
    <div className="central-previa" role="dialog" aria-label={doc.titulo}>
      <header className="central-previa-barra">
        <strong className="central-previa-titulo">{doc.titulo}</strong>
        <span className="central-sec">{doc.revisao}</span>
        {pdf && (
          <>
            <span className="central-gestao-acoes" role="group" aria-label="Páginas">
              <button
                type="button"
                className="central-botao central-botao-icone"
                aria-label="Página anterior"
                data-dica="Página anterior"
                disabled={pagina <= 1}
                onClick={() => irPara(pagina - 1)}
              >
                ‹
              </button>
              <span role="status" aria-live="polite">
                {pagina} / {total}
              </span>
              <button
                type="button"
                className="central-botao central-botao-icone"
                aria-label="Próxima página"
                data-dica="Próxima página"
                disabled={pagina >= total}
                onClick={() => irPara(pagina + 1)}
              >
                ›
              </button>
            </span>
            <span className="central-gestao-acoes" role="group" aria-label="Zoom">
              <button
                type="button"
                className="central-botao central-botao-icone"
                aria-label="Diminuir zoom"
                data-dica="Diminuir zoom"
                disabled={escala <= ZOOM_MIN}
                onClick={() => setEscala((s) => limitar(s - PASSO))}
              >
                −
              </button>
              <span>{Math.round(escala * 100)}%</span>
              <button
                type="button"
                className="central-botao central-botao-icone"
                aria-label="Aumentar zoom"
                data-dica="Aumentar zoom"
                disabled={escala >= ZOOM_MAX}
                onClick={() => setEscala((s) => limitar(s + PASSO))}
              >
                +
              </button>
              <button type="button" className="central-botao" onClick={() => void ajustarALargura()}>
                Ajustar à largura
              </button>
            </span>
          </>
        )}
        <button type="button" className="central-botao" onClick={() => void baixar()}>
          Baixar
        </button>
        <button type="button" className="central-botao" onClick={aoFechar}>
          Fechar
        </button>
      </header>
      <div className="central-previa-area" ref={area}>
        {!pdf_ ? (
          <div className="central-previa-meta">
            <p className="central-sec">Este formato não tem prévia no navegador. Baixe o arquivo para abrir.</p>
            <dl>
            <div>
              <dt>Arquivo</dt>
              <dd>{doc.arquivoNome}</dd>
            </div>
            <div>
              <dt>Tipo</dt>
              <dd>{doc.mime}</dd>
            </div>
            <div>
              <dt>Código</dt>
              <dd>{doc.codigo ?? '—'}</dd>
            </div>
            </dl>
          </div>
        ) : erro ? (
          <p className="central-gestao-alerta" role="alert">
            {erro}
          </p>
        ) : !pdf ? (
          <p className="central-sec" role="status">
            Carregando o documento…
          </p>
        ) : (
          <canvas ref={canvas} className="central-previa-canvas" aria-label={`Página ${pagina} de ${total}`} />
        )}
      </div>
    </div>
  )
}
