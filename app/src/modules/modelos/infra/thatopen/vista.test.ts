import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { chaveRef, ehToqueRepetido, projetarParaTela, semSigla, somarRefs, tamanhoCaptura, tirarRefs } from './vista.ts'

const ref = (sigla: string, globalId: string) => ({ sigla, globalId })

describe('refs', () => {
  it('soma sem repetir, tira e remove por sigla', () => {
    const a = somarRefs([ref('ARQ', '1')], [ref('ARQ', '1'), ref('EST', '2')])
    expect(a.map(chaveRef)).toEqual(['ARQ:1', 'EST:2'])
    expect(tirarRefs(a, [ref('ARQ', '1')]).map(chaveRef)).toEqual(['EST:2'])
    expect(semSigla(a, 'EST').map(chaveRef)).toEqual(['ARQ:1'])
  })
})

describe('tamanhoCaptura', () => {
  it('reduz acima de 1600 px mantendo a proporção', () => {
    expect(tamanhoCaptura(3200, 1800)).toEqual({ largura: 1600, altura: 900 })
  })
  it('não amplia', () => {
    expect(tamanhoCaptura(800, 600)).toEqual({ largura: 800, altura: 600 })
  })
  it('tamanho vazio', () => {
    expect(tamanhoCaptura(0, 0)).toEqual({ largura: 0, altura: 0 })
  })
})

describe('projetarParaTela', () => {
  const camera = new THREE.PerspectiveCamera(60, 2, 0.1, 100)
  camera.position.set(0, 0, 10)
  camera.lookAt(0, 0, 0)
  it('alvo no centro da tela', () => {
    const r = projetarParaTela([0, 0, 0], camera, 800, 400)
    expect(r.visivel).toBe(true)
    expect(r.x).toBeCloseTo(400)
    expect(r.y).toBeCloseTo(200)
  })
  it('atrás da câmera fica escondido', () => {
    expect(projetarParaTela([0, 0, 20], camera, 800, 400).visivel).toBe(false)
  })
  it('fora do enquadramento fica escondido', () => {
    expect(projetarParaTela([100, 0, 0], camera, 800, 400).visivel).toBe(false)
  })
})

describe('ehToqueRepetido', () => {
  const a = { x: 100, y: 100, t: 1000 }
  it('ignora o segundo toque no mesmo lugar e em pouco tempo', () => {
    expect(ehToqueRepetido(a, { x: 102, y: 101, t: 1150 })).toBe(true)
  })
  it('aceita o primeiro toque, toques distantes ou espaçados', () => {
    expect(ehToqueRepetido(null, a)).toBe(false)
    expect(ehToqueRepetido(a, { x: 130, y: 100, t: 1100 })).toBe(false)
    expect(ehToqueRepetido(a, { x: 100, y: 100, t: 1500 })).toBe(false)
  })
})
