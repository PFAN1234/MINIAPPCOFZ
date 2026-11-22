/**
 * Funções puras do motor 3D para vistas salvas, captura e marcadores (etapa 7C1): chaves de
 * referência, redimensionamento da captura e projeção de pontos 3D para a tela.
 */
import * as THREE from 'three'
import type { Ponto3, RefElemento } from '../../domain/central.ts'

/** Largura máxima da captura (px): mantém o PNG bem abaixo de 5 MB. */
export const LARGURA_MAX_CAPTURA = 1600

export const chaveRef = (r: Pick<RefElemento, 'sigla' | 'globalId'>) => `${r.sigla}:${r.globalId}`

/** Acrescenta refs ao conjunto (sem repetir o mesmo elemento). */
export function somarRefs(base: RefElemento[], novos: RefElemento[]): RefElemento[] {
  const mapa = new Map(base.map((r) => [chaveRef(r), r]))
  for (const r of novos) mapa.set(chaveRef(r), r)
  return [...mapa.values()]
}

/** Remove refs do conjunto. */
export function tirarRefs(base: RefElemento[], tirar: RefElemento[]): RefElemento[] {
  const fora = new Set(tirar.map(chaveRef))
  return base.filter((r) => !fora.has(chaveRef(r)))
}

/** Mantém só os refs de outras siglas (disciplina descarregada). */
export const semSigla = (base: RefElemento[], sigla: string) => base.filter((r) => r.sigla !== sigla)

/** Tamanho final da captura: nunca passa de `max` de largura e mantém a proporção. */
export function tamanhoCaptura(largura: number, altura: number, max = LARGURA_MAX_CAPTURA): { largura: number; altura: number } {
  if (largura <= 0 || altura <= 0) return { largura: 0, altura: 0 }
  if (largura <= max) return { largura: Math.round(largura), altura: Math.round(altura) }
  return { largura: max, altura: Math.max(1, Math.round((altura * max) / largura)) }
}

export interface PosicaoTela {
  x: number
  y: number
  /** Falso quando o ponto está atrás da câmera, fora do volume visível ou além do plano distante. */
  visivel: boolean
}

/** Projeta um ponto do mundo para pixels do canvas (origem no canto superior esquerdo). */
export function projetarParaTela(p: Ponto3, camera: THREE.Camera, largura: number, altura: number): PosicaoTela {
  camera.updateMatrixWorld()
  const v = new THREE.Vector3(p[0], p[1], p[2]).project(camera)
  const visivel = Number.isFinite(v.x) && v.z >= -1 && v.z <= 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1
  return { x: ((v.x + 1) / 2) * largura, y: ((1 - v.y) / 2) * altura, visivel }
}

export interface ToqueMedicao {
  x: number
  y: number
  /** Instante do toque, em ms. */
  t: number
}

/**
 * Decide se um clique de área/volume é o segundo toque de um duplo clique (mesmo lugar, em poucos ms)
 * e deve ser ignorado: o duplo clique conclui a medição e não pode acrescentar o último ponto de novo.
 */
export function ehToqueRepetido(anterior: ToqueMedicao | null, atual: ToqueMedicao, maxPx = 5, maxMs = 400): boolean {
  if (!anterior) return false
  const dt = atual.t - anterior.t
  return dt >= 0 && dt < maxMs && Math.hypot(atual.x - anterior.x, atual.y - anterior.y) < maxPx
}

/** Altura típica do corte de uma planta, acima do piso do pavimento (m). */
export const CORTE_PLANTA_M = 1.2
/** Folga abaixo do piso mantida visível na planta (m): a espessura da laje. */
export const FOLGA_PISO_M = 0.3

/**
 * Altura do corte da planta em coordenadas de cena: elevação IFC do pavimento + deslocamento Y das
 * coordenadas do modelo (`getCoordinates()[1]`) + altura de corte. O padrão da biblioteca soma só 0,25 m,
 * que cai na face da laje (sem paredes cortadas); a planta de projeto corta a 1,20 m.
 */
export function alturaCortePlanta(elevacao: number, deslocamentoY: number, corte = CORTE_PLANTA_M): number {
  return elevacao + deslocamentoY + corte
}

/** Profundidade da vista (m) abaixo do corte: da altura de corte até o piso, mais a folga da laje. */
export const profundidadePlanta = (corte = CORTE_PLANTA_M, folga = FOLGA_PISO_M): number => corte + folga
