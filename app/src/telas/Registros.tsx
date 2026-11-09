import { EstadoConsulta } from '../components/Estado.tsx'
import { ListaRegistros } from '../components/ListaRegistros.tsx'
import { useRegistros } from '../dados/hooks.ts'

export default function Registros() {
  const registros = useRegistros({ limite: 50 })
  return (
    <section aria-labelledby="titulo-registros">
      <h2 id="titulo-registros">Registros</h2>
      <EstadoConsulta consulta={registros}>
        {(lista) => <ListaRegistros registros={lista} vazio="Nenhum registro ainda" />}
      </EstadoConsulta>
    </section>
  )
}
