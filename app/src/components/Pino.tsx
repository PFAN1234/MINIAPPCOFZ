import type { KeyboardEvent, PointerEvent } from 'react'

interface Props {
  nome: string
  /** Posição da ponta, em pixels da imagem (sistema do SVG). */
  x: number
  y: number
  pendencias?: number
  onAtivar?: (evento: { clientX: number; clientY: number } | null) => void
  onPonteiroBaixo?: (e: PointerEvent<SVGGElement>) => void
  /** Sem interação (cartão "Onde fica"). */
  decorativo?: boolean
}

/**
 * Pino com a ponta em (0, 0) do próprio sistema; a escala vem da variável CSS
 * `--inv` (inverso do zoom), para ter tamanho constante na tela.
 */
export function Pino({ nome, x, y, pendencias = 0, onAtivar, onPonteiroBaixo, decorativo }: Props) {
  const estilo = { transform: `translate(${x}px, ${y}px) scale(var(--inv, 1))` }
  const corpo = (
    <>
      {!decorativo && <rect className="pino-area" x={-22} y={-44} width={44} height={44} />}
      <path className="pino-forma" d="M0,0 L-8,-14 A11,11 0 1 1 8,-14 Z" />
      <circle className="pino-furo" cx={0} cy={-19} r={4} />
      {pendencias > 0 && (
        <g className="pino-selo" data-testid="pino-selo">
          <circle cx={13} cy={-32} r={9} />
          <text x={13} y={-32} textAnchor="middle" dominantBaseline="central">
            {pendencias}
          </text>
        </g>
      )}
    </>
  )
  if (decorativo) {
    return (
      <g className="pino" style={estilo} aria-hidden="true" data-x={x} data-y={y}>
        {corpo}
      </g>
    )
  }
  const aoTeclar = (e: KeyboardEvent<SVGGElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onAtivar?.(null)
    }
  }
  return (
    <g
      className="pino"
      style={estilo}
      role="button"
      tabIndex={0}
      aria-label={nome}
      data-x={x}
      data-y={y}
      onPointerDown={onPonteiroBaixo}
      onClick={(e) => onAtivar?.({ clientX: e.clientX, clientY: e.clientY })}
      onKeyDown={aoTeclar}
    >
      {corpo}
    </g>
  )
}
