import { lazy, Suspense, useCallback, useMemo } from 'react'
import { Link, useParams } from 'react-router'
import { EstadoCarregando, EstadoConsulta } from '@shared/ui/feedback/Estado.tsx'
import { IconeCubo } from '@shared/ui/icones/Icones.tsx'
import { TopoTela } from '@shared/ui/layout/TopoTela.tsx'
import { useRepositorio } from '../../../../dados/contexto.tsx'
import { useAmbiente, useGeometria, useModelos } from '../../../../dados/hooks.ts'
import type { AmbienteDetalhe } from '../../../../dados/tipos.ts'
import { modeloComCache } from '@modules/modelos/infra/cacheModelo.ts'
import type { ModeloFrag } from '@modules/modelos/domain/modelos.ts'

// Three.js e That Open ficam fora do pacote inicial.
const VisualizadorModelo = lazy(() => import('@modules/modelos/presentation/miniapp/VisualizadorModelo.tsx'))

export default function AmbienteModelo() {
  const { slug = '', codigo = '' } = useParams()
  const consulta = useAmbiente(slug, codigo)
  return (
    <EstadoConsulta consulta={consulta} topo={<TopoTela titulo="Modelo do ambiente" />}>
      {(detalhe) => <Carregado detalhe={detalhe} />}
    </EstadoConsulta>
  )
}

function Carregado({ detalhe }: { detalhe: AmbienteDetalhe }) {
  const { obra, ambiente } = detalhe
  const repo = useRepositorio()
  const geometria = useGeometria(obra, ambiente)
  const modelos = useModelos(obra.slug)
  const baixar = useCallback(
    (m: ModeloFrag) => modeloComCache(`${obra.slug}/${m.sigla}@${m.hash}`, () => repo.baixarModelo(obra.slug, m)),
    [repo, obra.slug],
  )
  const ativos = useMemo(() => new Set((modelos.data ?? []).map((m) => m.sigla)), [modelos.data])
  // O visualizador só reage a mudança de identidade: memoizar evita recriar o motor a cada render.
  const geom = useMemo(() => geometria.data ?? undefined, [geometria.data])
  const carregando = geometria.isPending || modelos.isPending
  const pronto = Boolean(geom) && (modelos.data?.length ?? 0) > 0

  return (
    <section aria-labelledby="titulo-ambiente-modelo">
      <TopoTela
        titulo="Modelo do ambiente"
        idTitulo="titulo-ambiente-modelo"
        subtitulo={<Link to={`/obras/${obra.slug}/ambientes/${ambiente.codigo}`}>{ambiente.nome_operacional}</Link>}
      />
      {carregando ? (
        <EstadoCarregando />
      ) : pronto ? (
        <Suspense fallback={<EstadoCarregando />}>
          <VisualizadorModelo modelos={modelos.data ?? []} baixar={baixar} ativos={ativos} ambiente={geom} />
        </Suspense>
      ) : (
        <div className="cartao-info">
          <span className="cartao-info-icone">
            <IconeCubo tamanho={28} />
          </span>
          <p>Este ambiente não tem modelo 3D disponível.</p>
        </div>
      )}
    </section>
  )
}
