import { afterEach, describe, expect, it, vi } from 'vitest'
import { gravarTema, lerTema } from './tema.ts'

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('tema da central', () => {
  it('o padrão é escuro', () => {
    expect(lerTema()).toBe('escuro')
  })

  it('persiste a escolha', () => {
    gravarTema('claro')
    expect(localStorage.getItem('central.tema')).toBe('claro')
    expect(lerTema()).toBe('claro')
    gravarTema('escuro')
    expect(lerTema()).toBe('escuro')
  })

  it('valor desconhecido volta ao escuro', () => {
    localStorage.setItem('central.tema', 'azul')
    expect(lerTema()).toBe('escuro')
  })

  it('localStorage que lança não quebra', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado')
    })
    expect(lerTema()).toBe('escuro')
    expect(() => gravarTema('claro')).not.toThrow()
  })
})
