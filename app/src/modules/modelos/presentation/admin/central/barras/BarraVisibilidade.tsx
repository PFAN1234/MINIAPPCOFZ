interface Props {
  /** Quantos elementos estão selecionados. */
  selecionados: number
  /** Motor pronto (habilita Mostrar tudo). */
  ativo: boolean
  isolado: boolean
  fantasma: boolean
  onOcultar(): void
  onIsolar(): void
  onFantasma(): void
  onMostrarTudo(): void
  onLimpar(): void
}

/** Barra de visibilidade na base do canvas: ocultar (H), isolar (I), fantasma, mostrar tudo e limpar seleção (Esc). */
export default function BarraVisibilidade({
  selecionados,
  ativo,
  isolado,
  fantasma,
  onOcultar,
  onIsolar,
  onFantasma,
  onMostrarTudo,
  onLimpar,
}: Props) {
  const semSelecao = selecionados === 0
  return (
    <div className="central-barra central-barra-visibilidade" role="toolbar" aria-label="Visibilidade">
      <span className="central-sec" role="status" aria-label="Selecionado">
        Selecionado ({selecionados})
      </span>
      <button
        type="button"
        className="central-botao"
        aria-label="Ocultar"
        title="Ocultar a seleção (H)"
        disabled={!ativo || semSelecao}
        onClick={onOcultar}
      >
        Ocultar
      </button>
      <button
        type="button"
        className="central-botao"
        aria-label="Isolar"
        title="Isolar a seleção (I)"
        aria-pressed={isolado}
        disabled={!ativo || (semSelecao && !isolado)}
        onClick={onIsolar}
      >
        Isolar
      </button>
      <button
        type="button"
        className="central-botao"
        aria-label="Fantasma"
        title="Demais itens translúcidos"
        aria-pressed={fantasma}
        disabled={!ativo || (semSelecao && !fantasma)}
        onClick={onFantasma}
      >
        Fantasma
      </button>
      <button type="button" className="central-botao" aria-label="Mostrar tudo" disabled={!ativo} onClick={onMostrarTudo}>
        Mostrar tudo
      </button>
      <button
        type="button"
        className="central-botao"
        aria-label="Limpar seleção"
        title="Limpar seleção (Esc)"
        disabled={!ativo || semSelecao}
        onClick={onLimpar}
      >
        Limpar seleção
      </button>
    </div>
  )
}
