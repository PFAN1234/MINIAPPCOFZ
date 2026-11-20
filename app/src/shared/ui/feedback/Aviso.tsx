import { useEffect } from 'react'

/** Aviso passageiro (toast) que se fecha sozinho. Fica numa região `status` para leitores de tela. */
export function Aviso({
  texto,
  onFechar,
  duracaoMs = 4000,
}: {
  texto: string
  onFechar: () => void
  duracaoMs?: number
}) {
  useEffect(() => {
    const t = window.setTimeout(onFechar, duracaoMs)
    return () => window.clearTimeout(t)
  }, [onFechar, duracaoMs])

  return (
    <div className="aviso" role="status" aria-live="polite">
      <span>{texto}</span>
      <button type="button" className="aviso-fechar" aria-label="Fechar aviso" onClick={onFechar}>
        ×
      </button>
    </div>
  )
}
