import { afterEach, describe, expect, it, vi } from 'vitest'
import { capturadoEm, dimensoesAlvo, MENSAGEM_FOTO_ILEGIVEL, prepararFoto } from './imagem.ts'

describe('dimensoesAlvo', () => {
  it('reduz paisagem pelo lado maior', () => {
    expect(dimensoesAlvo(4000, 3000)).toEqual({ largura: 1920, altura: 1440 })
  })
  it('reduz retrato pelo lado maior', () => {
    expect(dimensoesAlvo(3000, 4000)).toEqual({ largura: 1440, altura: 1920 })
  })
  it('não amplia imagem menor que o limite', () => {
    expect(dimensoesAlvo(800, 600)).toEqual({ largura: 800, altura: 600 })
    expect(dimensoesAlvo(1920, 1080)).toEqual({ largura: 1920, altura: 1080 })
  })
  it('respeita limite personalizado e mantém no mínimo 1 px', () => {
    expect(dimensoesAlvo(2000, 1000, 500)).toEqual({ largura: 500, altura: 250 })
    expect(dimensoesAlvo(10000, 1, 100).altura).toBe(1)
  })
})

describe('capturadoEm', () => {
  const agora = new Date('2026-11-09T12:00:00.000Z')
  const arq = (t: number) => new File(['x'], 'a.jpg', { lastModified: t })

  it('usa o menor lastModified', () => {
    const r = capturadoEm([arq(Date.parse('2026-11-09T11:00:00Z')), arq(Date.parse('2026-11-08T10:00:00Z'))], agora)
    expect(r).toBe('2026-11-08T10:00:00.000Z')
  })
  it('limita ao presente quando todos estão no futuro', () => {
    expect(capturadoEm([arq(Date.parse('2026-12-01T00:00:00Z'))], agora)).toBe(agora.toISOString())
  })
  it('vale agora sem arquivos', () => {
    expect(capturadoEm([], agora)).toBe(agora.toISOString())
  })
})

describe('prepararFoto (com mocks, sem canvas)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('decodifica com a orientação do EXIF, reduz e gera JPEG', async () => {
    const close = vi.fn()
    const criar = vi.fn(async () => ({ width: 4000, height: 3000, close }))
    const desenhar = vi.fn()
    const dimensoes: number[] = []
    class FalsoCanvas {
      constructor(l: number, a: number) {
        dimensoes.push(l, a)
      }
      getContext() {
        return { drawImage: desenhar }
      }
      async convertToBlob(o: { type: string; quality: number }) {
        expect(o).toEqual({ type: 'image/jpeg', quality: 0.8 })
        return new Blob(['jpeg'], { type: 'image/jpeg' })
      }
    }
    vi.stubGlobal('createImageBitmap', criar)
    vi.stubGlobal('OffscreenCanvas', FalsoCanvas)
    const arquivo = new File(['x'], 'f.jpg', { type: 'image/jpeg' })
    const foto = await prepararFoto(arquivo)
    expect(criar).toHaveBeenCalledWith(arquivo, { imageOrientation: 'from-image' })
    expect(dimensoes).toEqual([1920, 1440])
    expect(foto).toMatchObject({ largura: 1920, altura: 1440, bytes: 4 })
    expect(foto.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(foto.blob.type).toBe('image/jpeg')
    expect(close).toHaveBeenCalled()
  })

  it('arquivo que não decodifica gera a mensagem amigável', async () => {
    vi.stubGlobal('createImageBitmap', async () => {
      throw new Error('inválido')
    })
    await expect(prepararFoto(new File(['x'], 'f.heic'))).rejects.toThrow(MENSAGEM_FOTO_ILEGIVEL)
  })
})
