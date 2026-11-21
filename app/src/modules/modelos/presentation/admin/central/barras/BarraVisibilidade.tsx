import { IconeCaminhar, IconeFantasma, IconeIsolar, IconeLimpar, IconeOcultar, IconeOlho } from '../icones.tsx'

interface Props {
  /** Quantos elementos estão selecionados. */
  selecionados: number
  /** Motor pronto (habilita Mostrar tudo). */
  ativo: boolean
  isolado: boolean
  fantasma: boolean
  caminhando: boolean
  onOcultar(): void
  onIsolar(): void
  onFantasma(): void
  onCaminhar(): void
  onMostrarTudo(): void
  onLimpar(): void
}

/** Barra de visibilidade na base do canvas: ocultar (H), isolar (I), fantasma, mostrar tudo e limpar seleção (Esc). */
export default function BarraVisibilidade({
  selecionados,
  ativo,
  isolado,
  fantasma,
  caminhando,
  onOcultar,
  onIsolar,
  onFantasma,
  onCaminhar,
  onMostrarTudo,
  onLimpar,
}: Props) {
  const semSelecao = selecionados === 0
  return (
    <div className="central-barra central-barra-visibilidade" role="toolbar" aria-label="Visibilidade">
      <span className="central-sec central-contador" role="status" aria-label="Selecionado">
        Selecionado ({selecionados})
      </span>
      <button
        type="button"
        className="central-botao central-botao-icone"
        aria-label="Ocultar"
        data-dica-lado="cima"
        data-dica="Ocultar a seleção (H)"
        disabled={!ativo || semSelecao}
        onClick={onOcultar}
      >
        <IconeOcultar />
      </button>
      <button
        type="button"
        className="central-botao central-botao-icone"
        aria-label="Isolar"
        data-dica-lado="cima"
        data-dica="Isolar a seleção (I)"
        aria-pressed={isolado}
        disabled={!ativo || (semSelecao && !isolado)}
        onClick={onIsolar}
      >
        <IconeIsolar />
      </button>
      <button
        type="button"
        className="central-botao central-botao-icone"
        aria-label="Fantasma"
        data-dica-lado="cima"
        data-dica="Demais itens translúcidos"
        aria-pressed={fantasma}
        disabled={!ativo || (semSelecao && !fantasma)}
        onClick={onFantasma}
      >
        <IconeFantasma />
      </button>
      <button
        type="button"
        className="central-botao central-botao-icone"
        aria-label="Caminhar"
        data-dica-lado="cima"
        data-dica="Caminhar pelo modelo (primeira pessoa, em perspectiva)"
        aria-pressed={caminhando}
        disabled={!ativo}
        onClick={onCaminhar}
      >
        <IconeCaminhar />
      </button>
      <button
        type="button"
        className="central-botao central-botao-icone"
        aria-label="Mostrar tudo"
        data-dica-lado="cima"
        data-dica="Mostrar tudo"
        disabled={!ativo}
        onClick={onMostrarTudo}
      >
        <IconeOlho />
      </button>
      <button
        type="button"
        className="central-botao central-botao-icone"
        aria-label="Limpar seleção"
        data-dica-lado="cima"
        data-dica="Limpar seleção (Esc)"
        disabled={!ativo || semSelecao}
        onClick={onLimpar}
      >
        <IconeLimpar />
      </button>
    </div>
  )
}
