/** Geometria 3D do ambiente no referencial do `ARQ.frag` (metros, Y para cima). */
import { Vector3 } from 'three'
import { areaComSinal, comprimentoParede, MARGEM_ABAIXO, MARGEM_ACIMA, MARGEM_HORIZONTAL } from '../../domain/geometria.ts'
import type { GeometriaAmbiente } from '../../domain/tipos.ts'
import type { QrNoMundo } from './pose.ts'

export type Plano = 'piso' | 'teto'

export function cantoNoMundo(g: GeometriaAmbiente, indice: number, plano: Plano): Vector3 {
  const [x, z] = g.contorno[indice]
  return new Vector3(x, plano === 'piso' ? g.yPiso : g.yTeto, z)
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
  const comprimento = comprimentoParede(g.contorno, qr.parede)
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
