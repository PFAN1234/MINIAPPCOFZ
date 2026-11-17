import * as THREE from 'three'

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
