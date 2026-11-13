import { useId } from 'react'
import type { Etapa } from '../dados/tipos.ts'

/** Seletor de etapa da tela inicial (no topo azul): `select` nativo, bom no celular e acessível. */
export function SeletorEtapa({
  etapas,
  valor,
  onMudar,
}: {
  etapas: readonly Etapa[]
  valor: string
  onMudar: (etapaId: string) => void
}) {
  const id = useId()
  return (
    <div className="seletor-etapa">
      <label className="seletor-etapa-rotulo" htmlFor={id}>
        Etapa
      </label>
      <select id={id} value={valor} onChange={(e) => onMudar(e.target.value)}>
        {etapas.map((e) => (
          <option key={e.id} value={e.id}>
            {e.nome}
          </option>
        ))}
      </select>
    </div>
  )
}
