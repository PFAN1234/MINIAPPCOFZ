import { NOMES_MEDIDA, formatarMedida, type Medida, type TipoMedida } from '../../../../domain/central.ts'

const DICAS: Record<TipoMedida, string> = {
  distancia: 'Clique em dois pontos.',
  area: 'Clique nos vértices; duplo clique ou Enter conclui.',
  volume: 'Clique nos elementos; duplo clique ou Enter conclui.',
  angulo: 'Clique em três pontos: início, vértice e fim.',
}

interface Props {
  medidas: Medida[]
  /** Medição marcada na lista (Del apaga). */
  selecionada: string | null
  /** Modo de medição ativo no motor. */
  modo: TipoMedida | null
  onSelecionar(id: string): void
  onApagar(id: string): void
  onApagarTodas(): void
}

/** Lista de medições da sessão (não persistem), com Apagar, Apagar todas e atalho Del. */
export default function Medicoes({ medidas, selecionada, modo, onSelecionar, onApagar, onApagarTodas }: Props) {
  return (
    <div className="central-medicoes">
      {modo ? (
        <p className="central-sec">
          {NOMES_MEDIDA[modo]}: {DICAS[modo]} Esc sai do modo.
        </p>
      ) : (
        <p className="central-sec">Escolha Medir na barra superior para começar.</p>
      )}
      {medidas.length === 0 ? (
        <p className="central-sec">Nenhuma medição.</p>
      ) : (
        <>
          <ul aria-label="Lista de medições" className="central-lista-medicoes">
            {medidas.map((m, i) => (
              <li key={m.id}>
                <button
                  type="button"
                  className="central-botao"
                  aria-label={`${NOMES_MEDIDA[m.tipo]} ${i + 1}: ${formatarMedida(m)}`}
                  aria-pressed={selecionada === m.id}
                  title="Del apaga a medição marcada"
                  onClick={() => onSelecionar(m.id)}
                >
                  {NOMES_MEDIDA[m.tipo]}: {formatarMedida(m)}
                </button>
                <button
                  type="button"
                  className="central-botao"
                  aria-label={`Apagar medição ${i + 1}`}
                  onClick={() => onApagar(m.id)}
                >
                  Apagar
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="central-botao" aria-label="Apagar todas as medições" onClick={onApagarTodas}>
            Apagar todas
          </button>
        </>
      )}
    </div>
  )
}
