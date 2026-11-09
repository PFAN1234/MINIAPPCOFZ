import { Link } from 'react-router'
import type { RegistroResumo } from '../dados/tipos.ts'
import { formatarDataHora, formatarRelativo } from '../util/formato.ts'
import { EstadoVazio } from './Estado.tsx'

function Selo({ registro }: { registro: RegistroResumo }) {
  if (registro.tipo === 'servico') return <span className="selo selo-servico">Serviço</span>
  return registro.situacao === 'aberta' ? (
    <span className="selo selo-aberta">Pendência aberta</span>
  ) : (
    <span className="selo selo-resolvida">Pendência resolvida</span>
  )
}

function Horario({ iso }: { iso: string }) {
  const relativo = formatarRelativo(iso)
  return (
    <time dateTime={iso}>
      {formatarDataHora(iso)}
      {relativo && ` (${relativo})`}
    </time>
  )
}

/** Lista de registros; `local` esconde obra e ambiente (já conhecidos na tela do ambiente). */
export function ListaRegistros({
  registros,
  vazio,
  local = false,
}: {
  registros: RegistroResumo[]
  vazio: string
  local?: boolean
}) {
  if (registros.length === 0) return <EstadoVazio titulo={vazio} />
  return (
    <ul className="lista">
      {registros.map((r) => {
        const conteudo = (
          <>
            <span className="registro-topo">
              <Selo registro={r} />
              <span className="lista-sub">
                <Horario iso={r.capturado_em} />
              </span>
            </span>
            <span className="lista-titulo registro-legenda">{r.legenda}</span>
            <span className="lista-sub">
              {local ? r.autor : `${r.obra.nome} · ${r.ambiente.nome} · ${r.autor}`}
            </span>
          </>
        )
        return (
          <li key={r.id}>
            {local ? (
              <div className="lista-item">{conteudo}</div>
            ) : (
              <Link
                className="lista-item"
                to={`/obras/${r.obra.slug}/ambientes/${r.ambiente.codigo}`}
              >
                {conteudo}
              </Link>
            )}
          </li>
        )
      })}
    </ul>
  )
}
