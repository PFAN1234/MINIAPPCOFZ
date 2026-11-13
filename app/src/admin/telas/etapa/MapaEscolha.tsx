/**
 * Mapa do cadastro da etapa (Leaflet, carregado sob demanda): tocar ou clicar marca o local da
 * obra e devolve a latitude e a longitude. Camadas "Mapa" (OpenStreetMap) e "Satélite" (Esri).
 * Nos testes este módulo é substituído por um falso (jsdom não desenha mapas).
 */
import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

/** Centro de Fortaleza, quando a etapa ainda não tem coordenadas. */
const CENTRO_PADRAO: L.LatLngTuple = [-3.7604, -38.5276]

const seisCasas = (n: number) => Math.round(n * 1e6) / 1e6

interface Props {
  ponto: { latitude: number; longitude: number } | null
  aoEscolher: (latitude: number, longitude: number) => void
}

export default function MapaEscolha({ ponto, aoEscolher }: Props) {
  const caixa = useRef<HTMLDivElement>(null)
  const mapa = useRef<L.Map | null>(null)
  const marca = useRef<L.CircleMarker | null>(null)
  const retorno = useRef(aoEscolher)
  const inicial = useRef(ponto)

  useEffect(() => {
    retorno.current = aoEscolher
  }, [aoEscolher])

  useEffect(() => {
    if (!caixa.current) return
    const p = inicial.current
    const m = L.map(caixa.current, {
      center: p ? [p.latitude, p.longitude] : CENTRO_PADRAO,
      zoom: p ? 17 : 13,
      zoomControl: true,
    })
    const ruas = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    })
    const satelite = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 19, attribution: 'Imagens © Esri' },
    )
    ruas.addTo(m)
    L.control.layers({ Mapa: ruas, 'Satélite': satelite }, undefined, { collapsed: false }).addTo(m)
    m.on('click', (e: L.LeafletMouseEvent) => retorno.current(seisCasas(e.latlng.lat), seisCasas(e.latlng.lng)))
    mapa.current = m
    return () => {
      m.remove()
      mapa.current = null
      marca.current = null
    }
  }, [])

  useEffect(() => {
    const m = mapa.current
    if (!m) return
    if (!ponto) {
      marca.current?.remove()
      marca.current = null
      return
    }
    const onde: L.LatLngTuple = [ponto.latitude, ponto.longitude]
    if (marca.current) marca.current.setLatLng(onde)
    else
      marca.current = L.circleMarker(onde, {
        radius: 9,
        color: '#ffffff',
        weight: 3,
        fillColor: '#d6336c',
        fillOpacity: 1,
      }).addTo(m)
    if (!m.getBounds().contains(onde)) m.setView(onde, Math.max(m.getZoom(), 16))
  }, [ponto])

  return (
    <div
      ref={caixa}
      className="adm-mapa-escolha"
      role="application"
      aria-label="Mapa: toque no local da obra para preencher a latitude e a longitude"
    />
  )
}
