import { describe, expect, it } from 'vitest'
import { gerarQr, textoQr } from './qr.ts'

describe('textoQr', () => {
  it('monta o link do Mini App com bot, app, obra e ambiente', () => {
    expect(textoQr('bot_teste', 'fiscalcofz', 'hto', 'terreo-administracao')).toBe(
      'https://t.me/bot_teste/fiscalcofz?startapp=amb_hto_terreo-administracao',
    )
  })

  it('tira o @ do bot e usa o app padrão quando vazio', () => {
    expect(textoQr('@bot_teste', '', 'hto', 'a')).toBe('https://t.me/bot_teste/fiscalcofz?startapp=amb_hto_a')
  })
})

describe('gerarQr', () => {
  const texto = textoQr('bot_teste', 'fiscalcofz', 'hto', 'terreo-administracao')
  const qr = gerarQr(texto)

  it('gera matriz quadrada de versão válida (21 + 4·(v-1) módulos)', () => {
    expect(qr.modulos).toHaveLength(qr.tamanho)
    expect(qr.modulos.every((l) => l.length === qr.tamanho)).toBe(true)
    expect((qr.tamanho - 21) % 4).toBe(0)
    expect(qr.tamanho).toBeGreaterThanOrEqual(25)
  })

  it('tem os três localizadores nos cantos e o caminho cobre só módulos escuros', () => {
    const n = qr.tamanho
    for (const [l, c] of [
      [0, 0],
      [0, n - 7],
      [n - 7, 0],
    ]) {
      expect(qr.modulos[l][c]).toBe(true)
      expect(qr.modulos[l + 3][c + 3]).toBe(true)
      expect(qr.modulos[l + 1][c + 1]).toBe(false)
    }
    const escuros = qr.modulos.flat().filter(Boolean).length
    expect(qr.caminho.match(/M/g)).toHaveLength(escuros)
    expect(qr.caminho).toMatch(/^M\d+ \d+h1v1h-1z/)
  })

  it('é determinístico e muda com o texto', () => {
    expect(gerarQr(texto).caminho).toBe(qr.caminho)
    expect(gerarQr(texto + 'x').caminho).not.toBe(qr.caminho)
  })
})
