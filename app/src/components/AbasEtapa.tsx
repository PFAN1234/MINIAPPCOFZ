import type { Etapa } from '../dados/tipos.ts'

/** Abas das etapas no topo azul do Início: todas lado a lado, com rolagem horizontal se não couberem. */
export function AbasEtapa({
  etapas,
  valor,
  onMudar,
}: {
  etapas: readonly Etapa[]
  valor: string
  onMudar: (etapaId: string) => void
}) {
  return (
    <div className="abas-etapa" role="tablist" aria-label="Etapa">
      {etapas.map((e) => {
        const ativa = e.id === valor
        return (
          <button
            key={e.id}
            type="button"
            role="tab"
            className="aba-etapa"
            aria-selected={ativa}
            tabIndex={ativa ? 0 : -1}
            onClick={() => onMudar(e.id)}
          >
            {e.nome}
          </button>
        )
      })}
    </div>
  )
}
