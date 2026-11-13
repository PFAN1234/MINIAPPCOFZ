import { describe, expect, it } from 'vitest'
import {
  areaM2,
  codigoOm,
  coordenada,
  dataBr,
  diasComSinal,
  lerCoordenadas,
  lerDecimal,
  lerMoeda,
  mascaraCnpj,
  mascaraMoeda,
  moeda,
  numeroBoletim,
} from './formato.ts'

describe('formatação brasileira', () => {
  it('datas, valores, áreas, coordenadas e dias', () => {
    expect(dataBr('2026-11-13')).toBe('13/11/2026')
    expect(dataBr('2026-11-13T02:00:00Z')).toBe('13/11/2026')
    expect(dataBr(null)).toBe('')
    expect(moeda(79499000)).toBe('R$ 79.499.000,00')
    expect(moeda(-5000)).toBe('-R$ 5.000,00')
    expect(moeda(0.5)).toBe('R$ 0,50')
    expect(areaM2(86102.17)).toBe('86.102,17 m²')
    expect(coordenada(-3.761)).toBe('-3,7610')
    expect(coordenada(-38.5297)).toBe('-38,5297')
    expect(diasComSinal(90)).toBe('+90 dias')
    expect(diasComSinal(-1)).toBe('-1 dia')
    expect(diasComSinal(0)).toBe('0 dias')
  })

  it('máscara de moeda: dígitos entram pela direita e o sinal só onde é permitido', () => {
    expect(mascaraMoeda('7949900000')).toBe('79.499.000,00')
    expect(mascaraMoeda('5')).toBe('0,05')
    expect(mascaraMoeda('0,050')).toBe('0,50')
    expect(mascaraMoeda('')).toBe('')
    expect(mascaraMoeda('-500000')).toBe('5.000,00')
    expect(mascaraMoeda('-500000', true)).toBe('-5.000,00')
    expect(mascaraMoeda('-', true)).toBe('-')
    expect(lerMoeda('79.499.000,00')).toBe(79499000)
    expect(lerMoeda('-5.000,00')).toBe(-5000)
    expect(lerMoeda('12,50')).toBe(12.5)
    expect(lerMoeda('12')).toBeNull()
    expect(lerMoeda('-')).toBeNull()
  })

  it('números digitados e CNPJ', () => {
    expect(lerDecimal('86.102,17')).toBe(86102.17)
    expect(lerDecimal('86102.17')).toBe(86102.17)
    expect(lerDecimal('1.234')).toBe(1234)
    expect(lerDecimal('-3,7610')).toBe(-3.761)
    expect(lerDecimal('−3,7')).toBe(-3.7)
    expect(lerDecimal('abc')).toBeNull()
    expect(lerDecimal('')).toBeNull()
    expect(mascaraCnpj('12345678000195')).toBe('12.345.678/0001-95')
    expect(mascaraCnpj('1234')).toBe('12.34')
    expect(mascaraCnpj('12.345.678/0001-95999')).toBe('12.345.678/0001-95')
  })

  it('lê coordenadas coladas em vários formatos, sem confundir vírgula decimal', () => {
    expect(lerCoordenadas('−3.7610, −38.5297')).toEqual({ latitude: -3.761, longitude: -38.5297 })
    expect(lerCoordenadas('-3.7610,-38.5297')).toEqual({ latitude: -3.761, longitude: -38.5297 })
    expect(lerCoordenadas('-3,7610; -38,5297')).toEqual({ latitude: -3.761, longitude: -38.5297 })
    expect(lerCoordenadas('-3,7610 -38,5297')).toEqual({ latitude: -3.761, longitude: -38.5297 })
    expect(lerCoordenadas('-3.7610 -38.5297')).toEqual({ latitude: -3.761, longitude: -38.5297 })
    expect(lerCoordenadas('-3,7610')).toBeNull()
    expect(lerCoordenadas('-3.7610')).toBeNull()
    expect(lerCoordenadas('abc, def')).toBeNull()
  })

  it('número do boletim', () => {
    expect(codigoOm('CO-FZ')).toBe('COFZ')
    expect(codigoOm('Comissão de Obras')).toBe('COMISSAODEOBRAS')
    expect(numeroBoletim('2', '2026-11-11', 'CO-FZ')).toBe('BA2/261111/COFZ')
  })
})
