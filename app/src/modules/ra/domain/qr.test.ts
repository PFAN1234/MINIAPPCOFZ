import { describe, expect, it } from 'vitest'
import { textoQr } from './qr.ts'

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
