import { EstadoConsulta } from '../components/Estado.tsx'
import { ListaRegistros } from '../components/ListaRegistros.tsx'
import { useRegistros } from '../dados/hooks.ts'

export default function Pendencias() {
  const registros = useRegistros({ tipo: 'pendencia', situacao: 'aberta' })
  return (
    <section aria-labelledby="titulo-pendencias">
      <h2 id="titulo-pendencias">Pendências abertas</h2>
      <EstadoConsulta consulta={registros}>
        {(lista) => <ListaRegistros registros={lista} vazio="Nenhuma pendência aberta" />}
      </EstadoConsulta>
    </section>
  )
}
