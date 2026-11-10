import { Link, useParams } from 'react-router'
import { EstadoConsulta } from '../components/Estado.tsx'
import { IconeCubo } from '../components/Icones.tsx'
import { useObra } from '../dados/hooks.ts'

/** Disciplinas previstas para o modelo federado (visualizador na fase 9). */
const DISCIPLINAS = ['ARQ', 'ELT', 'HID', 'ESG', 'DRE', 'PCI', 'VES', 'TLD', 'ANT']

export default function Modelo() {
  const { slug = '' } = useParams()
  const obra = useObra(slug)
  return (
    <EstadoConsulta consulta={obra}>
      {({ obra: o }) => (
        <section aria-labelledby="titulo-modelo">
          <p className="voltar-linha">
            <Link to={`/obras/${o.slug}`}>← {o.nome}</Link>
          </p>
          <h2 id="titulo-modelo" className="titulo-tela">
            Modelo federado
          </h2>
          <div className="cartao-info">
            <span className="cartao-info-icone">
              <IconeCubo tamanho={28} />
            </span>
            <p>O visualizador 3D do modelo federado está em preparação e chega numa próxima versão.</p>
          </div>
          <h3 className="secao-titulo">Modelos previstos</h3>
          <ul className="chips" aria-label="Modelos previstos">
            {DISCIPLINAS.map((d) => (
              <li key={d}>
                <button type="button" className="chip" disabled>
                  {d}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </EstadoConsulta>
  )
}
