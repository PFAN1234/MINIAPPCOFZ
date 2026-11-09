import { Link } from 'react-router'
import type { RegistroResumo } from '../dados/tipos.ts'
import { EstadoVazio } from './Estado.tsx'

const formatador = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
})

export function formatarData(iso: string): string {
  return formatador.format(new Date(iso))
}

export function ListaRegistros({
  registros,
  vazio,
}: {
  registros: RegistroResumo[]
  vazio: string
}) {
  if (registros.length === 0) return <EstadoVazio titulo={vazio} />
  return (
    <ul className="lista">
      {registros.map((r) => (
        <li key={r.id}>
          <Link
            className="lista-item"
            to={`/obras/${r.obra.slug}/ambientes/${r.ambiente.codigo}`}
          >
            <span className="lista-titulo">{r.legenda}</span>
            <span className="lista-sub">
              {r.obra.nome} · {r.ambiente.nome} · {r.autor} · {formatarData(r.capturado_em)}
              {r.tipo === 'pendencia' && (
                <> · {r.situacao === 'aberta' ? 'Pendência aberta' : 'Pendência resolvida'}</>
              )}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
