/**
 * Malhas de linhas para a RA (puro, sem DOM). A malha do ambiente mostra onde o sistema
 * acha que estão piso, paredes e teto; ela não vem de leitura da câmera.
 */
import { ShapeUtils, Vector2 } from 'three'
import type { GeometriaAmbiente } from './geometria.ts'

export interface MalhaDoAmbiente {
  piso: number[]
  paredes: number[]
  teto: number[]
}

type P3 = [number, number, number]

/** Acumula segmentos sem repetir (nem na ordem inversa). */
class Segmentos {
  readonly v: number[] = []
  private readonly vistos = new Set<string>()

  private chave(p: P3): string {
    return p.map((n) => Math.round(n * 1e4)).join(',')
  }

  adicionar(a: P3, b: P3): void {
    const ka = this.chave(a)
    const kb = this.chave(b)
    if (ka === kb) return
    const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
    if (this.vistos.has(k)) return
    this.vistos.add(k)
    this.v.push(...a, ...b)
  }
}

const meio = (a: P3, b: P3): P3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
const distancia = (a: P3, b: P3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

function subdividir(a: P3, b: P3, c: P3, passo: number, saida: Segmentos): void {
  if (Math.max(distancia(a, b), distancia(b, c), distancia(c, a)) <= passo + 1e-9) {
    saida.adicionar(a, b)
    saida.adicionar(b, c)
    saida.adicionar(c, a)
    return
  }
  const ab = meio(a, b)
  const bc = meio(b, c)
  const ca = meio(c, a)
  subdividir(a, ab, ca, passo, saida)
  subdividir(ab, b, bc, passo, saida)
  subdividir(ca, bc, c, passo, saida)
  subdividir(ab, bc, ca, passo, saida)
}

function poligonoTriangulado(contorno: [number, number][], y: number, passo: number): number[] {
  const saida = new Segmentos()
  if (contorno.length < 3) return saida.v
  const pontos = contorno.map(([x, z]) => new Vector2(x, z))
  for (const [i, j, k] of ShapeUtils.triangulateShape(pontos, [])) {
    const t = [i, j, k].map((n): P3 => [contorno[n][0], y, contorno[n][1]])
    subdividir(t[0], t[1], t[2], passo, saida)
  }
  return saida.v
}

function parede(
  a: [number, number],
  b: [number, number],
  yPiso: number,
  yTeto: number,
  passo: number,
  saida: Segmentos,
): void {
  // A diagonal também respeita o passo: lados das células ≤ passo / √2.
  const lado = passo / Math.SQRT2
  const comprimento = Math.hypot(b[0] - a[0], b[1] - a[1])
  const colunas = Math.max(1, Math.ceil(comprimento / lado - 1e-9))
  const linhas = Math.max(1, Math.ceil((yTeto - yPiso) / lado - 1e-9))
  const ponto = (c: number, l: number): P3 => {
    const t = c / colunas
    return [a[0] + (b[0] - a[0]) * t, yPiso + ((yTeto - yPiso) * l) / linhas, a[1] + (b[1] - a[1]) * t]
  }
  for (let c = 0; c < colunas; c++) {
    for (let l = 0; l < linhas; l++) {
      saida.adicionar(ponto(c, l), ponto(c + 1, l))
      saida.adicionar(ponto(c, l), ponto(c, l + 1))
      saida.adicionar(ponto(c + 1, l), ponto(c + 1, l + 1))
      saida.adicionar(ponto(c, l + 1), ponto(c + 1, l + 1))
      saida.adicionar(ponto(c, l), ponto(c + 1, l + 1))
    }
  }
}

/** Pares de pontos (x, y, z, x, y, z) dos segmentos da malha do piso, das paredes e do teto. */
export function malhaDoAmbiente(g: GeometriaAmbiente, passo = 0.5): MalhaDoAmbiente {
  const paredes = new Segmentos()
  const n = g.contorno.length
  for (let i = 0; i < n; i++) parede(g.contorno[i], g.contorno[(i + 1) % n], g.yPiso, g.yTeto, passo, paredes)
  return {
    piso: poligonoTriangulado(g.contorno, g.yPiso, passo),
    paredes: paredes.v,
    teto: poligonoTriangulado(g.contorno, g.yTeto, passo),
  }
}

/** Malha triangular equilátera num disco no plano y = 0, em volta da origem. */
export function gradeDeProcura(raio = 3, passo = 0.5): number[] {
  const saida = new Segmentos()
  const altura = (passo * Math.sqrt(3)) / 2
  const dentro = (i: number, j: number) => Math.hypot(i * passo + (j * passo) / 2, j * altura) <= raio + 1e-9
  const ponto = (i: number, j: number): P3 => [i * passo + (j * passo) / 2, 0, j * altura]
  const m = Math.ceil(raio / passo) * 2 + 2
  const direcoes = [
    [1, 0],
    [0, 1],
    [-1, 1],
  ]
  for (let j = -m; j <= m; j++) {
    for (let i = -m; i <= m; i++) {
      if (!dentro(i, j)) continue
      for (const [di, dj] of direcoes) {
        if (dentro(i + di, j + dj)) saida.adicionar(ponto(i, j), ponto(i + di, j + dj))
      }
    }
  }
  return saida.v
}
