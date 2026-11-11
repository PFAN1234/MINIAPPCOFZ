const NOME_CACHE = 'modelos-v1'

/**
 * Devolve o `.frag` do cache do aparelho (Cache API) ou baixa e guarda. A `chave` inclui o
 * hash do arquivo: modelo novo tem hash novo e baixa de novo; o antigo é apagado do cache.
 * Sem Cache API (jsdom, navegador restrito) ou com o cache cheio, só baixa. O `sw.js` não
 * apaga este cache (ver `CACHE_MODELOS`).
 */
export async function modeloComCache(
  chave: string,
  baixar: () => Promise<ArrayBuffer>,
): Promise<ArrayBuffer> {
  const [prefixo] = chave.split('@')
  const url = `/__modelo-cache/${chave}`
  let cache: Cache | undefined
  try {
    cache = typeof caches === 'undefined' ? undefined : await caches.open(NOME_CACHE)
    const achado = await cache?.match(url)
    if (achado) return await achado.arrayBuffer()
  } catch {
    cache = undefined
  }
  const dados = await baixar()
  try {
    if (cache) {
      // Mesma disciplina com outro hash: apaga a versão velha para não acumular ~MB.
      for (const req of await cache.keys()) {
        if (req.url.includes(`/__modelo-cache/${prefixo}@`) && !req.url.endsWith(url)) await cache.delete(req)
      }
      await cache.put(url, new Response(dados.slice(0)))
    }
  } catch {
    // Cache cheio ou indisponível: o modelo abre do mesmo jeito.
  }
  return dados
}
