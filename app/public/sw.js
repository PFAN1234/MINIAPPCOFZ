/* Cache-first para imagens das plantas (bucket `plantas` e /__plantas/). */
const CACHE = 'plantas-v1'

function ehPlanta(url) {
  return url.includes('/storage/v1/object/sign/plantas/') || new URL(url).pathname.startsWith('/__plantas/')
}

/** URL sem o parâmetro `token`, para a URL assinada nova reaproveitar o cache. */
function chaveDe(url) {
  const u = new URL(url)
  u.searchParams.delete('token')
  return u.toString()
}

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET' || !ehPlanta(req.url)) return
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const chave = chaveDe(req.url)
      const guardada = await cache.match(chave)
      if (guardada) return guardada
      // <img> pede em modo no-cors e a resposta opaca não pode ser conferida nem
      // guardada com segurança; o Storage do Supabase responde com CORS liberado.
      const resposta = await fetch(req.url, { mode: 'cors', credentials: 'omit' })
      if (resposta.status === 200) cache.put(chave, resposta.clone())
      return resposta
    }),
  )
})
