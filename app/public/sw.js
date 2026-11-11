/**
 * Service worker: app offline (precache), plantas e fotos assinadas.
 *
 * Versão atual do app: derivada do nome do cache `app-<versao>` existente, em
 * vez de uma variável em memória (que se perde quando o navegador encerra o
 * worker). Se houver mais de um `app-*` (atualização em curso), vale o mais
 * recente em `caches.keys()` (ordem de criação).
 */
const PREFIXO_APP = 'app-'
const CACHE_PLANTAS = 'plantas-v1'
const CACHE_FOTOS = 'fotos-v1'
const CACHE_MODELOS = 'modelos-v1' // .frag guardados pelo app (src/modelo/cacheModelo.ts), por hash
const LIMITE_FOTOS = 300
const TIMEOUT_NAVEGACAO_MS = 4000
const MSG_VERIFICAR = 'verificar-atualizacao'
const CACHE_EXTERNOS = 'externos-v1'
/** Script do Telegram: sem ele o app abre offline, mas sem BackButton nem tema. */
const SCRIPT_TELEGRAM = 'https://telegram.org/js/telegram-web-app.js'

async function buscarManifesto() {
  const r = await fetch('/precache-manifest.json', { cache: 'no-store' })
  if (!r.ok) throw new Error('manifesto indisponível')
  return r.json()
}

async function nomeCacheAtual() {
  const nomes = (await caches.keys()).filter((n) => n.startsWith(PREFIXO_APP))
  return nomes.length ? nomes[nomes.length - 1] : null
}

async function precache(manifesto) {
  const nome = PREFIXO_APP + manifesto.versao
  const cache = await caches.open(nome)
  try {
    await cache.addAll(manifesto.arquivos.map((u) => new Request(u, { cache: 'reload' })))
  } catch (e) {
    // Um cache vazio seria tomado como a versão atual e quebraria o modo offline.
    await caches.delete(nome)
    throw e
  }
  return nome
}

/** O cache da versão está completo (tem o index.html)? */
async function completo(nome) {
  return Boolean(await (await caches.open(nome)).match('/index.html'))
}

async function apagarAppsExceto(manter) {
  const nomes = await caches.keys()
  await Promise.all(nomes.filter((n) => n.startsWith(PREFIXO_APP) && n !== manter).map((n) => caches.delete(n)))
}

/** URL sem o parâmetro `token`, para a URL assinada nova reaproveitar o cache. */
function chaveDe(url) {
  const u = new URL(url)
  u.searchParams.delete('token')
  return u.toString()
}

function ehPlanta(url) {
  return url.includes('/storage/v1/object/sign/plantas/') || new URL(url).pathname.startsWith('/__plantas/')
}

function ehFoto(url) {
  return url.includes('/storage/v1/object/sign/fotos/')
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        await precache(await buscarManifesto())
      } catch {
        /* instala sem precache; a próxima verificação tenta de novo */
      }
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const atual = await nomeCacheAtual()
      const nomes = await caches.keys()
      await Promise.all(
        nomes
          .filter((n) => n.startsWith(PREFIXO_APP) && n !== atual)
          .concat(nomes.filter((n) => !n.startsWith(PREFIXO_APP) && ![CACHE_PLANTAS, CACHE_FOTOS, CACHE_MODELOS, CACHE_EXTERNOS].includes(n)))
          .map((n) => caches.delete(n)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data !== MSG_VERIFICAR) return
  event.waitUntil(
    (async () => {
      try {
        const manifesto = await buscarManifesto()
        const novo = PREFIXO_APP + manifesto.versao
        const atual = await nomeCacheAtual()
        if (atual === novo && (await completo(novo))) return
        await precache(manifesto)
        await apagarAppsExceto(novo)
      } catch {
        /* offline ou manifesto ausente: mantém a versão atual */
      }
    })(),
  )
})

async function navegacao(req) {
  const rede = fetch(req)
  rede.catch(() => {})
  const limite = new Promise((resolve) => setTimeout(() => resolve(null), TIMEOUT_NAVEGACAO_MS))
  try {
    const r = await Promise.race([rede, limite])
    if (r) return r
  } catch {
    /* sem rede: cai para o cache */
  }
  const nome = await nomeCacheAtual()
  const guardada = nome ? await (await caches.open(nome)).match('/index.html', { ignoreSearch: true }) : null
  // Sem cache: devolve o que a rede (lenta) ainda trouxer.
  return guardada ?? rede
}

async function assets(req) {
  const guardada = await caches.match(req, { ignoreSearch: true })
  if (guardada) return guardada
  const r = await fetch(req)
  if (r.status === 200) {
    const nome = await nomeCacheAtual()
    if (nome) (await caches.open(nome)).put(req, r.clone())
  }
  return r
}

/** Rede primeiro (com limite de tempo), cache como reserva; aceita resposta opaca de <script>. */
async function scriptExterno(req) {
  const cache = await caches.open(CACHE_EXTERNOS)
  const rede = fetch(req).then(async (r) => {
    if (r.ok || r.type === 'opaque') await cache.put(SCRIPT_TELEGRAM, r.clone())
    return r
  })
  rede.catch(() => {})
  const limite = new Promise((resolve) => setTimeout(() => resolve(null), TIMEOUT_NAVEGACAO_MS))
  try {
    const r = await Promise.race([rede, limite])
    if (r) return r
  } catch {
    /* sem rede */
  }
  return (await cache.match(SCRIPT_TELEGRAM)) ?? rede
}

async function limitarFotos(cache) {
  const chaves = await cache.keys()
  const excesso = chaves.length - LIMITE_FOTOS
  for (let i = 0; i < excesso; i++) await cache.delete(chaves[i])
}

async function imagem(req, nomeCache, limite) {
  const cache = await caches.open(nomeCache)
  const chave = chaveDe(req.url)
  const guardada = await cache.match(chave)
  if (guardada) return guardada
  // <img> pede em modo no-cors e a resposta opaca não pode ser conferida nem
  // guardada com segurança; o Storage do Supabase responde com CORS liberado.
  const r = await fetch(req.url, { mode: 'cors', credentials: 'omit' })
  if (r.status === 200) {
    await cache.put(chave, r.clone())
    if (limite) await limitarFotos(cache)
  }
  return r
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (/\/(storage\/v1\/object\/upload|rest|auth|functions)\//.test(url.pathname)) return

  if (ehPlanta(req.url)) return void event.respondWith(imagem(req, CACHE_PLANTAS, false))
  if (ehFoto(req.url)) return void event.respondWith(imagem(req, CACHE_FOTOS, true))
  if (url.origin + url.pathname === SCRIPT_TELEGRAM) return void event.respondWith(scriptExterno(req))
  if (url.origin !== self.location.origin) return

  if (req.mode === 'navigate') return void event.respondWith(navegacao(req))
  if (url.pathname.startsWith('/assets/')) return void event.respondWith(assets(req))
})
