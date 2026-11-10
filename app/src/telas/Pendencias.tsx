import { EstadoConsulta } from '../components/Estado.tsx'
import { ListaRegistros } from '../components/ListaRegistros.tsx'
import { useRegistros } from '../dados/hooks.ts'
import { useRegistrosLocais } from '../offline/contexto.tsx'

export default function Pendencias() {
  const registros = useRegistros({ tipo: 'pendencia', situacao: 'aberta' })
  const locais = useRegistrosLocais({ tipo: 'pendencia' })
  return (
    <section aria-labelledby="titulo-pendencias">
      <h2 id="titulo-pendencias">Pendências abertas</h2>
      <EstadoConsulta consulta={registros}>
        {(lista) => <ListaRegistros registros={lista} locais={locais} vazio="Nenhuma pendência aberta" />}
      </EstadoConsulta>
    </section>
  )
}
