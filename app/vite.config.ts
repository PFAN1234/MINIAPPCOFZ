import { createReadStream, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import type { Connect, Plugin } from 'vite'
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
 * Fora: mapas `.map` e o próprio manifesto. `/index.html` sempre entra.
 * A `versao` é o hash dos nomes ordenados: não depende da ordem de entrada.
 */
export function montarManifesto(nomes: string[]): ManifestoPrecache {
  const unicos = new Set(
    nomes
      .map((n) => n.replace(/^\/+/, ''))
      .filter((n) => n !== 'precache-manifest.json' && !n.endsWith('.map')),
  )
  unicos.add('index.html')
  const arquivos = [...unicos].sort().map((n) => `/${n}`)
  const versao = createHash('sha256').update(arquivos.join('\n')).digest('hex').slice(0, 12)
  return { versao, arquivos }
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
      const manifesto = montarManifesto(Object.keys(bundle))
      this.emitFile({
        type: 'asset',
        fileName: 'precache-manifest.json',
        source: JSON.stringify(manifesto, null, 2) + '\n',
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), plantasFixture(), manifestoPrecache()],
  // A fixture importa os JSON de ../data/hto (fora da pasta do app); nada além disso.
  server: { fs: { allow: ['.', '../data/hto'] } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Testes ponta a ponta ficam em e2e/ (Playwright), não no Vitest.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
})
