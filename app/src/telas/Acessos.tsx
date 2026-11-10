import { useParams } from 'react-router'
import { EstadoConsulta, EstadoVazio } from '../components/Estado.tsx'
import { PedidosAcesso } from '../components/PedidosAcesso.tsx'
import { useObra } from '../dados/hooks.ts'
import type { ObraDetalhe } from '../dados/tipos.ts'

/** Rota mantida por causa do link do bot (`acessos_<slug>`); o dia a dia fica na Gestão. */
export default function Acessos() {
  const { slug = '' } = useParams()
  const obra = useObra(slug)
  return (
    <EstadoConsulta consulta={obra}>{(detalhe) => <AcessosCarregados detalhe={detalhe} />}</EstadoConsulta>
  )
}

function AcessosCarregados({ detalhe }: { detalhe: ObraDetalhe }) {
  const { obra, papel } = detalhe
  return (
    <section aria-labelledby="titulo-acessos">
      <h2 id="titulo-acessos" className="titulo-tela">
        Pedidos de acesso
      </h2>
      <p className="subtitulo">{obra.nome}</p>
      {papel !== 'gestor' ? (
        <EstadoVazio titulo="Só gestores da obra veem os pedidos de acesso." />
      ) : (
        <PedidosAcesso obraId={obra.id} />
      )}
    </section>
  )
}
