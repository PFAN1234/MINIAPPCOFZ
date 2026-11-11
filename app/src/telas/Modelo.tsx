import { useQuery } from '@tanstack/react-query'
import { lazy, Suspense, useCallback, useState } from 'react'
import { Link, useParams } from 'react-router'
import { EstadoCarregando, EstadoConsulta } from '../components/Estado.tsx'
import { IconeCubo } from '../components/Icones.tsx'
import { useRepositorio } from '../dados/contexto.tsx'
import { useObra } from '../dados/hooks.ts'
import { modeloComCache } from '../modelo/cacheModelo.ts'
import type { ModeloFrag } from '../modelo/modelos.ts'

// Three.js e That Open ficam fora do pacote inicial.
const VisualizadorModelo = lazy(() => import('../modelo/VisualizadorModelo.tsx'))

/** Disciplinas previstas para o modelo federado; as sem `.frag` ficam desabilitadas. */
const DISCIPLINAS = ['ARQ', 'ELT', 'HID', 'ESG', 'DRE', 'PCI', 'VES', 'TLD', 'ANT']

export default function Modelo() {
  const { slug = '' } = useParams()
  const repo = useRepositorio()
  const obra = useObra(slug)
  const modelos = useQuery({ queryKey: ['modelos', slug], queryFn: () => repo.listarModelos(slug) })
  const baixar = useCallback(
    (m: ModeloFrag) => modeloComCache(`${slug}/${m.sigla}@${m.hash}`, () => repo.baixarModelo(slug, m)),
    [repo, slug],
  )
  const [desligados, setDesligados] = useState<ReadonlySet<string>>(new Set())

  const disponiveis = modelos.data ?? []
  const ativos = new Set(disponiveis.map((m) => m.sigla).filter((s) => !desligados.has(s)))

  function alternar(sigla: string) {
    setDesligados((atual) => {
      const novo = new Set(atual)
      if (!novo.delete(sigla)) novo.add(sigla)
      return novo
    })
  }

  return (
    <EstadoConsulta consulta={obra}>
      {({ obra: o }) => (
        <section aria-labelledby="titulo-modelo">
          <p className="voltar-linha">
            <Link to={`/obras/${o.slug}`}>← {o.nome}</Link>
          </p>
          <h2 id="titulo-modelo" className="titulo-tela">
            Modelo federado
          </h2>
          {modelos.isPending ? (
            <EstadoCarregando />
          ) : disponiveis.length > 0 ? (
            <Suspense fallback={<EstadoCarregando />}>
              <VisualizadorModelo modelos={disponiveis} baixar={baixar} ativos={ativos} />
            </Suspense>
          ) : (
            <div className="cartao-info">
              <span className="cartao-info-icone">
                <IconeCubo tamanho={28} />
              </span>
              <p>
                {modelos.isError
                  ? 'Não foi possível carregar os modelos desta obra.'
                  : 'Esta obra ainda não tem modelos 3D publicados.'}
              </p>
            </div>
          )}
          <h3 className="secao-titulo">Modelos</h3>
          <ul className="chips" aria-label="Modelos">
            {DISCIPLINAS.map((d) => {
              const existe = disponiveis.some((m) => m.sigla === d)
              return (
                <li key={d}>
                  <button
                    type="button"
                    className="chip"
                    disabled={!existe}
                    aria-pressed={existe ? ativos.has(d) : undefined}
                    onClick={() => alternar(d)}
                  >
                    {d}
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </EstadoConsulta>
  )
}
