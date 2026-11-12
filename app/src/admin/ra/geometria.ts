/** Geometria do contorno do ambiente e validação do QR (as mesmas regras do banco). */
import type { QrAmbiente } from '../dados/tipos.ts'

export type Ponto = [number, number]

export const ALTURA_PADRAO_M = 1.5
export const LADO_PADRAO_CM = 18
export const LADO_MIN_CM = 5
export const LADO_MAX_CM = 100
export const ALTURA_MAX_M = 5
/** Maior lado de QR que ainda cabe numa folha A4 com a margem branca. */
export const LADO_MAX_A4_CM = 18

/** Comprimento da parede i (do canto i ao canto i+1), em metros. */
export function comprimentoParede(contorno: Ponto[], i: number): number {
  const [x0, z0] = contorno[i]
  const [x1, z1] = contorno[(i + 1) % contorno.length]
  return Math.hypot(x1 - x0, z1 - z0)
}

/** Ponto sobre a parede i, a `distancia` metros do canto i. */
export function pontoNaParede(contorno: Ponto[], i: number, distancia: number): { ponto: Ponto; direcao: Ponto } {
  const [x0, z0] = contorno[i]
  const [x1, z1] = contorno[(i + 1) % contorno.length]
  const c = Math.hypot(x1 - x0, z1 - z0) || 1
  const direcao: Ponto = [(x1 - x0) / c, (z1 - z0) / c]
  return { ponto: [x0 + direcao[0] * distancia, z0 + direcao[1] * distancia], direcao }
}

/** Área com sinal (fórmula do laço); o sinal diz o sentido do contorno. */
export function areaComSinal(contorno: Ponto[]): number {
  let s = 0
  for (let i = 0; i < contorno.length; i++) {
    const [x0, z0] = contorno[i]
    const [x1, z1] = contorno[(i + 1) % contorno.length]
    s += x0 * z1 - x1 * z0
  }
  return s / 2
}

/** Normal unitária da parede i apontando para fora do ambiente. */
export function normalExterna(contorno: Ponto[], i: number): Ponto {
  const { direcao } = pontoNaParede(contorno, i, 0)
  // Com área positiva (x para a direita, z para baixo, sentido horário na tela), o exterior fica à esquerda de (dx, dz): (dz, -dx).
  const sinal = areaComSinal(contorno) >= 0 ? 1 : -1
  return [direcao[1] * sinal, -direcao[0] * sinal]
}

/** Número com vírgula decimal ("1,50"). */
export function formatar(n: number, casas = 2): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })
}

/** Número para o campo de edição: vírgula decimal, sem perder casas já gravadas. */
export function paraCampo(n: number, minimo = 2, maximo = 4): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: minimo, maximumFractionDigits: maximo, useGrouping: false })
}

/** Lê um número digitado (aceita vírgula); null se não for um número finito. */
export function lerNumero(texto: string): number | null {
  const t = texto.trim().replace(',', '.')
  if (!/^-?\d+(\.\d+)?$|^-?\.\d+$/.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

export interface CamposQr {
  parede: number
  distancia: string
  altura: string
  ladoCm: string
}

export interface ResultadoValidacao {
  qr: QrAmbiente | null
  erros: { distancia?: string; altura?: string; lado?: string }
}

/** Valida o formulário e converte para metros; o lado vem em cm. */
export function validarQr(contorno: Ponto[], campos: CamposQr): ResultadoValidacao {
  const erros: ResultadoValidacao['erros'] = {}
  const comprimento = comprimentoParede(contorno, campos.parede)
  const d = lerNumero(campos.distancia)
  const h = lerNumero(campos.altura)
  const l = lerNumero(campos.ladoCm)
  if (d === null || d < 0 || d > comprimento) {
    erros.distancia = `A distância precisa estar entre 0 e ${formatar(comprimento)} m (comprimento da parede).`
  }
  if (h === null || h < 0 || h > ALTURA_MAX_M) erros.altura = `A altura precisa estar entre 0 e ${ALTURA_MAX_M} m.`
  if (l === null || l < LADO_MIN_CM || l > LADO_MAX_CM) {
    erros.lado = `O lado precisa estar entre ${LADO_MIN_CM} e ${LADO_MAX_CM} cm.`
  }
  if (erros.distancia || erros.altura || erros.lado) return { qr: null, erros }
  return {
    qr: {
      parede: campos.parede,
      distancia_m: d!,
      altura_m: h!,
      lado_m: Number((l! / 100).toFixed(4)),
    },
    erros,
  }
}
