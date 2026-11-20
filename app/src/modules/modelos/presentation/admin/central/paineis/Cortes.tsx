import type { Corte } from '../../../../domain/central.ts'

interface Props {
  cortes: Corte[]
  /** Corte marcado na lista (Del apaga). */
  selecionado: string | null
  onSelecionar(id: string): void
  onApagar(id: string): void
  onApagarTodos(): void
}

const fmt = (n: number) => n.toFixed(2).replace('.', ',')

/** Lista de planos de corte da sessão (não persistem), com Apagar, Apagar todos e atalho Del. */
export default function Cortes({ cortes, selecionado, onSelecionar, onApagar, onApagarTodos }: Props) {
  if (cortes.length === 0) return null
  return (
    <section className="central-cortes" aria-label="Cortes">
      <h4>Cortes ({cortes.length})</h4>
      <ul aria-label="Lista de cortes">
        {cortes.map((c, i) => (
          <li key={c.id}>
            <button
              type="button"
              className="central-botao"
              aria-label={`Corte ${i + 1}`}
              aria-pressed={selecionado === c.id}
              title={`Origem (${c.origem.map(fmt).join('; ')}). Del apaga o corte marcado`}
              onClick={() => onSelecionar(c.id)}
            >
              Corte {i + 1}
            </button>
            <button type="button" className="central-botao" aria-label={`Apagar corte ${i + 1}`} onClick={() => onApagar(c.id)}>
              Apagar
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="central-botao" aria-label="Apagar todos os cortes" onClick={onApagarTodos}>
        Apagar todos
      </button>
    </section>
  )
}
