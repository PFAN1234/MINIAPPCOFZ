// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { relatorioExemplo } from './exemplo.js'
import { caminhosDasFotos, estatisticas, montarHtmlRelatorio, rodapeRelatorio, type OpcoesRelatorio } from './template.js'

const opcoes = (extra: Partial<OpcoesRelatorio> = {}): OpcoesRelatorio => ({
  fotos: new Map([['e/o/a1.jpg', 'data:image/jpeg;base64,AAAA']]),
  logo: 'data:image/png;base64,BBBB',
  cssFontes: '',
  ...extra,
})

const texto = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/\s+/g, ' ')

describe('template do relatório de pendências', () => {
  it('cabeçalho, resumo e seções, com a numeração P-001... contínua (abertas e depois resolvidas)', () => {
    const html = montarHtmlRelatorio(relatorioExemplo(), opcoes())
    const t = texto(html)
    expect(html).toContain('<img src="data:image/png;base64,BBBB"')
    expect(t).toContain('ASSUNTO RELATÓRIO DE PENDÊNCIAS')
    expect(t).toContain('ETAPA 2ª ETAPA')
    expect(t).toContain('OBRA Todas as obras')
    expect(t).toContain('Posição em 13/11/2026 às 12:04')
    expect(t).toContain('PENDÊNCIAS ABERTAS')
    expect(t).toContain('PENDÊNCIAS RESOLVIDAS')
    expect(t).toContain('P-001 · HTO › Térreo › Sala 01')
    expect(t).toContain('P-002 · Bloco B')
    expect(t).toContain('P-003')
    expect(t.indexOf('P-002')).toBeLessThan(t.indexOf('P-003'))
    expect(t).toContain('aberta em 10/11/2026 · há 3 dias')
    expect(t).toContain('Resolvida em 12/11/2026 por Patrício (2 dias)')
    expect(t).toContain('Reparo feito.')
    expect(html).toContain('src="data:image/jpeg;base64,AAAA"')
    expect(t).toContain('foto indisponível')
  })

  it('KPIs e tabela por obra quando não há filtro de obra', () => {
    const r = relatorioExemplo()
    const e = estatisticas(r.pendencias)
    expect(e).toMatchObject({ total: 3, pct: 33, medio: 2 })
    const t = texto(montarHtmlRelatorio(r, opcoes()))
    expect(t).toContain('3 registradas')
    expect(t).toContain('33% resolvidas')
    expect(t).toContain('Aberta mais antiga')
    expect(t).toContain('Bloco B 1 0 1 7 dias')
    expect(t).toContain('HTO 1 1 2 3 dias')
  })

  it('com filtro de obra: mostra a obra e omite a tabela por obra', () => {
    const r = relatorioExemplo({ obra: { id: 'x', slug: 'hto', nome: 'HTO' } })
    const html = montarHtmlRelatorio(r, opcoes())
    expect(texto(html)).toContain('OBRA HTO')
    expect(html).not.toContain('Aberta mais antiga')
  })

  it('escapa o texto do usuário e mantém as quebras de linha', () => {
    const html = montarHtmlRelatorio(relatorioExemplo(), opcoes())
    expect(html).toContain('Rachadura na parede &lt;1&gt; &amp; infiltração<br>verificar')
    expect(html).not.toContain('<1>')
  })

  it('lista vazia e logo opcional', () => {
    const html = montarHtmlRelatorio(relatorioExemplo({ pendencias: [] }), opcoes({ logo: null }))
    expect(texto(html)).toContain('Nenhuma pendência registrada.')
    expect(html).not.toContain('Logo da organização')
    expect(html).not.toContain('PENDÊNCIAS ABERTAS')
  })

  it('caminhos das fotos sem repetição e rodapé com a etapa', () => {
    expect(caminhosDasFotos(relatorioExemplo())).toEqual(['e/o/a1.jpg', 'e/o/b1.jpg', 'e/o/a2.jpg', 'e/o/a3.jpg', 'e/o/b3.jpg', 'e/o/c3.jpg'])
    expect(rodapeRelatorio('2ª ETAPA')).toContain('Relatório de pendências · 2ª ETAPA · página')
  })
})
