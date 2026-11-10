import { useState } from 'react'
import { useUrlsImagens } from '../dados/hooks.ts'
import type { RegistroResumo } from '../dados/tipos.ts'
import { VisualizadorFotos } from './VisualizadorFotos.tsx'

/** Miniatura da primeira foto do registro, com "+N" quando houver mais; toca para abrir o visualizador. */
export function MiniaturaRegistro({
  registro,
  abrirInicial = false,
}: {
  registro: RegistroResumo
  /** Abre o visualizador assim que a miniatura aparece (link `startapp`). */
  abrirInicial?: boolean
}) {
  const [aberto, setAberto] = useState(abrirInicial)
  const fotos = registro.fotos
  const primeira = fotos[0]
  const miniatura = useUrlsImagens(primeira ? [primeira.path] : [], 'fotos')
  if (!primeira) return null
  const url = miniatura.data?.[primeira.path]
  const extras = fotos.length - 1
  const rotulo = `Fotos do registro: ${registro.legenda}`

  return (
    <>
      <button
        type="button"
        className="miniatura-registro"
        aria-label={`Abrir ${fotos.length === 1 ? '1 foto' : `${fotos.length} fotos`} do registro`}
        onClick={() => setAberto(true)}
      >
        {url && <img src={url} alt="" loading="lazy" />}
        {extras > 0 && (
          <span className="miniatura-extras" aria-hidden="true">
            +{extras}
          </span>
        )}
      </button>
      {aberto && (
        <Visualizador registro={registro} rotulo={rotulo} onFechar={() => setAberto(false)} />
      )}
    </>
  )
}

function Visualizador({
  registro,
  rotulo,
  onFechar,
}: {
  registro: RegistroResumo
  rotulo: string
  onFechar: () => void
}) {
  const urls = useUrlsImagens(
    registro.fotos.map((f) => f.path),
    'fotos',
  )
  return (
    <VisualizadorFotos
      rotulo={rotulo}
      indiceInicial={0}
      onFechar={onFechar}
      fotos={registro.fotos.map((f) => ({
        id: f.id,
        url: urls.data?.[f.path],
        largura: f.largura,
        altura: f.altura,
      }))}
    />
  )
}
