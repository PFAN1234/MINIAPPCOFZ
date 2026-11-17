import { afterEach, describe, expect, it, vi } from 'vitest'
import { capturarPar, recorteVisivel } from './camera.ts'

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

describe('capturarPar', () => {
  afterEach(() => vi.restoreAllMocks())

  it('renderiza o 3D no mesmo instante do quadro de vídeo, antes da codificação JPEG assíncrona', async () => {
    const eventos: string[] = []
    const ctxFalso = {
      drawImage: vi.fn((fonte: unknown) => {
        eventos.push(fonte === video ? 'draw-video' : fonte === canvas3d ? 'draw-3d' : 'draw-outro')
      }),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      fillStyle: '',
      font: '',
      textBaseline: '',
      globalAlpha: 1,
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctxFalso as never)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => {
      eventos.push('toBlob')
      setTimeout(() => cb(new Blob(['jpg'], { type: 'image/jpeg' })), 0)
    })

    const video = { videoWidth: 1280, videoHeight: 720 } as HTMLVideoElement
    const canvas3d = document.createElement('canvas')
    await capturarPar({
      video,
      canvas3d,
      renderizar: () => eventos.push('renderizar-3d'),
      opacidade: 0.7,
      aspectoTela: 9 / 16,
      faixa: ['Obra · Pav · Amb', 'Modelo ELT · posição indicativa'],
    })

    const idxRender = eventos.indexOf('renderizar-3d')
    const idxDraw3d = eventos.indexOf('draw-3d')
    const idxPrimeiroBlob = eventos.indexOf('toBlob')
    expect(idxRender).toBeGreaterThan(-1)
    expect(idxDraw3d).toBeGreaterThan(idxRender)
    expect(idxRender).toBeLessThan(idxPrimeiroBlob)
    expect(idxDraw3d).toBeLessThan(idxPrimeiroBlob)
  })
})
