import { useQuery } from '@tanstack/react-query'
import { lazy, Suspense, useCallback, useMemo } from 'react'
import { Link } from 'react-router'
import { useRepositorio } from '../dados/contexto.tsx'
import { modeloComCache } from '../modelo/cacheModelo.ts'
import type { ModeloFrag } from '../modelo/modelos.ts'
import { IconeChevron, IconeCubo } from './Icones.tsx'

// Three.js e That Open ficam fora do pacote inicial, como na tela Modelo.
const VisualizadorModelo = lazy(() => import('../modelo/VisualizadorModelo.tsx'))

const SO_ARQ: ReadonlySet<string> = new Set(['ARQ'])

/**
 * Prévia da tela da obra: o modelo 3D só com a ARQ (cache no aparelho), em um quadro de altura fixa
 * que leva ao visualizador. Sem modelo ARQ, com erro ou ainda listando, vale o cartão de link.
 */
export function PreviaModelo({ slug }: { slug: string }) {
  const repo = useRepositorio()
  const destino = `/obras/${slug}/modelo`
  const modelos = useQuery({
    queryKey: ['modelos', slug],
    queryFn: () => repo.listarModelos(slug),
  })
  const arq = useMemo(() => (modelos.data ?? []).filter((m) => m.sigla === 'ARQ'), [modelos.data])
  const baixar = useCallback(
    (m: ModeloFrag) => modeloComCache(`${slug}/${m.sigla}@${m.hash}`, () => repo.baixarModelo(slug, m)),
    [repo, slug],
  )

  if (arq.length === 0) {
    return (
      <Link className="cartao-modelo" to={destino}>
        <span className="cartao-modelo-icone">
          <IconeCubo tamanho={32} />
        </span>
        <span className="cartao-modelo-texto">Visualizar modelo federado</span>
        <IconeChevron />
      </Link>
    )
  }

  return (
    <Link className="previa-modelo" to={destino} aria-label="Abrir modelo federado">
      <Suspense fallback={null}>
        <VisualizadorModelo modelos={arq} baixar={baixar} ativos={SO_ARQ} previa />
      </Suspense>
      <span className="previa-modelo-rotulo" aria-hidden="true">
        Modelo federado ›
      </span>
    </Link>
  )
}
