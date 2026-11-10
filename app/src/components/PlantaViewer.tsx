import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import { TransformComponent, TransformWrapper, type ReactZoomPanPinchRef } from 'react-zoom-pan-pinch'
import type { Marcador, RecortePt } from '../dados/tipos.ts'
import { marcadorParaPixel } from '../util/coordenadas.ts'
import { Pino } from './Pino.tsx'

export interface MarcadorPlanta {
  codigo: string
  nome: string
  /** Normalizados na página (0 a 1). */
  x: number
  y: number
  pendencias: number
}

export interface ImagemViewer {
  url: string
  largura: number
  altura: number
  recorte_pt: RecortePt
  pagina_pt: [number, number]
}

interface Props {
  imagem: ImagemViewer
  /** Versão em alta resolução (mesma geometria); usada acima de 2,5× de zoom. */
  imagemHd?: { url: string }
  marcadores: MarcadorPlanta[]
  focoCodigo?: string | null
  onSelecionar(codigo: string): void
}

const ZOOM_FOCO = 3
const ZOOM_HD = 2.5
const ZOOM_MAX = 8
const LIMITE_ARRASTE = 8

export function PlantaViewer({ imagem, imagemHd, marcadores, focoCodigo, onSelecionar }: Props) {
  const { largura, altura } = imagem
  const raiz = useRef<HTMLDivElement>(null)
  const api = useRef<ReactZoomPanPinchRef | null>(null)
  const [area, setArea] = useState<{ w: number; h: number } | null>(null)
  const [hd, setHd] = useState(false)
  const hdRef = useRef(false)
  const inicioToque = useRef<{ x: number; y: number } | null>(null)

  useLayoutEffect(() => {
    const el = raiz.current
    if (!el) return
    const medir = () => {
      const r = el.getBoundingClientRect()
      setArea((a) => (a && a.w === r.width && a.h === r.height ? a : { w: r.width, h: r.height }))
    }
    medir()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Ajuste "contain": imagem inteira visível na área disponível.
  const ajuste = area && area.w > 0 && area.h > 0 ? Math.min(area.w / largura, area.h / altura) : 1
  const ajusteRef = useRef(ajuste)

  const pixels = marcadores.map((m) => ({
    ...m,
    ...marcadorParaPixel({ x: m.x, y: m.y } satisfies Marcador, {
      pagina_pt: imagem.pagina_pt,
      recorte_pt: imagem.recorte_pt,
      largura,
      altura,
    }),
  }))
  const pixelsRef = useRef(pixels)
  useEffect(() => {
    ajusteRef.current = ajuste
    pixelsRef.current = pixels
  })

  const aplicarFoco = useCallback(
    (codigo: string | null | undefined, animacao: number) => {
      const ctx = api.current
      const el = raiz.current
      if (!ctx || !el || !codigo) return
      const alvo = pixelsRef.current.find((p) => p.codigo === codigo)
      if (!alvo) return
      const { width, height } = el.getBoundingClientRect()
      const escala = ajusteRef.current * ZOOM_FOCO
      ctx.setTransform(width / 2 - alvo.x * escala, height / 2 - alvo.y * escala, escala, animacao, 'easeOut')
    },
    [],
  )

  const aoTransformar = useCallback(
    (_: ReactZoomPanPinchRef, estado: { scale: number }) => {
      raiz.current?.style.setProperty('--inv', String(1 / estado.scale))
      const alta = estado.scale / ajusteRef.current > ZOOM_HD
      if (alta !== hdRef.current) {
        hdRef.current = alta
        setHd(alta)
      }
    },
    [],
  )

  const pronto = area !== null
  useEffect(() => {
    if (!pronto) return
    const t = setTimeout(() => aplicarFoco(focoCodigo, 300), 60)
    return () => clearTimeout(t)
  }, [focoCodigo, pronto, aplicarFoco])

  const aoBaixar = (e: PointerEvent<SVGGElement>) => {
    inicioToque.current = { x: e.clientX, y: e.clientY }
  }
  const selecionar = (codigo: string, e: { clientX: number; clientY: number } | null) => {
    const ini = inicioToque.current
    inicioToque.current = null
    if (e && ini && Math.hypot(e.clientX - ini.x, e.clientY - ini.y) > LIMITE_ARRASTE) return
    onSelecionar(codigo)
  }

  return (
    <div
      ref={raiz}
      className="planta-viewer"
      style={{ ['--inv' as string]: String(1 / ajuste) }}
    >
      {pronto && (
        <TransformWrapper
          key={`${largura}x${altura}`}
          ref={api}
          initialScale={ajuste}
          minScale={ajuste}
          maxScale={ajuste * ZOOM_MAX}
          centerOnInit
          limitToBounds
          doubleClick={{ disabled: true }}
          onTransform={aoTransformar}
          onInit={() => {
            // Depois do centerOnInit da biblioteca.
            setTimeout(() => aplicarFoco(focoCodigo, 0), 50)
          }}
        >
          <TransformComponent
            wrapperStyle={{ width: '100%', height: '100%' }}
            contentStyle={{ width: largura, height: altura }}
          >
            <div className="planta-conteudo" style={{ width: largura, height: altura }}>
              <img
                className="planta-img"
                src={imagem.url}
                width={largura}
                height={altura}
                alt="Planta do pavimento"
                draggable={false}
              />
              {hd && imagemHd && (
                <img
                  className="planta-img planta-img-hd"
                  src={imagemHd.url}
                  width={largura}
                  height={altura}
                  alt=""
                  draggable={false}
                />
              )}
              <svg
                className="planta-svg"
                viewBox={`0 0 ${largura} ${altura}`}
                width={largura}
                height={altura}
              >
                {pixels.map((p, i) => (
                  <Pino
                    key={`${p.codigo}-${i}`}
                    nome={p.nome}
                    x={p.x}
                    y={p.y}
                    pendencias={p.pendencias}
                    onPonteiroBaixo={aoBaixar}
                    onAtivar={(e) => selecionar(p.codigo, e)}
                  />
                ))}
              </svg>
            </div>
          </TransformComponent>
        </TransformWrapper>
      )}
    </div>
  )
}
