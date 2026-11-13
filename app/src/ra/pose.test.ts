import { Matrix4, Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import {
  cantoNoMundo,
  qrEDoAmbiente,
  qrNoMundo,
  caixaDeCorte,
  comprimentoDaParede,
  type GeometriaAmbiente,
} from './geometria.ts'
import { orientacaoFixa, quaternionDoAparelho } from './orientacao.ts'
import {
  erroDoToque,
  normalizarAngulo,
  projetar,
  resolverPorCantos,
  resolverPorQr,
  type LeituraQr,
  type Ponto2,
  type Pose,
  type Toque,
} from './pose.ts'

const FOV = 60
const ASPECTO = 9 / 16

/** Apto. 101: 6,03 × 3,96 m, girado como no modelo. */
function ambiente(): GeometriaAmbiente {
  const g = 0.3
  const girar = ([x, z]: Ponto2): Ponto2 => [
    10 + x * Math.cos(g) + z * Math.sin(g),
    -20 - x * Math.sin(g) + z * Math.cos(g),
  ]
  return {
    contorno: ([[0, 0], [6.03, 0], [6.03, 3.96], [0, 3.96]] as Ponto2[]).map(girar),
    yPiso: -0.805,
    yTeto: 1.795,
    qr: { parede: 1, distancia_m: 1.2, altura_m: 1.5, lado_m: 0.18 },
    referencial: null,
    matrizes: {},
  }
}

/** Câmera no sensor apontada para um ponto do mundo (dado o rumo verdadeiro). */
function olharPara(pose: Pose, alvo: Vector3, rolagem = 0): Quaternion {
  const noSensor = alvo.clone().sub(pose.posicao).applyAxisAngle(new Vector3(0, 1, 0), -pose.rumo)
  const frente = noSensor.normalize()
  const direita = new Vector3().crossVectors(frente, new Vector3(0, 1, 0)).normalize()
  const cima = new Vector3().crossVectors(direita, frente)
  const q = new Quaternion().setFromRotationMatrix(
    new Matrix4().makeBasis(direita, cima, frente.clone().negate()),
  )
  return q.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), rolagem)).normalize()
}

function toque(pose: Pose, alvo: Vector3, mira: Vector3, fov = FOV): Toque {
  const q = olharPara(pose, mira, 0.05)
  const ndc = projetar(pose, q, alvo, fov, ASPECTO)
  if (!ndc) throw new Error('alvo atrás da câmera')
  return { ndc, q, alvo }
}

const verdadeira: Pose = { posicao: new Vector3(12.4, 0.72, -19.1), rumo: 2.1 }

describe('resolverPorCantos', () => {
  const g = ambiente()

  it('recupera a pose com dois cantos do piso', () => {
    const a = toque(verdadeira, cantoNoMundo(g, 1, 'piso'), cantoNoMundo(g, 1, 'piso').add(new Vector3(0.2, 0.3, 0)))
    const b = toque(verdadeira, cantoNoMundo(g, 2, 'piso'), cantoNoMundo(g, 2, 'piso').add(new Vector3(-0.1, 0.4, 0.1)))
    const pose = resolverPorCantos(a, b, FOV, ASPECTO)!
    expect(pose.posicao.distanceTo(verdadeira.posicao)).toBeLessThan(0.01)
    expect(Math.abs(normalizarAngulo(pose.rumo - verdadeira.rumo))).toBeLessThan((0.5 * Math.PI) / 180)
  })

  it('recupera a pose com dois cantos do teto', () => {
    const a = toque(verdadeira, cantoNoMundo(g, 0, 'teto'), cantoNoMundo(g, 0, 'teto'))
    const b = toque(verdadeira, cantoNoMundo(g, 3, 'teto'), cantoNoMundo(g, 3, 'teto'))
    const pose = resolverPorCantos(a, b, FOV, ASPECTO, g.yPiso + 1.5)!
    expect(pose.posicao.distanceTo(verdadeira.posicao)).toBeLessThan(0.01)
  })

  it('aceita um canto no piso e outro no teto', () => {
    const a = toque(verdadeira, cantoNoMundo(g, 1, 'piso'), cantoNoMundo(g, 1, 'piso'))
    const b = toque(verdadeira, cantoNoMundo(g, 2, 'teto'), cantoNoMundo(g, 2, 'teto'))
    const pose = resolverPorCantos(a, b, FOV, ASPECTO, g.yPiso + 1.5)!
    expect(pose.posicao.distanceTo(verdadeira.posicao)).toBeLessThan(0.01)
  })

  it('o terceiro canto acusa o ângulo de visão errado e some com o ajuste', () => {
    const cantos = [1, 2, 0].map((i) =>
      toque(verdadeira, cantoNoMundo(g, i, 'piso'), cantoNoMundo(g, i, 'piso').add(new Vector3(0.5, 0.7, 0.3))),
    )
    const errada = resolverPorCantos(cantos[0], cantos[1], FOV * 1.1, ASPECTO)!
    expect(erroDoToque(errada, cantos[2], FOV * 1.1, ASPECTO)!).toBeGreaterThan(0.02)
    const certa = resolverPorCantos(cantos[0], cantos[1], FOV, ASPECTO)!
    expect(erroDoToque(certa, cantos[2], FOV, ASPECTO)!).toBeLessThan(0.01)
  })

  it('recusa toque na linha do horizonte e cantos coincidentes', () => {
    const a = toque(verdadeira, cantoNoMundo(g, 1, 'piso'), cantoNoMundo(g, 1, 'piso'))
    const horizonte: Toque = { ndc: [0, 0], q: orientacaoFixa(), alvo: cantoNoMundo(g, 2, 'piso') }
    expect(resolverPorCantos(a, horizonte, FOV, ASPECTO)).toBeNull()
    expect(resolverPorCantos(a, { ...a }, FOV, ASPECTO)).toBeNull()
  })
})

describe('resolverPorQr', () => {
  it('recupera a pose a 2 m do QR', () => {
    const g = ambiente()
    const qr = qrNoMundo(g)!
    // Dentro do ambiente, a 2 m da parede, um pouco de lado.
    const centroide = new Vector3(
      g.contorno.reduce((t, p) => t + p[0] / 4, 0),
      0,
      g.contorno.reduce((t, p) => t + p[1] / 4, 0),
    )
    const paraDentro = new Vector3(0, 1, 0).cross(qr.direita)
    if (paraDentro.dot(centroide.clone().sub(qr.centro).setY(0)) < 0) paraDentro.negate()
    const pose: Pose = {
      posicao: qr.centro.clone().addScaledVector(paraDentro, 2).addScaledVector(qr.direita, 0.4).setY(g.yPiso + 1.45),
      rumo: -0.7,
    }
    const q = olharPara(pose, qr.centro, 0.02)
    const m = qr.lado / 2
    const cima = new Vector3(0, m, 0)
    const lado = qr.direita.clone().multiplyScalar(m)
    const mundo = [
      qr.centro.clone().sub(lado).add(cima),
      qr.centro.clone().add(lado).add(cima),
      qr.centro.clone().add(lado).sub(cima),
      qr.centro.clone().sub(lado).sub(cima),
    ]
    const leitura: LeituraQr = { cantos: mundo.map((p) => projetar(pose, q, p, FOV, ASPECTO)!) as LeituraQr['cantos'], q }
    const achada = resolverPorQr(leitura, qr, FOV, ASPECTO)!
    expect(achada.posicao.distanceTo(pose.posicao)).toBeLessThan(0.01)
    expect(Math.abs(normalizarAngulo(achada.rumo - pose.rumo))).toBeLessThan((0.5 * Math.PI) / 180)
  })
})

describe('geometria', () => {
  const g = ambiente()

  it('mede as paredes e monta a caixa de corte com margem', () => {
    expect(comprimentoDaParede(g.contorno, 0)).toBeCloseTo(6.03, 6)
    expect(comprimentoDaParede(g.contorno, 3)).toBeCloseTo(3.96, 6)
    const caixa = caixaDeCorte(g)
    expect(caixa[1]).toBeCloseTo(g.yPiso - 0.3, 6)
    expect(caixa[4]).toBeCloseTo(g.yTeto + 0.8, 6)
  })

  it('põe o QR na parede, na altura cadastrada, virado para dentro', () => {
    const qr = qrNoMundo(g)!
    expect(qr.centro.y).toBeCloseTo(g.yPiso + 1.5, 6)
    const centroide = g.contorno.reduce((s, p) => [s[0] + p[0] / 4, s[1] + p[1] / 4] as Ponto2, [0, 0] as Ponto2)
    // Quem está no centro do ambiente olhando para o QR vê `direita` à sua direita.
    const frente = new Vector3(qr.centro.x - centroide[0], 0, qr.centro.z - centroide[1]).normalize()
    const direitaEsperada = frente.clone().cross(new Vector3(0, 1, 0))
    expect(qr.direita.dot(direitaEsperada)).toBeGreaterThan(0.5)
  })

  it('reconhece o QR do ambiente pelo link ou pelo parâmetro', () => {
    expect(qrEDoAmbiente('https://t.me/bot/app?startapp=amb_hto_apto-101', 'hto', 'apto-101')).toBe(true)
    expect(qrEDoAmbiente('amb_hto_apto-101', 'hto', 'apto-101')).toBe(true)
    expect(qrEDoAmbiente('https://t.me/bot/app?startapp=amb_hto_apto-102', 'hto', 'apto-101')).toBe(false)
  })
})

describe('quaternionDoAparelho', () => {
  it('aparelho em pé olha para o horizonte, com o topo para cima', () => {
    const q = quaternionDoAparelho(0, Math.PI / 2, 0, 0)
    const frente = new Vector3(0, 0, -1).applyQuaternion(q)
    const cima = new Vector3(0, 1, 0).applyQuaternion(q)
    expect(frente.y).toBeCloseTo(0, 6)
    expect(cima.y).toBeCloseTo(1, 6)
  })

  it('aparelho deitado com a tela para cima olha para o chão', () => {
    const frente = new Vector3(0, 0, -1).applyQuaternion(quaternionDoAparelho(0, 0, 0, 0))
    expect(frente.y).toBeCloseTo(-1, 6)
  })
})
