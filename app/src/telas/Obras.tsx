import { Link } from 'react-router'
import { EstadoConsulta, EstadoVazio } from '../components/Estado.tsx'
import { ListaRegistros } from '../components/ListaRegistros.tsx'
import { useObras, useRegistros } from '../dados/hooks.ts'

export default function Obras() {
  const obras = useObras()
  const recentes = useRegistros({ limite: 5 })
  return (
    <>
      <section aria-labelledby="titulo-obras">
        <h2 id="titulo-obras">Obras</h2>
        <EstadoConsulta consulta={obras}>
          {(lista) =>
            lista.length === 0 ? (
              <EstadoVazio
                titulo="Nenhuma obra por aqui ainda"
                texto="A lista das obras que você pode acessar aparecerá aqui."
              />
            ) : (
              <ul className="lista">
                {lista.map((o) => (
                  <li key={o.id}>
                    <Link className="lista-item" to={`/obras/${o.slug}`}>
                      <span className="lista-titulo">{o.nome}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )
          }
        </EstadoConsulta>
      </section>
      <section aria-labelledby="titulo-recentes">
        <h2 id="titulo-recentes">Últimos registros</h2>
        <EstadoConsulta consulta={recentes}>
          {(lista) => <ListaRegistros registros={lista} vazio="Nenhum registro ainda" />}
        </EstadoConsulta>
      </section>
    </>
  )
}
