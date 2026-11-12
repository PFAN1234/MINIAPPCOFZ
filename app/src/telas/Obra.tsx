import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { Abas } from '../components/Abas.tsx'
import { AbaPlanta } from '../components/AbaPlanta.tsx'
import { CampoBusca } from '../components/CampoBusca.tsx'
import { EstadoConsulta, EstadoVazio } from '../components/Estado.tsx'
import { useTelaCheia } from '../components/telaCheia.ts'
import { IconeChevron, IconeCubo } from '../components/Icones.tsx'
import { TopoTela } from '../components/TopoTela.tsx'
import { useObra, usePublicacoesProblema, useSolicitacoes } from '../dados/hooks.ts'
import type { ObraDetalhe } from '../dados/tipos.ts'
import { filtrarAmbientes } from '../util/busca.ts'
import { formatarArea, textoPendencias } from '../util/formato.ts'
import { ordenarNatural } from '../util/ordenacao.ts'

const MODOS = [
  { id: 'planta', rotulo: 'Planta' },
  { id: 'lista', rotulo: 'Lista' },
]

export default function Obra() {
  const { slug = '' } = useParams()
  const obra = useObra(slug)
  return (
    <EstadoConsulta consulta={obra} topo={<TopoTela titulo="Obra" sobretitulo={<LinkObras />} />}>
      {(detalhe) => <ObraCarregada detalhe={detalhe} />}
    </EstadoConsulta>
  )
}

/** A volta para a lista de obras (antes "← Obras") fica na linha acima do título. */
function LinkObras() {
  return <Link to="/">Obras</Link>
}

function ObraCarregada({ detalhe }: { detalhe: ObraDetalhe }) {
  const { obra, pavimentos, ambientes } = detalhe
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  // A planta é o modo padrão; a lista fica na URL como `?aba=lista`.
  const modo = params.get('aba') === 'lista' ? 'lista' : 'planta'
  const pavParam = params.get('pav')
  const pav = pavimentos.find((p) => p.codigo === pavParam) ?? pavimentos[0]
  const foco = params.get('foco')
  const [busca, setBusca] = useState(params.get('q') ?? '')
  const gestor = detalhe.papel === 'gestor'
  const pedidos = useSolicitacoes(obra.id, gestor)
  const problemas = usePublicacoesProblema(obra.id, gestor)
  const nGestao = (pedidos.data?.length ?? 0) + (problemas.data?.length ?? 0)
  const nPendencias = ambientes.reduce((soma, a) => soma + a.pendencias_abertas, 0)

  useTelaCheia(modo === 'planta' && !!pav)

  function atualizar(mudancas: Record<string, string | null>, replace = false) {
    const prox = new URLSearchParams(params)
    for (const [k, v] of Object.entries(mudancas)) {
      if (v === null || v === '') prox.delete(k)
      else prox.set(k, v)
    }
    setParams(prox, { replace })
  }

  const cabecalho = (
    <>
      <TopoTela titulo={obra.nome} idTitulo="titulo-obra" sobretitulo={<LinkObras />} />
      <Link className="cartao-modelo" to={`/obras/${obra.slug}/modelo`}>
        <span className="cartao-modelo-icone">
          <IconeCubo tamanho={32} />
        </span>
        <span className="cartao-modelo-texto">Visualizar modelo federado</span>
        <IconeChevron />
      </Link>
      <div className="atalhos">
        <Link className="atalho" to={`/obras/${obra.slug}/pendencias`}>
          Pendências{' '}
          <span className="atalho-selo">
            {nPendencias}
          </span>
        </Link>
        {gestor && (
          <Link className="atalho" to={`/obras/${obra.slug}/gestao`}>
            Gestão{' '}
            {nGestao > 0 && (
              <span className="atalho-selo atalho-selo-alerta">
                {nGestao}
              </span>
            )}
          </Link>
        )}
      </div>
    </>
  )

  if (!pav) {
    return (
      <section aria-labelledby="titulo-obra">
        {cabecalho}
        <EstadoVazio
          titulo="Nenhum ambiente cadastrado"
          texto="Esta obra ainda não tem pavimentos nem ambientes."
        />
      </section>
    )
  }

  const doPavimento = ambientes.filter((a) => a.ativo && a.pavimento_codigo === pav.codigo)
  const lista = ordenarNatural(filtrarAmbientes(doPavimento, busca), (a) => a.nome_operacional)

  return (
    <section aria-labelledby="titulo-obra" className={modo === 'planta' ? 'obra-planta' : undefined}>
      {cabecalho}
      <h3 className="secao-titulo">Ambientes</h3>
      <Abas
        rotulo="Pavimento"
        itens={pavimentos.map((p) => ({ id: p.codigo, rotulo: p.nome }))}
        ativa={pav.codigo}
        onMudar={(id) => atualizar({ pav: id, foco: null })}
      />
      <Abas
        rotulo="Modo de exibição"
        itens={MODOS}
        ativa={modo}
        onMudar={(id) => atualizar({ aba: id === 'lista' ? 'lista' : null })}
      />
      {modo === 'planta' ? (
        <AbaPlanta
          obra={detalhe}
          pavimentoCodigo={pav.codigo}
          focoCodigo={foco}
          onFocoChange={(c) => atualizar({ foco: c }, true)}
          onSelecionarAmbiente={(c) => navigate(`/obras/${obra.slug}/ambientes/${c}`)}
        />
      ) : (
        <>
          <CampoBusca
            valor={busca}
            onMudar={(v) => {
              setBusca(v)
              atualizar({ q: v.trim() ? v : null }, true)
            }}
            rotulo="Buscar ambiente"
            placeholder="Buscar ambiente"
          />
          {lista.length === 0 ? (
            <EstadoVazio
              titulo="Nenhum ambiente encontrado"
              texto={busca ? 'Tente outro nome.' : 'Este pavimento não tem ambientes.'}
            />
          ) : (
            <ul className="lista">
              {lista.map((a) => {
                const area = formatarArea(a.area_m2)
                return (
                  <li key={a.id}>
                    <Link
                      className="lista-item lista-item-linha"
                      to={`/obras/${obra.slug}/ambientes/${a.codigo}`}
                    >
                      <span className="item-texto">
                        <span className="lista-titulo">{a.nome_operacional}</span>
                        {area && <span className="lista-sub">{area}</span>}
                      </span>
                      {a.pendencias_abertas > 0 && (
                        <span className="selo selo-aberta">{textoPendencias(a.pendencias_abertas)}</span>
                      )}
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
