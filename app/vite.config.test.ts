// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { montarManifesto } from './vite.config.ts'

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
