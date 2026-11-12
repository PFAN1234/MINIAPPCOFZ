import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { Aviso } from '../components/Aviso.tsx'
import { Abas } from '../components/Abas.tsx'
import { EstadoConsulta } from '../components/Estado.tsx'
import { ListaRegistros } from '../components/ListaRegistros.tsx'
import { OndeFica } from '../components/OndeFica.tsx'
import { TopoTela } from '../components/TopoTela.tsx'
import { useAvisoDaRota } from '../components/useAvisoDaRota.ts'
import { useAmbiente, useRegistros } from '../dados/hooks.ts'
import type { AmbienteDetalhe } from '../dados/tipos.ts'
import { useRegistrosLocais } from '../offline/contexto.tsx'
import { recursos } from '../recursos.ts'
import { formatarArea } from '../util/formato.ts'

const AVISO_INATIVO =
  'Este ambiente não existe na planta atual; registros mantidos como histórico.'

const ABAS = [
  { id: 'historico', rotulo: 'Histórico' },
  { id: 'pendencias', rotulo: 'Pendências' },
]

export default function Ambiente() {
  const { slug = '', codigo = '' } = useParams()
  const consulta = useAmbiente(slug, codigo)
  return (
    <EstadoConsulta consulta={consulta} topo={<TopoTela titulo="Ambiente" />}>
      {(detalhe) => <AmbienteCarregado detalhe={detalhe} />}
    </EstadoConsulta>
  )
}

function AmbienteCarregado({ detalhe }: { detalhe: AmbienteDetalhe }) {
  const { obra, ambiente, pavimento } = detalhe
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const { aviso, fecharAviso } = useAvisoDaRota()
  const aba = params.get('aba') === 'pendencias' ? 'pendencias' : 'historico'
  const area = formatarArea(ambiente.area_m2)
  const destaque = params.get('registro')

  return (
    <section aria-labelledby="titulo-ambiente">
      <TopoTela
        titulo={ambiente.nome_operacional}
        idTitulo="titulo-ambiente"
        subtitulo={
          <>
            <Link to={`/obras/${obra.slug}?pav=${pavimento.codigo}`}>{obra.nome}</Link> · {pavimento.nome}
            {area && ` · ${area}`}
          </>
        }
      />
      {aviso && <Aviso texto={aviso} onFechar={fecharAviso} />}
      {!ambiente.ativo && (
        <p className="aviso-inativo" role="note">
          {AVISO_INATIVO}
        </p>
      )}
      <OndeFica
        detalhe={detalhe}
        onAbrirPlanta={() =>
          navigate(
            `/obras/${obra.slug}?aba=planta&pav=${pavimento.codigo}&foco=${ambiente.codigo}`,
          )
        }
      />
      {recursos.novoRegistro && (
        <button
          type="button"
          className="botao botao-bloco"
          onClick={() => navigate(`/obras/${obra.slug}/ambientes/${ambiente.codigo}/novo`)}
        >
          Novo registro
        </button>
      )}
      <Abas
        rotulo="Registros do ambiente"
        itens={ABAS}
        ativa={aba}
        onMudar={(id) => {
          const prox = new URLSearchParams(params)
          prox.delete('registro')
          if (id === 'pendencias') prox.set('aba', id)
          else prox.delete('aba')
          setParams(prox)
        }}
      />
      {aba === 'historico' ? (
        <Historico ambienteId={ambiente.id} destaque={destaque} />
      ) : (
        <Pendencias ambienteId={ambiente.id} destaque={destaque} />
      )}
    </section>
  )
}

function Historico({ ambienteId, destaque }: { ambienteId: string; destaque: string | null }) {
  const registros = useRegistros({ ambienteId })
  const locais = useRegistrosLocais({ ambienteId })
  return (
    <EstadoConsulta consulta={registros}>
      {(lista) => (
        <ListaRegistros
          local
          destaque={destaque}
          registros={lista}
          locais={locais}
          vazio="Nenhum registro neste ambiente"
        />
      )}
    </EstadoConsulta>
  )
}

function Pendencias({ ambienteId, destaque }: { ambienteId: string; destaque: string | null }) {
  const registros = useRegistros({ ambienteId, tipo: 'pendencia' })
  const locais = useRegistrosLocais({ ambienteId, tipo: 'pendencia' })
  return (
    <EstadoConsulta consulta={registros}>
      {(lista) => {
        const abertas = lista.filter((r) => r.situacao === 'aberta')
        const resolvidas = lista.filter((r) => r.situacao !== 'aberta')
        return (
          <ListaRegistros
            local
            destaque={destaque}
            registros={[...abertas, ...resolvidas]}
            locais={locais}
            vazio="Nenhuma pendência neste ambiente"
          />
        )
      }}
    </EstadoConsulta>
  )
}
