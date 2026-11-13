import type { TotalObra } from '../util/painel.ts'

function plural(n: number, um: string, varios: string) {
  return `${n} ${n === 1 ? um : varios}`
}

/** Barras horizontais empilhadas por obra: resolvidas (verde) e abertas (laranja). */
export function GraficoPorObra({ totais }: { totais: TotalObra[] }) {
  const maior = Math.max(1, ...totais.map((t) => t.abertas + t.resolvidas))
  return (
    <ul className="por-obra" aria-label="Pendências por obra">
      {totais.map((t) => {
        const total = t.abertas + t.resolvidas
        const segs = [
          { chave: 'resolvidas', n: t.resolvidas },
          { chave: 'abertas', n: t.abertas },
        ].filter((s) => s.n > 0)
        return (
          <li key={t.obra.id} className="por-obra-linha">
            <span className="por-obra-nome">{t.obra.nome}</span>
            <span className="por-obra-numeros">
              {plural(t.abertas, 'aberta', 'abertas')} · {plural(t.resolvidas, 'resolvida', 'resolvidas')}
            </span>
            <span className="por-obra-trilho" aria-hidden="true">
              <span className="por-obra-barra" style={{ width: `${(total / maior) * 100}%` }}>
                {segs.map((s) => (
                  <span key={s.chave} className={`por-obra-seg por-obra-${s.chave}`} style={{ flexGrow: s.n }} />
                ))}
              </span>
            </span>
          </li>
        )
      })}
    </ul>
  )
}
