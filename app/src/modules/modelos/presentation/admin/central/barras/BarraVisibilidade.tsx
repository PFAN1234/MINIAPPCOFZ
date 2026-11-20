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
        className="central-botao central-botao-texto"
        aria-label="Ocultar"
        title="Ocultar a seleção (H)"
        disabled={!ativo || semSelecao}
        onClick={onOcultar}
      >
        <IconeOcultar />
        Ocultar
      </button>
      <button
        type="button"
        className="central-botao central-botao-texto"
        aria-label="Isolar"
        title="Isolar a seleção (I)"
        aria-pressed={isolado}
        disabled={!ativo || (semSelecao && !isolado)}
        onClick={onIsolar}
      >
        <IconeIsolar />
        Isolar
      </button>
      <button
        type="button"
        className="central-botao central-botao-texto"
        aria-label="Fantasma"
        title="Demais itens translúcidos"
        aria-pressed={fantasma}
        disabled={!ativo || (semSelecao && !fantasma)}
        onClick={onFantasma}
      >
        <IconeFantasma />
        Fantasma
      </button>
      <button
        type="button"
        className="central-botao central-botao-texto"
        aria-label="Caminhar"
        title="Caminhar pelo modelo (primeira pessoa, em perspectiva)"
        aria-pressed={caminhando}
        disabled={!ativo}
        onClick={onCaminhar}
      >
        <IconeCaminhar />
        Caminhar
      </button>
      <button
        type="button"
        className="central-botao central-botao-texto"
        aria-label="Mostrar tudo"
        disabled={!ativo}
        onClick={onMostrarTudo}
      >
        <IconeOlho />
        Mostrar tudo
      </button>
      <button
        type="button"
        className="central-botao central-botao-texto"
        aria-label="Limpar seleção"
        title="Limpar seleção (Esc)"
        disabled={!ativo || semSelecao}
        onClick={onLimpar}
      >
        <IconeLimpar />
        Limpar seleção
      </button>
    </div>
  )
}
