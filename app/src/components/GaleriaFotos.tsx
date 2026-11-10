import { useState } from 'react'
import { useUrlsImagens } from '../dados/hooks.ts'
import type { FotoRegistro } from '../dados/tipos.ts'
import { VisualizadorFotos } from './VisualizadorFotos.tsx'

/** A primeira foto grande e as demais em miniatura; o toque abre o visualizador nessa foto. */
export function GaleriaFotos({ fotos, rotulo }: { fotos: FotoRegistro[]; rotulo: string }) {
  const [aberta, setAberta] = useState<number | null>(null)
  const urls = useUrlsImagens(
    fotos.map((f) => f.path),
    'fotos',
  )
  if (fotos.length === 0) return null
  const [principal, ...outras] = fotos
  return (
    <div className="galeria">
      <button
        type="button"
        className="galeria-principal"
        aria-label={`Abrir foto 1 de ${fotos.length}: ${rotulo}`}
        onClick={() => setAberta(0)}
      >
        {urls.data?.[principal.path] && <img src={urls.data[principal.path]} alt="" />}
      </button>
      {outras.length > 0 && (
        <ul className="galeria-miniaturas">
          {outras.map((f, i) => (
            <li key={f.id}>
              <button
                type="button"
                className="galeria-miniatura"
                aria-label={`Abrir foto ${i + 2} de ${fotos.length}: ${rotulo}`}
                onClick={() => setAberta(i + 1)}
              >
                {urls.data?.[f.path] && <img src={urls.data[f.path]} alt="" loading="lazy" />}
              </button>
            </li>
          ))}
        </ul>
      )}
      {aberta !== null && (
        <VisualizadorFotos
          rotulo={rotulo}
          indiceInicial={aberta}
          onFechar={() => setAberta(null)}
          fotos={fotos.map((f) => ({
            id: f.id,
            url: urls.data?.[f.path],
            largura: f.largura,
            altura: f.altura,
          }))}
        />
      )}
    </div>
  )
}
