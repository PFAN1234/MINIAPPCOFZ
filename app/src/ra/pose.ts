/**
 * Conta do alinhamento da RA (pura, sem DOM).
 *
 * Referenciais:
 * - mundo: o do `ARQ.frag` (Three.js, metros, Y para cima);
 * - sensor: Y para cima (gravidade) e rumo arbitrário; é onde o giroscópio entrega a
 *   orientação da câmera (`q` leva vetores da câmera, que olha para −Z, ao sensor);
 * - mundo = RotY(rumo) · sensor + posição. Alinhar é achar `rumo` e `posicao`.
 */
import { Quaternion, Vector3 } from 'three'

export type Ponto2 = [number, number]

export interface Pose {
  /** Posição da câmera no mundo. */
  posicao: Vector3
  /** Rotação em torno de Y (rad) que leva o referencial do sensor ao mundo. */
  rumo: number
}

/** Um toque na tela: onde, com que orientação do aparelho e a que ponto do mundo corresponde. */
export interface Toque {
  /** Coordenadas normalizadas da tela (−1 a 1, x para a direita, y para cima). */
  ndc: Ponto2
  /** Orientação da câmera no referencial do sensor no instante do toque. */
  q: Quaternion
  /** Ponto do mundo tocado (canto no piso ou no teto). */
  alvo: Vector3
}

/** QR visto na imagem: os quatro cantos e a orientação do aparelho naquele quadro. */
export interface LeituraQr {
  /** Cantos em NDC, na ordem: superior esquerdo, superior direito, inferior direito, inferior esquerdo. */
  cantos: [Ponto2, Ponto2, Ponto2, Ponto2]
  q: Quaternion
}

/** QR no mundo: centro, direção horizontal (da esquerda para a direita de quem olha) e lado. */
export interface QrNoMundo {
  centro: Vector3
  direita: Vector3
  lado: number
}

const Y = new Vector3(0, 1, 0)
const MINIMO_INCLINACAO = 0.03

/** Direção (no sensor, não normalizada) do raio que passa pelo ponto `ndc` da tela. */
export function raioNoSensor(ndc: Ponto2, q: Quaternion, fovGraus: number, aspecto: number): Vector3 {
  const t = Math.tan((fovGraus * Math.PI) / 360)
  return new Vector3(ndc[0] * t * aspecto, ndc[1] * t, -1).applyQuaternion(q)
}

/** Ângulo de um vetor horizontal no sentido da rotação em torno de Y do Three.js. */
function angulo(x: number, z: number): number {
  return Math.atan2(x, z)
}

function girarY(v: Vector3, rumo: number): Vector3 {
  return v.clone().applyAxisAngle(Y, rumo)
}

export function normalizarAngulo(a: number): number {
  const d = 2 * Math.PI
  return ((((a + Math.PI) % d) + d) % d) - Math.PI
}

/** Rumo e posição a partir de dois pontos conhecidos no sensor (relativos à câmera) e no mundo. */
function poseDeDoisPontos(s1: Vector3, s2: Vector3, m1: Vector3, m2: Vector3): Pose | null {
  const ds = s2.clone().sub(s1)
  const dm = m2.clone().sub(m1)
  if (Math.hypot(ds.x, ds.z) < 1e-6 || Math.hypot(dm.x, dm.z) < 1e-6) return null
  const rumo = normalizarAngulo(angulo(dm.x, dm.z) - angulo(ds.x, ds.z))
  const p1 = m1.clone().sub(girarY(s1, rumo))
  const p2 = m2.clone().sub(girarY(s2, rumo))
  return { posicao: p1.add(p2).multiplyScalar(0.5), rumo }
}

/**
 * Alinhamento por dois cantos. Cada canto pode estar no piso ou no teto. A distância
 * conhecida entre os cantos fixa a altura da câmera; os dois pontos fixam rumo e posição.
 * `alturaEsperada` (Y do mundo) desempata quando há duas soluções válidas.
 */
export function resolverPorCantos(
  a: Toque,
  b: Toque,
  fovGraus: number,
  aspecto: number,
  alturaEsperada?: number,
): Pose | null {
  const da = raioNoSensor(a.ndc, a.q, fovGraus, aspecto)
  const db = raioNoSensor(b.ndc, b.q, fovGraus, aspecto)
  if (Math.abs(da.y) < MINIMO_INCLINACAO * da.length() || Math.abs(db.y) < MINIMO_INCLINACAO * db.length()) {
    return null
  }
  // Ponto i no sensor: (alvo_i.y − c) · g_i na horizontal, com c = altura da câmera.
  const ga: Ponto2 = [da.x / da.y, da.z / da.y]
  const gb: Ponto2 = [db.x / db.y, db.z / db.y]
  const D = Math.hypot(b.alvo.x - a.alvo.x, b.alvo.z - a.alvo.z)
  if (D < 0.2) return null
  // |A − c·B|² = D², com A = yb·gb − ya·ga e B = gb − ga.
  const A: Ponto2 = [b.alvo.y * gb[0] - a.alvo.y * ga[0], b.alvo.y * gb[1] - a.alvo.y * ga[1]]
  const B: Ponto2 = [gb[0] - ga[0], gb[1] - ga[1]]
  const qa = B[0] * B[0] + B[1] * B[1]
  const qb = -2 * (A[0] * B[0] + A[1] * B[1])
  const qc = A[0] * A[0] + A[1] * A[1] - D * D
  if (qa < 1e-9) return null
  const delta = qb * qb - 4 * qa * qc
  if (delta < 0) return null
  const raiz = Math.sqrt(delta)
  const candidatos = [(-qb + raiz) / (2 * qa), (-qb - raiz) / (2 * qa)]
    .filter((c) => (a.alvo.y - c) / da.y > 0 && (b.alvo.y - c) / db.y > 0)
    .sort((x, y) =>
      alturaEsperada === undefined ? 0 : Math.abs(x - alturaEsperada) - Math.abs(y - alturaEsperada),
    )
  if (candidatos.length === 0) return null
  const c = candidatos[0]
  const sa = da.clone().multiplyScalar((a.alvo.y - c) / da.y)
  const sb = db.clone().multiplyScalar((b.alvo.y - c) / db.y)
  return poseDeDoisPontos(sa, sb, a.alvo, b.alvo)
}

/** Onde o raio do toque encontra o plano horizontal do alvo; distância horizontal até o alvo (m). */
export function erroDoToque(pose: Pose, t: Toque, fovGraus: number, aspecto: number): number | null {
  const d = girarY(raioNoSensor(t.ndc, t.q, fovGraus, aspecto), pose.rumo)
  if (Math.abs(d.y) < MINIMO_INCLINACAO * d.length()) return null
  const k = (t.alvo.y - pose.posicao.y) / d.y
  if (k <= 0) return null
  const p = pose.posicao.clone().addScaledVector(d, k)
  return Math.hypot(p.x - t.alvo.x, p.z - t.alvo.z)
}

/** Ponto médio (no sensor, relativo à câmera) de uma aresta vertical de comprimento `lado`. */
function arestaVertical(cima: Vector3, baixo: Vector3, lado: number): Vector3 | null {
  // Mínimos quadrados de ta·cima − tb·baixo = (0, lado, 0).
  const aa = cima.dot(cima)
  const bb = baixo.dot(baixo)
  const ab = cima.dot(baixo)
  const det = aa * bb - ab * ab
  if (Math.abs(det) < 1e-12) return null
  const ra = cima.y * lado
  const rb = -baixo.y * lado
  const ta = (ra * bb + rb * ab) / det
  const tb = (rb * aa + ra * ab) / det
  if (ta <= 0 || tb <= 0) return null
  return cima.clone().multiplyScalar(ta).add(baixo.clone().multiplyScalar(tb)).multiplyScalar(0.5)
}

/**
 * Alinhamento por QR fixado na parede, com as bordas no prumo. A altura aparente de cada
 * borda vertical dá a distância; as duas bordas dão rumo e posição.
 */
export function resolverPorQr(
  leitura: LeituraQr,
  qr: QrNoMundo,
  fovGraus: number,
  aspecto: number,
): Pose | null {
  const [se, sd, id, ie] = leitura.cantos.map((c) => raioNoSensor(c, leitura.q, fovGraus, aspecto))
  const esq = arestaVertical(se, ie, qr.lado)
  const dir = arestaVertical(sd, id, qr.lado)
  if (!esq || !dir) return null
  const meio = qr.direita.clone().multiplyScalar(qr.lado / 2)
  return poseDeDoisPontos(esq, dir, qr.centro.clone().sub(meio), qr.centro.clone().add(meio))
}

/** Orientação da câmera no mundo. */
export function orientacaoNoMundo(pose: Pose, q: Quaternion): Quaternion {
  return new Quaternion().setFromAxisAngle(Y, pose.rumo).multiply(q)
}

/** Projeção de um ponto do mundo na tela (NDC); null se estiver atrás da câmera. */
export function projetar(
  pose: Pose,
  q: Quaternion,
  ponto: Vector3,
  fovGraus: number,
  aspecto: number,
): Ponto2 | null {
  const local = ponto.clone().sub(pose.posicao).applyQuaternion(orientacaoNoMundo(pose, q).invert())
  if (local.z >= -1e-6) return null
  const t = Math.tan((fovGraus * Math.PI) / 360)
  return [local.x / (-local.z * t * aspecto), local.y / (-local.z * t)]
}
