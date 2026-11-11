import { createReadStream, readFileSync, rmSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import type { Connect, Plugin, Rollup } from 'vite'
import { configDefaults, defineConfig } from 'vitest/config'

const PASTA_PLANTAS = fileURLToPath(new URL('../data/hto/plantas', import.meta.url))

const TIPOS: Record<string, string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
}

/** Serve `/__plantas/<revisao>/<pavimento>/...` a partir de `data/hto/plantas/` (modo fixture). */
export function servirPlantas(pasta: string = PASTA_PLANTAS): Connect.NextHandleFunction {
  const base = path.resolve(pasta)
  return (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    const url = req.url ?? ''
    if (!url.startsWith('/__plantas/')) return next()
    let relativo: string
    try {
      relativo = decodeURIComponent(url.slice('/__plantas/'.length).split(/[?#]/)[0])
    } catch {
      res.statusCode = 400
      return res.end('Requisição inválida')
    }
    const alvo = path.resolve(base, relativo)
    const tipo = TIPOS[path.extname(alvo).toLowerCase()]
    if (relativo.includes('\0') || !alvo.startsWith(base + path.sep) || !tipo) {
      res.statusCode = 404
      return res.end('Não encontrado')
    }
    try {
      if (!statSync(alvo).isFile()) throw new Error('não é arquivo')
    } catch {
      res.statusCode = 404
      return res.end('Não encontrado')
    }
    res.setHeader('Content-Type', tipo)
    res.setHeader('Cache-Control', 'public, max-age=3600')
    createReadStream(alvo).pipe(res)
  }
}

function plantasFixture(): Plugin {
  return {
    name: 'plantas-fixture',
    configureServer(server) {
      server.middlewares.use(servirPlantas())
    },
    configurePreviewServer(server) {
      server.middlewares.use(servirPlantas())
    },
  }
}

export interface ManifestoPrecache {
  versao: string
  arquivos: string[]
}

/**
 * Monta o manifesto de precache a partir dos nomes de arquivo do bundle.
 * Fora: mapas `.map`, o próprio manifesto e o visualizador 3D (chunk e worker: ~3,7 MB,
 * só úteis com os `.frag`, que exigem rede). Também fora o conversor de IFC do site de
 * administração (worker e `web-ifc.wasm`), que o grafo de imports não alcança.
 * `/index.html` sempre entra.
 * A `versao` é o hash dos nomes ordenados: não depende da ordem de entrada.
 */
export function montarManifesto(nomes: string[]): ManifestoPrecache {
  const unicos = new Set(
    nomes
      .map((n) => n.replace(/^\/+/, ''))
      .filter(
        (n) =>
          n !== 'precache-manifest.json' &&
          !n.endsWith('.map') &&
          !/^assets\/(VisualizadorModelo|worker|conversor\.worker)-/.test(n) &&
          !n.startsWith('web-ifc/'),
      ),
  )
  unicos.add('index.html')
  const arquivos = [...unicos].sort().map((n) => `/${n}`)
  const versao = createHash('sha256').update(arquivos.join('\n')).digest('hex').slice(0, 12)
  return { versao, arquivos }
}

/**
 * Arquivos do bundle que só o site de administração usa (`admin.html` e o que só a entrada
 * `admin` alcança): ficam fora do precache do Mini App. Os compartilhados (React, supabase-js…)
 * continuam, porque o app também os usa.
 */
export function arquivosSoDoAdmin(bundle: Rollup.OutputBundle): Set<string> {
  const alcancaveis = (entradas: string[]) => {
    const vistos = new Set<string>()
    const pilha = [...entradas]
    while (pilha.length > 0) {
      const nome = pilha.pop()!
      if (vistos.has(nome)) continue
      vistos.add(nome)
      const item = bundle[nome]
      if (item?.type !== 'chunk') continue
      const meta = (item as { viteMetadata?: { importedCss?: Set<string>; importedAssets?: Set<string> } })
        .viteMetadata
      pilha.push(...item.imports, ...item.dynamicImports, ...(meta?.importedCss ?? []), ...(meta?.importedAssets ?? []))
    }
    return vistos
  }
  const entradas = Object.values(bundle).filter((i): i is Rollup.OutputChunk => i.type === 'chunk' && i.isEntry)
  const doAdmin = alcancaveis(entradas.filter((c) => c.name === 'admin').map((c) => c.fileName))
  const doApp = alcancaveis(entradas.filter((c) => c.name !== 'admin').map((c) => c.fileName))
  const so = new Set([...doAdmin].filter((n) => !doApp.has(n)))
  so.add('admin.html')
  return so
}

/**
 * Emite `precache-manifest.json` só no build. Arquivos de `public/` (o `sw.js`)
 * não entram: não são referenciados pelo index.html e o SW não se auto-armazena.
 */
export function manifestoPrecache(): Plugin {
  return {
    name: 'manifesto-precache',
    apply: 'build',
    generateBundle(_opcoes, bundle) {
      const fora = arquivosSoDoAdmin(bundle)
      const manifesto = montarManifesto(Object.keys(bundle).filter((n) => !fora.has(n)))
      this.emitFile({
        type: 'asset',
        fileName: 'precache-manifest.json',
        source: JSON.stringify(manifesto, null, 2) + '\n',
      })
    },
  }
}

/** `/admin` e `/admin/...` servem `admin.html` em dev e preview (na Vercel, `vercel.json`). */
export function rotaAdmin(): Connect.NextHandleFunction {
  return (req: IncomingMessage, _res: ServerResponse, next: Connect.NextFunction) => {
    const [caminho, consulta] = (req.url ?? '').split('?')
    if (/^\/admin(\/[^.]*)?$/.test(caminho)) req.url = '/admin.html' + (consulta ? `?${consulta}` : '')
    next()
  }
}

function siteAdmin(): Plugin {
  return {
    name: 'site-admin',
    configureServer(server) {
      server.middlewares.use(rotaAdmin())
    },
    configurePreviewServer(server) {
      server.middlewares.use(rotaAdmin())
    },
  }
}

/** Versão do web-ifc instalada: o `.wasm` fica em `/web-ifc/<versão>/` (cache por versão). */
export const VERSAO_WEB_IFC: string = JSON.parse(
  readFileSync(fileURLToPath(new URL('./node_modules/web-ifc/package.json', import.meta.url)), 'utf8'),
).version
const WASM_WEB_IFC = fileURLToPath(new URL('./node_modules/web-ifc/web-ifc.wasm', import.meta.url))

/**
 * O conversor de IFC (site de administração) carrega `web-ifc.wasm` por caminho fixo
 * (`SetWasmPath`), sem o hash do Vite no nome: no build o arquivo é emitido em
 * `web-ifc/<versão>/web-ifc.wasm`; em dev e preview, servido de node_modules.
 */
function wasmWebIfc(): Plugin {
  const rota = `/web-ifc/${VERSAO_WEB_IFC}/web-ifc.wasm`
  const servir: Connect.NextHandleFunction = (req, res, next) => {
    if ((req.url ?? '').split('?')[0] !== rota) return next()
    res.setHeader('Content-Type', 'application/wasm')
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    createReadStream(WASM_WEB_IFC).pipe(res)
  }
  return {
    name: 'wasm-web-ifc',
    configureServer(server) {
      server.middlewares.use(servir)
    },
    configurePreviewServer(server) {
      server.middlewares.use(servir)
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: rota.slice(1), source: readFileSync(WASM_WEB_IFC) })
    },
  }
}

/** `public/modelos/` guarda os `.frag` do teste local; não vão para o deploy (virão do Supabase Storage). */
function semModelosNoBuild(): Plugin {
  return {
    name: 'sem-modelos-no-build',
    apply: 'build',
    closeBundle() {
      rmSync(fileURLToPath(new URL('./dist/modelos', import.meta.url)), { recursive: true, force: true })
      rmSync(fileURLToPath(new URL('./dist-fixture/modelos', import.meta.url)), { recursive: true, force: true })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), plantasFixture(), siteAdmin(), manifestoPrecache(), semModelosNoBuild(), wasmWebIfc()],
  define: { __VERSAO_WEB_IFC__: JSON.stringify(VERSAO_WEB_IFC) },
  // O conversor de IFC (worker do site de administração) importa a biblioteca como módulo.
  // `THREE.TSL` da That Open fica em código que o worker não usa (descartado no build): sem aviso.
  worker: { format: 'es', rolldownOptions: { checks: { importIsUndefined: false } } },
  // As fixtures importam os JSON de ../data/hto e ../data/cofz (fora da pasta do app); nada além disso.
  server: { fs: { allow: ['.', '../data/hto', '../data/cofz'] } },
  // Duas entradas: o Mini App (index.html) e o site de administração (admin.html, em /admin/).
  build: {
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        admin: fileURLToPath(new URL('./admin.html', import.meta.url)),
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Testes ponta a ponta ficam em e2e/ (Playwright), não no Vitest.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
})
