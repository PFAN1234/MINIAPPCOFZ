import { useMemo } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { Abas } from '../components/Abas.tsx'
import { Aviso } from '../components/Aviso.tsx'
import { CartaoPendencia } from '../components/CartaoPendencia.tsx'
import { EstadoConsulta, EstadoVazio } from '../components/Estado.tsx'
import { IconeFiltro } from '../components/Icones.tsx'
import { RegistroLocal } from '../components/RegistroLocal.tsx'
import { TopoTela } from '../components/TopoTela.tsx'
import { useAvisoDaRota } from '../components/useAvisoDaRota.ts'
import { useObra, useRegistros } from '../dados/hooks.ts'
import type { RegistroResumo } from '../dados/tipos.ts'
import { useRegistrosLocais } from '../offline/contexto.tsx'
import { ordenarNatural } from '../util/ordenacao.ts'

/** Na rota da obra, o subtítulo do topo leva de volta à obra. */
function LinkDaObra({ slug }: { slug: string }) {
  const obra = useObra(slug)
  return <Link to={`/obras/${slug}`}>{obra.data?.obra.nome ?? 'Obra'}</Link>
}

/**
 * Pendências da obra (tela 5), filtradas por ambiente. Aba e filtro ficam na URL
 * (`?aba=resolvidas&ambiente=<codigo>`). A visão de todas as obras é a tela Registros.
 */
export default function Pendencias() {
  const { slug } = useParams()
  const [params, setParams] = useSearchParams()
  const { aviso, fecharAviso } = useAvisoDaRota()
  const aba = params.get('aba') === 'resolvidas' ? 'resolvidas' : 'abertas'
  const filtroAmbiente = slug ? params.get('ambiente') : null
  const registros = useRegistros({ tipo: 'pendencia', obraSlug: slug })
  const locais = useRegistrosLocais({ tipo: 'pendencia', obraSlug: slug })

  function mudar(mudancas: Record<string, string | null>) {
    const prox = new URLSearchParams(params)
    for (const [k, v] of Object.entries(mudancas)) {
      if (v === null || v === '') prox.delete(k)
      else prox.set(k, v)
    }
    setParams(prox, { replace: true })
  }

  const locaisFiltrados = useMemo(
    () =>
      locais.filter(
        (i) =>
          !filtroAmbiente || i.registro.ambiente.codigo === filtroAmbiente,
      ),
    [locais, filtroAmbiente],
  )

  return (
    <section aria-labelledby="titulo-pendencias">
      <TopoTela
        lista
        titulo="Pendências"
        idTitulo="titulo-pendencias"
        subtitulo={slug ? <LinkDaObra slug={slug} /> : undefined}
      />
      {aviso && <Aviso texto={aviso} onFechar={fecharAviso} />}
      <EstadoConsulta consulta={registros}>
        {(lista) => {
          const doFiltro = lista.filter((r) => !filtroAmbiente || r.ambiente.codigo === filtroAmbiente)
          const abertas = doFiltro.filter((r) => r.situacao !== 'resolvida')
          const resolvidas = doFiltro.filter((r) => r.situacao === 'resolvida')
          const ids = new Set(lista.map((r) => r.id))
          const locaisAbertas = locaisFiltrados.filter((i) => !ids.has(i.registro.id))
          const mostrar: RegistroResumo[] = aba === 'abertas' ? abertas : resolvidas

          const opcoes = ordenarNatural(
            [...new Map(lista.map((r) => [r.ambiente.codigo, r.ambiente.nome])).entries()],
            ([, nome]) => nome,
          )

          return (
            <>
              <Abas
                rotulo="Situação das pendências"
                itens={[
                  { id: 'abertas', rotulo: `Abertas (${abertas.length + locaisAbertas.length})` },
                  { id: 'resolvidas', rotulo: `Resolvidas (${resolvidas.length})` },
                ]}
                ativa={aba}
                onMudar={(id) => mudar({ aba: id === 'resolvidas' ? 'resolvidas' : null })}
              />
              <div className="filtro">
                <IconeFiltro tamanho={20} />
                <select
                  aria-label="Filtrar por ambiente"
                  value={filtroAmbiente ?? ''}
                  onChange={(e) => mudar({ ambiente: e.target.value || null })}
                >
                  <option value="">Todos os ambientes</option>
                  {opcoes.map(([valor, nome]) => (
                    <option key={valor} value={valor}>
                      {nome}
                    </option>
                  ))}
                </select>
              </div>
              {aba === 'abertas' && mostrar.length + locaisAbertas.length === 0 ? (
                <EstadoVazio titulo="Nenhuma pendência aberta" />
              ) : aba === 'resolvidas' && mostrar.length === 0 ? (
                <EstadoVazio titulo="Nenhuma pendência resolvida" />
              ) : (
                <ul className="lista lista-cartoes">
                  {aba === 'abertas' &&
                    locaisAbertas.map((i) => (
                      <RegistroLocal key={i.registro.id} item={i} local={false} />
                    ))}
                  {mostrar.map((r) => (
                    <CartaoPendencia key={r.id} registro={r} />
                  ))}
                </ul>
              )}
            </>
          )
        }}
      </EstadoConsulta>
    </section>
  )
}
