import { describe, expect, it } from 'vitest'
import type { Armazenamento } from './Armazenamento.port.ts'

const JPEG = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' })

/** Contrato reutilizável de `Armazenamento`. Cada chamada de `criar` devolve uma instância limpa. */
export function contratoArmazenamento(nome: string, criar: () => Armazenamento) {
  describe(`Armazenamento (${nome})`, () => {
    it('envia, repete como ja_confirmado e lê o arquivo de volta', async () => {
      const a = criar()
      expect(await a.enviar('fotos', 'o/r/f.jpg', JPEG(), 'image/jpeg')).toBe('enviado')
      expect(await a.enviar('fotos', 'o/r/f.jpg', JPEG(), 'image/jpeg')).toBe('ja_confirmado')
      const blob = await a.baixar('fotos', 'o/r/f.jpg')
      expect(blob.size).toBe(4)
    })

    it('urls só traz os arquivos que existem, indexados pelo caminho', async () => {
      const a = criar()
      await a.enviar('fotos', 'o/r/a.jpg', JPEG(), 'image/jpeg')
      const urls = await a.urls('fotos', ['o/r/a.jpg', 'o/r/nao-existe.jpg', 'o/r/a.jpg'])
      expect([...urls.keys()]).toEqual(['o/r/a.jpg'])
      expect(typeof urls.get('o/r/a.jpg')).toBe('string')
      expect((await a.urls('fotos', [])).size).toBe(0)
    })

    it('excluir remove o arquivo', async () => {
      const a = criar()
      await a.enviar('fotos', 'o/r/b.jpg', JPEG(), 'image/jpeg')
      await a.excluir('fotos', 'o/r/b.jpg')
      expect((await a.urls('fotos', ['o/r/b.jpg'])).size).toBe(0)
      await expect(a.baixar('fotos', 'o/r/b.jpg')).rejects.toBeDefined()
    })
  })
}
