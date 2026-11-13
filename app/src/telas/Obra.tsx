import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { Abas } from '../components/Abas.tsx'
import { AbaPlanta } from '../components/AbaPlanta.tsx'
import { CartaoObservacoes } from '../components/CartaoObservacoes.tsx'
import { CampoBusca } from '../components/CampoBusca.tsx'
import { EstadoConsulta, EstadoVazio } from '../components/Estado.tsx'
import { PreviaModelo } from '../components/PreviaModelo.tsx'
import { TopoTela } from '../components/TopoTela.tsx'
import { useObra } from '../dados/hooks.ts'
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

/** A volta para a lista de obras fica na linha pequena acima do título, no centro da faixa. */
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
  const nPendencias = ambientes.reduce((soma, a) => soma + a.pendencias_abertas, 0)

  function atualizar(mudancas: Record<string, string | null>, replace = false) {
    const prox = new URLSearchParams(params)
    for (const [k, v] of Object.entries(mudancas)) {
      if (v === null || v === '') prox.delete(k)
      else prox.set(k, v)
    }
    setParams(prox, { replace })
  }

  const topo = (
    <TopoTela
      titulo={obra.nome}
      idTitulo="titulo-obra"
      sobretitulo={<LinkObras />}
      base={
        <>
          {pav && (
            <Abas
              rotulo="Pavimento"
              itens={pavimentos.map((p) => ({ id: p.codigo, rotulo: p.nome }))}
              ativa={pav.codigo}
              onMudar={(id) => atualizar({ pav: id, foco: null })}
            />
          )}
          <Link className="atalho" to={`/obras/${obra.slug}/pendencias`}>
            Pendências <span className="atalho-selo">{nPendencias}</span>
          </Link>
        </>
      }
    />
  )
  const observacoes = <CartaoObservacoes obra={obra} />

  if (!pav) {
    return (
      <section aria-labelledby="titulo-obra">
        {topo}
        <PreviaModelo slug={obra.slug} />
        <EstadoVazio
          titulo="Nenhum ambiente cadastrado"
          texto="Esta obra ainda não tem pavimentos nem ambientes."
        />
        {observacoes}
      </section>
    )
  }

  const doPavimento = ambientes.filter((a) => a.ativo && a.pavimento_codigo === pav.codigo)
  const lista = ordenarNatural(filtrarAmbientes(doPavimento, busca), (a) => a.nome_operacional)

  return (
    <section aria-labelledby="titulo-obra" className={modo === 'planta' ? 'obra-planta' : undefined}>
      {topo}
      <PreviaModelo slug={obra.slug} />
      <h3 className="secao-titulo">Ambientes</h3>
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
      {observacoes}
    </section>
  )
}
