import { useUrlsImagens } from '../dados/hooks.ts'
import type { AmbienteDetalhe } from '../dados/tipos.ts'
import { marcadorParaPixel } from '../util/coordenadas.ts'
import { Pino } from './Pino.tsx'

interface Props {
  detalhe: AmbienteDetalhe
  onAbrirPlanta(): void
}

export function OndeFica({ detalhe, onAbrirPlanta }: Props) {
  const { ambiente, pavimento, planta, detalhe: det } = detalhe
  const urls = useUrlsImagens(det ? [det.imagem.path] : [])
  if (!det || !planta) return null
  const { largura, altura } = det.imagem
  const url = urls.data?.[det.imagem.path]
  const ref = { pagina_pt: planta.pagina_pt, recorte_pt: det.recorte_pt, largura, altura }
  return (
    <button type="button" className="onde-fica" onClick={onAbrirPlanta}>
      <span className="onde-fica-cab">
        <span className="onde-fica-titulo">Onde fica</span>
        <span className="onde-fica-pav">{pavimento.nome}</span>
      </span>
      <span className="onde-fica-mapa" style={{ aspectRatio: `${largura} / ${altura}` }}>
        {url ? (
          <img src={url} alt={`Recorte da planta com a posição de ${ambiente.nome_operacional}`} />
        ) : (
          <span className="onde-fica-carregando" />
        )}
        <svg
          viewBox={`0 0 ${largura} ${altura}`}
          style={{ ['--inv' as string]: String(largura / 320) }}
          aria-hidden="true"
        >
          {ambiente.marcadores.map((m, i) => {
            const p = marcadorParaPixel(m, ref)
            return <Pino key={i} nome={ambiente.nome_operacional} x={p.x} y={p.y} decorativo />
          })}
        </svg>
      </span>
      <span className="onde-fica-acao">Ver na planta</span>
    </button>
  )
}
