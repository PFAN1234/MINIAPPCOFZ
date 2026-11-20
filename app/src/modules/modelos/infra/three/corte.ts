import * as THREE from 'three'
import type { GeometriaAmbiente } from '@modules/ra/domain/tipos.ts'

/** Seis planos de corte (mesma ordem/sinais do motor RA) para a caixa [xmin,ymin,zmin,xmax,ymax,zmax]. */
export function planosDeCorte(caixa: readonly number[]): THREE.Plane[] {
  const [x0, y0, z0, x1, y1, z1] = caixa
  return [
    new THREE.Plane(new THREE.Vector3(1, 0, 0), -x0),
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), x1),
    new THREE.Plane(new THREE.Vector3(0, 1, 0), -y0),
    new THREE.Plane(new THREE.Vector3(0, -1, 0), y1),
    new THREE.Plane(new THREE.Vector3(0, 0, 1), -z0),
    new THREE.Plane(new THREE.Vector3(0, 0, -1), z1),
  ]
}

export function caixaBox3(caixa: readonly number[]): THREE.Box3 {
  const [x0, y0, z0, x1, y1, z1] = caixa
  return new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1))
}

/** Altura dos olhos acima do piso, em metros. */
const ALTURA_OLHOS = 1.5

/**
 * Onde a câmera interna nasce: centroide do contorno, na altura dos olhos (limitada ao teto).
 * shortcut: centroide de ambiente em L pode cair fora do contorno, trocar por ponto interno se acontecer.
 */
export function posicaoInterna(g: Pick<GeometriaAmbiente, 'contorno' | 'yPiso' | 'yTeto'>): THREE.Vector3 {
  const n = g.contorno.length || 1
  const x = g.contorno.reduce((s, p) => s + p[0], 0) / n
  const z = g.contorno.reduce((s, p) => s + p[1], 0) / n
  return new THREE.Vector3(x, Math.min(g.yPiso + ALTURA_OLHOS, g.yTeto - 0.2), z)
}
