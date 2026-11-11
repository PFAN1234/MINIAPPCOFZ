import { Link } from 'react-router'
import { ComDados } from '../componentes.tsx'
import { useObrasAdmin } from '../dados/hooks.ts'
import { ROTULO_STATUS, type StatusObra } from '../dados/tipos.ts'

export function rotuloStatus(status: string | null): string {
  if (status === null) return 'Sem configuração'
  return ROTULO_STATUS[status as StatusObra] ?? status
}

export default function ObrasAdmin() {
  const obras = useObrasAdmin()
  return (
    <section aria-labelledby="titulo-obras">
      <div className="adm-titulo-linha">
        <h1 id="titulo-obras">Obras</h1>
        <Link className="adm-botao adm-botao-principal" to="/nova-obra">
          Nova obra
        </Link>
      </div>
      <ComDados consulta={obras}>
        {(lista) =>
          lista.length === 0 ? (
            <p className="adm-dica">Nenhuma obra cadastrada.</p>
          ) : (
            <table className="adm-tabela">
              <thead>
                <tr>
                  <th scope="col">Obra</th>
                  <th scope="col">Slug</th>
                  <th scope="col">Pavimentos</th>
                  <th scope="col" className="adm-num">
                    Ambientes ativos
                  </th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link to={`/obras/${o.slug}`}>{o.nome}</Link>
                    </td>
                    <td>
                      <code>{o.slug}</code>
                    </td>
                    <td>{o.pavimentos.length ? o.pavimentos.map((p) => p.nome).join(', ') : '—'}</td>
                    <td className="adm-num">{o.ambientes_ativos}</td>
                    <td>
                      <span className={`adm-selo adm-selo-${o.status ?? 'vazio'}`}>{rotuloStatus(o.status)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </ComDados>
    </section>
  )
}
