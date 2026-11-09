import { useParams } from 'react-router'
import { EstadoConsulta } from '../components/Estado.tsx'
import { useAmbiente } from '../dados/hooks.ts'

export default function Ambiente() {
  const { slug = '', codigo = '' } = useParams()
  const ambiente = useAmbiente(slug, codigo)
  return (
    <EstadoConsulta consulta={ambiente}>
      {({ obra, ambiente: a, pavimento }) => (
        <section aria-labelledby="titulo-ambiente">
          <h2 id="titulo-ambiente">{a.nome_operacional}</h2>
          <p>
            {obra.nome} · {pavimento.nome}
          </p>
        </section>
      )}
    </EstadoConsulta>
  )
}
