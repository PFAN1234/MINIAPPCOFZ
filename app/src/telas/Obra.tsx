import { Link, useParams, useSearchParams } from 'react-router'
import { EstadoConsulta, EstadoVazio } from '../components/Estado.tsx'
import { useObra } from '../dados/hooks.ts'
import { filtrarAmbientes } from '../util/busca.ts'
import { ordenarNatural } from '../util/ordenacao.ts'

export default function Obra() {
  const { slug = '' } = useParams()
  const [params] = useSearchParams()
  const obra = useObra(slug)
  const pav = params.get('pav')
  const q = params.get('q') ?? ''

  return (
    <EstadoConsulta consulta={obra}>
      {({ obra: o, pavimentos, ambientes }) => {
        const pavAtual = pav ?? pavimentos[0]?.codigo
        const lista = ordenarNatural(
          filtrarAmbientes(
            ambientes.filter((a) => !pavAtual || a.pavimento_codigo === pavAtual),
            q,
          ),
          (a) => a.nome_operacional,
        )
        return (
          <section aria-labelledby="titulo-obra">
            <h2 id="titulo-obra">{o.nome}</h2>
            {lista.length === 0 ? (
              <EstadoVazio titulo="Nenhum ambiente encontrado" />
            ) : (
              <ul className="lista">
                {lista.map((a) => (
                  <li key={a.id}>
                    <Link
                      className="lista-item"
                      to={`/obras/${o.slug}/ambientes/${a.codigo}`}
                    >
                      <span className="lista-titulo">{a.nome_operacional}</span>
                      {a.pendencias_abertas > 0 && (
                        <span className="lista-sub">
                          {a.pendencias_abertas} pendência(s) aberta(s)
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      }}
    </EstadoConsulta>
  )
}
