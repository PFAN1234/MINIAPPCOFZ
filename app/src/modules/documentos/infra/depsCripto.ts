import type { DepsDocumento } from '../application/use-cases/enviarDocumento.ts'

/** Implementação padrão do hash e da série de `enviarDocumento`, com a Web Crypto do navegador. */
export const depsCripto: Pick<DepsDocumento, 'sha256' | 'novaSerie'> = {
  async sha256(bytes) {
    const h = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
    return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('')
  },
  novaSerie: () => crypto.randomUUID(),
}
