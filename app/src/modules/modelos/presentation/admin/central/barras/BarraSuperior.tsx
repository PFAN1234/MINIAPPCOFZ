/** Botões ainda desabilitados (ganham função nas próximas etapas). */
const BOTOES_FUTUROS = ['Cor', 'Modelos', 'Issues', 'Medir', 'Cortar', 'Captura', 'Obra']

interface Props {
  /** Habilita Enquadrar e Projeção (motor pronto). */
  ativo: boolean
  ortografica: boolean
  onEnquadrar(): void
  onProjecao(): void
}

/** Barra superior do visualizador: enquadrar (F) e projeção já funcionam. */
export default function BarraSuperior({ ativo, ortografica, onEnquadrar, onProjecao }: Props) {
  return (
    <div className="central-barra central-barra-superior" role="toolbar" aria-label="Ferramentas do visualizador">
      <button
        type="button"
        className="central-botao"
        aria-label="Enquadrar"
        title="Enquadrar (F)"
        disabled={!ativo}
        onClick={onEnquadrar}
      >
        Enquadrar
      </button>
      <button
        type="button"
        className="central-botao"
        aria-label="Projeção"
        title={ortografica ? 'Projeção ortográfica' : 'Projeção em perspectiva'}
        aria-pressed={ortografica}
        disabled={!ativo}
        onClick={onProjecao}
      >
        Projeção
      </button>
      {BOTOES_FUTUROS.map((nome) => (
        <button key={nome} type="button" className="central-botao" aria-label={nome} aria-pressed="false" disabled>
          {nome}
        </button>
      ))}
    </div>
  )
}
