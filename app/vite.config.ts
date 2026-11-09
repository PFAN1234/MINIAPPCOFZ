import { createReadStream, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import type { Connect, Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

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

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), plantasFixture()],
  // A fixture importa os JSON de ../data/hto (fora da pasta do app); nada além disso.
  server: { fs: { allow: ['.', '../data/hto'] } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
