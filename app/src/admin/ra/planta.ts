import { comprimentoParede, type Ponto } from './geometria'

/** Planta do pavimento (imagem recortada) com as medidas para converter pontos da página em pixels. */
export interface PlantaAdmin {
  url: string
  pagina_pt: [number, number]
  recorte_pt: [number, number, number, number]
  largura: number
  altura: number
}

export interface PlantaEnquadrada {
  pontos: Ponto[]
  viewBox: string
  raio: number
}

/** Cantos do cômodo em pixels da planta e viewBox enquadrado (mesma fórmula do app, `plantaReal`). */
export function enquadrarPlanta(
  contorno: Ponto[],
  contornoPagina: Ponto[] | null,
  planta: PlantaAdmin | null,
): PlantaEnquadrada | null {
  if (!planta || !contornoPagina || contornoPagina.length === 0 || contornoPagina.length !== contorno.length) {
    return null
  }
  const [pw, ph] = planta.pagina_pt
  const [x0, y0, x1, y1] = planta.recorte_pt
  const pontos = contornoPagina.map(
    ([x, y]): Ponto => [((x * pw - x0) * planta.largura) / (x1 - x0), ((y * ph - y0) * planta.altura) / (y1 - y0)],
  )
  const xs = pontos.map((p) => p[0])
  const ys = pontos.map((p) => p[1])
  // Faixa de 30% do maior lado do cômodo, para reconhecer portas e vizinhos.
  const margem = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 0.3
  const vx = Math.min(...xs) - margem
  const vy = Math.min(...ys) - margem
  const l = Math.max(...xs) + margem - vx
  const a = Math.max(...ys) + margem - vy
  return { pontos, viewBox: `${vx} ${vy} ${l} ${a}`, raio: Math.max(l, a) * 0.035 }
}

/** Centro e extremos da marca do QR sobre a parede, em pixels da planta. */
export function marcaNaPlanta(
  contorno: Ponto[],
  pontos: Ponto[],
  qr: { parede: number; distancia_m: number; lado_m: number },
): { a: Ponto; b: Ponto; centro: Ponto } {
  const c = comprimentoParede(contorno, qr.parede)
  const f = c > 0 ? qr.distancia_m / c : 0
  const meio = c > 0 ? qr.lado_m / 2 / c : 0
  const p0 = pontos[qr.parede]
  const p1 = pontos[(qr.parede + 1) % pontos.length]
  const v: Ponto = [p1[0] - p0[0], p1[1] - p0[1]]
  const centro: Ponto = [p0[0] + f * v[0], p0[1] + f * v[1]]
  return {
    centro,
    a: [centro[0] - meio * v[0], centro[1] - meio * v[1]],
    b: [centro[0] + meio * v[0], centro[1] + meio * v[1]],
  }
}
