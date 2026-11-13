// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { Rollup } from 'vite'
import { arquivosSoDoAdmin, montarManifesto, montarVersao, rotaAdmin } from './vite.config.ts'

describe('montarManifesto', () => {
  const nomes = ['assets/index-abc.js', 'assets/index-abc.css', 'index.html', 'assets/logo-1.svg']

  it('lista index.html e os arquivos do bundle com caminho absoluto', () => {
    const { arquivos } = montarManifesto(nomes)
    expect(arquivos).toEqual([
      '/assets/index-abc.css',
      '/assets/index-abc.js',
      '/assets/logo-1.svg',
      '/index.html',
    ])
  })

  it('inclui index.html mesmo que não venha na lista', () => {
    expect(montarManifesto(['assets/a.js']).arquivos).toContain('/index.html')
  })

  it('exclui mapas e o próprio manifesto', () => {
    const { arquivos } = montarManifesto([...nomes, 'assets/index-abc.js.map', 'precache-manifest.json'])
    expect(arquivos.some((a) => a.endsWith('.map') || a.includes('precache-manifest'))).toBe(false)
  })

  it('exclui o visualizador 3D (chunk e worker)', () => {
    const { arquivos } = montarManifesto([...nomes, 'assets/VisualizadorModelo-x1.js', 'assets/worker-y2.mjs'])
    expect(arquivos).toEqual(montarManifesto(nomes).arquivos)
  })

  it('inclui as fontes .woff2 e deixa fora a reserva .woff', () => {
    const fontes = ['assets/barlow-latin-400-normal-a1.woff2', 'assets/barlow-latin-400-normal-b2.woff']
    const { arquivos } = montarManifesto([...nomes, ...fontes])
    expect(arquivos).toContain('/assets/barlow-latin-400-normal-a1.woff2')
    expect(arquivos).not.toContain('/assets/barlow-latin-400-normal-b2.woff')
  })

  it('versão é estável e independe da ordem', () => {
    const a = montarManifesto(nomes)
    const b = montarManifesto([...nomes].reverse())
    expect(a.versao).toMatch(/^[0-9a-f]{12}$/)
    expect(b.versao).toBe(a.versao)
  })

  it('versão muda quando um arquivo muda', () => {
    expect(montarManifesto([...nomes, 'assets/novo-9.js']).versao).not.toBe(montarManifesto(nomes).versao)
  })
})

describe('arquivosSoDoAdmin', () => {
  function chunk(fileName: string, name: string, isEntry: boolean, imports: string[] = [], css: string[] = []) {
    return {
      type: 'chunk',
      fileName,
      name,
      isEntry,
      imports,
      dynamicImports: [],
      viteMetadata: { importedCss: new Set(css), importedAssets: new Set() },
    }
  }
  const bundle = {
    'index.html': { type: 'asset', fileName: 'index.html' },
    'admin.html': { type: 'asset', fileName: 'admin.html' },
    'assets/index-a.js': chunk('assets/index-a.js', 'index', true, ['assets/comum-c.js'], ['assets/index-a.css']),
    'assets/admin-b.js': chunk('assets/admin-b.js', 'admin', true, ['assets/comum-c.js', 'assets/so-admin-d.js'], [
      'assets/admin-b.css',
    ]),
    'assets/comum-c.js': chunk('assets/comum-c.js', 'comum', false),
    'assets/so-admin-d.js': chunk('assets/so-admin-d.js', 'so-admin', false),
    'assets/index-a.css': { type: 'asset', fileName: 'assets/index-a.css' },
    'assets/admin-b.css': { type: 'asset', fileName: 'assets/admin-b.css' },
  } as unknown as Rollup.OutputBundle

  it('separa o que só a entrada admin alcança (e o admin.html)', () => {
    expect([...arquivosSoDoAdmin(bundle)].sort()).toEqual([
      'admin.html',
      'assets/admin-b.css',
      'assets/admin-b.js',
      'assets/so-admin-d.js',
    ])
  })

  it('o manifesto do Mini App fica sem o admin e com o compartilhado', () => {
    const fora = arquivosSoDoAdmin(bundle)
    const { arquivos } = montarManifesto(Object.keys(bundle).filter((n) => !fora.has(n)))
    expect(arquivos).toEqual(['/assets/comum-c.js', '/assets/index-a.css', '/assets/index-a.js', '/index.html'])
  })
})

describe('rotaAdmin', () => {
  function reescrever(url: string) {
    const req = { url } as { url: string }
    let chamou = false
    rotaAdmin()(req as never, {} as never, () => {
      chamou = true
    })
    expect(chamou).toBe(true)
    return req.url
  }

  it('serve admin.html em /admin e /admin/...', () => {
    expect(reescrever('/admin')).toBe('/admin.html')
    expect(reescrever('/admin/')).toBe('/admin.html')
    expect(reescrever('/admin/obras/hto?x=1')).toBe('/admin.html?x=1')
  })

  it('não mexe no resto', () => {
    expect(reescrever('/')).toBe('/')
    expect(reescrever('/obras/hto')).toBe('/obras/hto')
    expect(reescrever('/assets/admin-b.js')).toBe('/assets/admin-b.js')
    expect(reescrever('/administracao')).toBe('/administracao')
  })
})

describe('montarVersao', () => {
  const agora = new Date('2026-11-13T17:32:00Z')

  it('lê o PR da mensagem de merge e encurta o commit', () => {
    const v = montarVersao(
      'Merge pull request #39 from PFAN1234/claude/x\n\nMini app: aba Relatórios',
      '9e969c1b53f38d3dbf9517a86fe7e65b51227c5a',
      agora,
    )
    expect(v).toEqual({ pr: 39, commit: '9e969c1', data: '2026-11-13T17:32:00.000Z' })
  })

  it('lê o PR de um squash ("Título (#40)")', () => {
    expect(montarVersao('Versão na tela inicial (#40)', 'abc1234567', agora).pr).toBe(40)
  })

  it('sem PR na mensagem nem commit, fica só a data', () => {
    expect(montarVersao('Ajuste #12 no texto', undefined, agora)).toEqual({
      pr: null,
      commit: null,
      data: '2026-11-13T17:32:00.000Z',
    })
  })
})
