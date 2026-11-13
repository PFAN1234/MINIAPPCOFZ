/** Geometria do ambiente para a RA, no referencial do `ARQ.frag` (metros, Y para cima). */
import { Vector3 } from 'three'
import type { Ponto2, QrNoMundo } from './pose.ts'

export interface QrAmbiente {
  /** Aresta do contorno: do canto `parede` ao canto seguinte. */
  parede: number
  /** Do canto inicial da parede até o centro do QR (m). */
  distancia_m: number
  /** Centro do QR acima do piso acabado (m). */
  altura_m: number
  /** Lado do quadrado do QR (m). */
  lado_m: number
}

export interface GeometriaAmbiente {
  /** `[x, z]` de cada canto, sem repetir o primeiro. */
  contorno: Ponto2[]
  yPiso: number
  yTeto: number
  qr: QrAmbiente | null
  /** `getCoordinates()` do `.frag` de referência (ARQ) e sua sigla; null se não houver. */
  referencial: { sigla: string; coordenadas: number[] } | null
  /** Correção opcional por modelo (16 números de `Matrix4.elements`), por sigla. */
  matrizes: Record<string, number[]>
}

/** Margem em volta do ambiente para mostrar o que está embutido em parede, piso e forro. */
export const MARGEM_HORIZONTAL = 0.3
export const MARGEM_ABAIXO = 0.3
export const MARGEM_ACIMA = 0.8

export type Plano = 'piso' | 'teto'

export function cantoNoMundo(g: GeometriaAmbiente, indice: number, plano: Plano): Vector3 {
  const [x, z] = g.contorno[indice]
  return new Vector3(x, plano === 'piso' ? g.yPiso : g.yTeto, z)
}

/** Área com sinal do contorno no plano (x, z). */
export function areaComSinal(contorno: Ponto2[]): number {
  let s = 0
  for (let i = 0; i < contorno.length; i++) {
    const [x0, z0] = contorno[i]
    const [x1, z1] = contorno[(i + 1) % contorno.length]
    s += x0 * z1 - x1 * z0
  }
  return s / 2
}

export function comprimentoDaParede(contorno: Ponto2[], parede: number): number {
  const a = contorno[parede]
  const b = contorno[(parede + 1) % contorno.length]
  return Math.hypot(b[0] - a[0], b[1] - a[1])
}

/**
 * Posição do QR no mundo. Ele fica na face interna da parede; `direita` é a direção
 * horizontal da esquerda para a direita de quem está dentro do ambiente olhando para ele.
 */
export function qrNoMundo(g: GeometriaAmbiente): QrNoMundo | null {
  const qr = g.qr
  const n = g.contorno.length
  if (!qr || qr.parede < 0 || qr.parede >= n) return null
  const a = g.contorno[qr.parede]
  const b = g.contorno[(qr.parede + 1) % n]
  const comprimento = Math.hypot(b[0] - a[0], b[1] - a[1])
  if (comprimento < 1e-6) return null
  const ux = (b[0] - a[0]) / comprimento
  const uz = (b[1] - a[1]) / comprimento
  // Normal para dentro: à esquerda do sentido da aresta quando a área (x, z) é positiva.
  const sinal = areaComSinal(g.contorno) >= 0 ? 1 : -1
  const normal = new Vector3(-uz * sinal, 0, ux * sinal)
  // Quem olha para a parede olha ao longo de −normal; direita = frente × cima.
  const direita = normal.clone().negate().cross(new Vector3(0, 1, 0)).normalize()
  return {
    centro: new Vector3(a[0] + ux * qr.distancia_m, g.yPiso + qr.altura_m, a[1] + uz * qr.distancia_m),
    direita,
    lado: qr.lado_m,
  }
}

/** Caixa de corte em volta do ambiente: `[xmin, ymin, zmin, xmax, ymax, zmax]`. */
export function caixaDeCorte(g: GeometriaAmbiente): [number, number, number, number, number, number] {
  const xs = g.contorno.map((p) => p[0])
  const zs = g.contorno.map((p) => p[1])
  return [
    Math.min(...xs) - MARGEM_HORIZONTAL,
    g.yPiso - MARGEM_ABAIXO,
    Math.min(...zs) - MARGEM_HORIZONTAL,
    Math.max(...xs) + MARGEM_HORIZONTAL,
    g.yTeto + MARGEM_ACIMA,
    Math.max(...zs) + MARGEM_HORIZONTAL,
  ]
}

/** Pares de pontos das arestas do ambiente (piso, teto e cantos), para o contorno de conferência. */
export function arestasDoAmbiente(g: GeometriaAmbiente): number[] {
  const v: number[] = []
  const n = g.contorno.length
  for (let i = 0; i < n; i++) {
    const [x0, z0] = g.contorno[i]
    const [x1, z1] = g.contorno[(i + 1) % n]
    v.push(x0, g.yPiso, z0, x1, g.yPiso, z1)
    v.push(x0, g.yTeto, z0, x1, g.yTeto, z1)
    v.push(x0, g.yPiso, z0, x0, g.yTeto, z0)
  }
  return v
}

/** Conteúdo do QR do ambiente (parâmetro `startapp`). */
export function parametroDoAmbiente(slug: string, codigo: string): string {
  return `amb_${slug}_${codigo}`
}

/** O texto lido no QR é o deste ambiente? Aceita o link inteiro ou só o parâmetro. */
export function qrEDoAmbiente(texto: string, slug: string, codigo: string): boolean {
  const p = parametroDoAmbiente(slug, codigo)
  return texto === p || texto.endsWith(`startapp=${p}`)
}
