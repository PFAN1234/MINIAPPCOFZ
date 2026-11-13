import { describe, expect, it } from 'vitest'
import { recorteVisivel } from './camera.ts'

describe('recorteVisivel', () => {
  it('corta as laterais do vídeo deitado numa tela em pé', () => {
    const r = recorteVisivel(1920, 1080, 9 / 16)
    expect(r.sh).toBe(1080)
    expect(r.sw).toBeCloseTo(607.5, 6)
    expect(r.sx).toBeCloseTo((1920 - 607.5) / 2, 6)
    expect(r.sy).toBe(0)
  })

  it('corta em cima e embaixo quando o vídeo é mais alto que a tela', () => {
    const r = recorteVisivel(1080, 1920, 3 / 4)
    expect(r.sw).toBe(1080)
    expect(r.sh).toBeCloseTo(1440, 6)
    expect(r.sy).toBeCloseTo(240, 6)
  })
})
