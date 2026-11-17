import type { PainelRelatorios as Painel } from '../dados/tipos.ts'
import { serieAcumulada, totaisPorObra } from '../util/painel.ts'
import { GraficoAcumulado, ddmm } from './GraficoAcumulado.tsx'
import { GraficoPorObra } from './GraficoPorObra.tsx'

/** Cartões de número, gráficos e tabela do painel de uma etapa (`obraId` nulo = todas as obras). */
export function PainelRelatorios({ painel, obraId }: { painel: Painel; obraId: string | null }) {
  const dias = painel.dias.filter((d) => obraId === null || d.obra_id === obraId)
  if (dias.length === 0) return <p className="relatorio-dica">Ainda não há registros nesta etapa.</p>

  const serie = serieAcumulada(painel, obraId)
  const fim = serie[serie.length - 1]
  const abertas = fim.pendencias - fim.resolvidas
  const pct = fim.pendencias > 0 ? Math.round((fim.resolvidas / fim.pendencias) * 100) : 0
  const comMovimento = new Set(dias.map((d) => d.dia))
  const linhas = serie.filter((p) => comMovimento.has(p.dia))

  return (
    <>
      <div className="painel-cartoes">
        <div className="painel-numero painel-servicos">
          <b>{fim.servicos}</b>
          <span>Serviços</span>
        </div>
        <div className="painel-numero painel-abertas">
          <b>{abertas}</b>
          <span>Pendências abertas</span>
          <small>de {fim.pendencias} registradas</small>
        </div>
        <div className="painel-numero painel-resolvidas">
          <b>{fim.resolvidas}</b>
          <span>Resolvidas</span>
          <small>{pct}% das pendências</small>
        </div>
      </div>
      <h3 className="painel-subtitulo">Acumulado</h3>
      <GraficoAcumulado serie={serie} />
      {obraId === null && painel.obras.length >= 2 && (
        <>
          <h3 className="painel-subtitulo">Por obra</h3>
          <GraficoPorObra totais={totaisPorObra(painel)} />
        </>
      )}
      <details className="painel-tabela">
        <summary>Ver em tabela</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Dia</th>
              <th scope="col">Serviços</th>
              <th scope="col">Pendências</th>
              <th scope="col">Resolvidas</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((p) => (
              <tr key={p.dia}>
                <th scope="row">{ddmm(p.dia)}</th>
                <td>{p.servicos}</td>
                <td>{p.pendencias}</td>
                <td>{p.resolvidas}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  )
}
