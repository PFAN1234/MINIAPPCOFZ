import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { Abas } from '../components/Abas.tsx'
import { EstadoConsulta } from '../components/Estado.tsx'
import { ListaRegistros } from '../components/ListaRegistros.tsx'
import { OndeFica } from '../components/OndeFica.tsx'
import { useAmbiente, useRegistros } from '../dados/hooks.ts'
import type { AmbienteDetalhe } from '../dados/tipos.ts'
import { recursos } from '../recursos.ts'
import { formatarArea } from '../util/formato.ts'

const ABAS = [
  { id: 'historico', rotulo: 'Histórico' },
  { id: 'pendencias', rotulo: 'Pendências' },
]

export default function Ambiente() {
  const { slug = '', codigo = '' } = useParams()
  const consulta = useAmbiente(slug, codigo)
  return (
    <EstadoConsulta consulta={consulta}>
      {(detalhe) => <AmbienteCarregado detalhe={detalhe} />}
    </EstadoConsulta>
  )
}

function AmbienteCarregado({ detalhe }: { detalhe: AmbienteDetalhe }) {
  const { obra, ambiente, pavimento } = detalhe
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const aba = params.get('aba') === 'pendencias' ? 'pendencias' : 'historico'
  const area = formatarArea(ambiente.area_m2)

  return (
    <section aria-labelledby="titulo-ambiente">
      <h2 id="titulo-ambiente" className="titulo-tela">
        {ambiente.nome_operacional}
      </h2>
      <p className="subtitulo">
        <Link to={`/obras/${obra.slug}?pav=${pavimento.codigo}`}>{obra.nome}</Link> · {pavimento.nome}
        {area && ` · ${area}`}
      </p>
      <OndeFica
        detalhe={detalhe}
        onAbrirPlanta={() =>
          navigate(
            `/obras/${obra.slug}?aba=planta&pav=${pavimento.codigo}&foco=${ambiente.codigo}`,
          )
        }
      />
      {recursos.novoRegistro && (
        <button type="button" className="botao botao-bloco">
          Novo registro
        </button>
      )}
      <Abas
        rotulo="Registros do ambiente"
        itens={ABAS}
        ativa={aba}
        onMudar={(id) => {
          const prox = new URLSearchParams(params)
          if (id === 'pendencias') prox.set('aba', id)
          else prox.delete('aba')
          setParams(prox)
        }}
      />
      {aba === 'historico' ? (
        <Historico ambienteId={ambiente.id} />
      ) : (
        <Pendencias ambienteId={ambiente.id} />
      )}
    </section>
  )
}

function Historico({ ambienteId }: { ambienteId: string }) {
  const registros = useRegistros({ ambienteId })
  return (
    <EstadoConsulta consulta={registros}>
      {(lista) => <ListaRegistros local registros={lista} vazio="Nenhum registro neste ambiente" />}
    </EstadoConsulta>
  )
}

function Pendencias({ ambienteId }: { ambienteId: string }) {
  const registros = useRegistros({ ambienteId, tipo: 'pendencia' })
  return (
    <EstadoConsulta consulta={registros}>
      {(lista) => {
        const abertas = lista.filter((r) => r.situacao === 'aberta')
        const resolvidas = lista.filter((r) => r.situacao !== 'aberta')
        return (
          <ListaRegistros
            local
            registros={[...abertas, ...resolvidas]}
            vazio="Nenhuma pendência neste ambiente"
          />
        )
      }}
    </EstadoConsulta>
  )
}
