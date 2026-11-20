import { useCallback, useEffect, useRef, useState, type TouchEvent } from 'react'

export interface FotoVisualizada {
  id: string
  url: string | undefined
  largura: number
  altura: number
}

/**
 * Visualizador de fotos em tela cheia (diálogo modal): anterior/próxima,
 * deslizar, Esc e botão fechar. O foco vai para "Fechar" ao abrir e volta ao
 * elemento anterior ao fechar.
 */
export function VisualizadorFotos({
  fotos,
  indiceInicial,
  rotulo,
  onFechar,
}: {
  fotos: FotoVisualizada[]
  indiceInicial: number
  rotulo: string
  onFechar: () => void
}) {
  const [indice, setIndice] = useState(indiceInicial)
  const fechar = useRef<HTMLButtonElement>(null)
  const toqueX = useRef<number | null>(null)
  const total = fotos.length

  const ir = useCallback(
    (delta: number) => setIndice((i) => Math.min(total - 1, Math.max(0, i + delta))),
    [total],
  )

  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null
    fechar.current?.focus()
    return () => anterior?.focus?.()
  }, [])

  useEffect(() => {
    function tecla(e: KeyboardEvent) {
      if (e.key === 'Escape') onFechar()
      else if (e.key === 'ArrowLeft') ir(-1)
      else if (e.key === 'ArrowRight') ir(1)
    }
    document.addEventListener('keydown', tecla)
    return () => document.removeEventListener('keydown', tecla)
  }, [onFechar, ir])

  function inicioToque(e: TouchEvent) {
    toqueX.current = e.touches[0]?.clientX ?? null
  }
  function fimToque(e: TouchEvent) {
    const inicio = toqueX.current
    toqueX.current = null
    const fim = e.changedTouches[0]?.clientX
    if (inicio === null || fim === undefined) return
    const dx = fim - inicio
    if (Math.abs(dx) > 50) ir(dx < 0 ? 1 : -1)
  }

  const foto = fotos[indice]
  if (!foto) return null

  return (
    <div className="visualizador" role="dialog" aria-modal="true" aria-label={rotulo}>
      <div className="visualizador-topo">
        <span className="visualizador-contagem" aria-live="polite">
          Foto {indice + 1} de {total}
        </span>
        <button
          ref={fechar}
          type="button"
          className="visualizador-botao"
          aria-label="Fechar"
          onClick={onFechar}
        >
          ×
        </button>
      </div>
      <div className="visualizador-palco" onTouchStart={inicioToque} onTouchEnd={fimToque}>
        {foto.url ? (
          <img
            className="visualizador-img"
            src={foto.url}
            width={foto.largura}
            height={foto.altura}
            alt={`${rotulo}, foto ${indice + 1} de ${total}`}
            draggable={false}
          />
        ) : (
          <p className="visualizador-carregando" role="status">
            Carregando…
          </p>
        )}
      </div>
      {total > 1 && (
        <div className="visualizador-base">
          <button
            type="button"
            className="visualizador-botao"
            aria-label="Foto anterior"
            disabled={indice === 0}
            onClick={() => ir(-1)}
          >
            ‹
          </button>
          <button
            type="button"
            className="visualizador-botao"
            aria-label="Próxima foto"
            disabled={indice === total - 1}
            onClick={() => ir(1)}
          >
            ›
          </button>
        </div>
      )}
    </div>
  )
}
