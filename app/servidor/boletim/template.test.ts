// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { FIXTURES } from './exemplo.js'
import { caminhosDasFotos, MARCA_PREVIA, montarHtml, rodapeHtml, type OpcoesTemplate } from './template.js'
import type { Snapshot } from './tipos.js'

const snapshot = (): Snapshot => JSON.parse(readFileSync(path.join(FIXTURES, 'snapshot-exemplo.json'), 'utf8')) as Snapshot

const opcoes = (extra: Partial<OpcoesTemplate> = {}): OpcoesTemplate => ({
  numero: 'BA2/261113/COFZ',
  revisao: 0,
  emitidoEm: new Date('2026-11-14T02:30:00Z'), // 23:30 em Fortaleza
  fotos: new Map(),
  logo: 'data:image/png;base64,AAAA',
  climaImagem: null,
  cssFontes: '',
  ...extra,
})

/** Texto visível aproximado (sem tags), para as asserções. */
const texto = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')

describe('template do boletim', () => {
  it('cabeçalho no modelo da CO-FZ: logo, linhas da OM, número, expedição e responsáveis', () => {
    const html = montarHtml(snapshot(), opcoes())
    expect(html).toContain('<img src="data:image/png;base64,AAAA" alt="Logo da OM">')
    const t = texto(html)
    expect(t).toContain('COMANDO DA AERONÁUTICA DIRETORIA DE INFRAESTRUTURA DA AERONÁUTICA COMISSÃO DE OBRAS DE FORTALEZA (CO-FZ)')
    expect(t).toContain('Nº DO DOCUMENTO BA2/261113/COFZ EXPEDIÇÃO 13/11/26 · 23:30')
    expect(t).toContain('ASSUNTO BOLETIM DE ACOMPANHAMENTO DIÁRIO')
    expect(t).toContain('RESPONSÁVEIS 3S JOÃO FELIPE, CP PATRICIO')
    // LOCAL com quebra de linha
    expect(html).toContain('INSTITUTO TECNOLÓGICO DE AERONÁUTICA - CAMPUS FORTALEZA<br>Av Borges de Melo')
  })

  it('tem as seções 1 a 8 na ordem, com dados do contrato e prazo', () => {
    const t = texto(montarHtml(snapshot(), opcoes()))
    const titulos = [
      '1. DADOS DA OBRA/SERVIÇO',
      '2. CONDIÇÕES METEOROLÓGICAS',
      '3. INDICADORES',
      '4. SERVIÇOS EM EXECUÇÃO',
      '5. PENDÊNCIAS ABERTAS NO DIA (4)',
      '6. PENDÊNCIAS ENCERRADAS NO DIA (2)',
      '7. OBSERVAÇÕES',
      '8. RESPONSÁVEIS',
    ]
    const posicoes = titulos.map((x) => t.indexOf(x))
    expect(posicoes.every((p) => p >= 0)).toBe(true)
    expect([...posicoes].sort((a, b) => a - b)).toEqual(posicoes)
    expect(t).toContain('ÁREA TOTAL CONSTRUÍDA: 86.102,17 m²')
    expect(t).toContain('VALOR ORIGINAL: R$ 79.499.000,00')
    expect(t).toContain('ADITIVOS: 1º TA (10/03/2026; +90 dias, R$ 1.250.000,00)')
    expect(t).toContain('TÉRMINO ATUAL: 04/02/2028')
    expect(t).toContain('PRAZO DECORRIDO: 464 de 912 dias (50,9%) · restam 448 dias')
    // sem o bloco de indicadores de clima (fora do escopo)
    expect(t).not.toMatch(/Dias com chuva|Chuva acumulada/)
  })

  it('serviços por obra com as fotos 4 por linha, pendências e observações', () => {
    const s = snapshot()
    const fotos = new Map(caminhosDasFotos(s).map((c) => [c, `data:image/jpeg;base64,${c}`] as [string, string]))
    fotos.set('exemplo/foto-02.jpg', null as unknown as string)
    const html = montarHtml(s, opcoes({ fotos: fotos as Map<string, string | null> }))
    expect(html).toContain('.fotos { display: grid; grid-template-columns: repeat(4, 1fr)')
    expect(html).toContain('src="data:image/jpeg;base64,exemplo/foto-01.jpg"')
    expect(html).toContain('foto indisponível')
    const t = texto(html)
    expect(t).toContain('Térreo › Apto. 101 08:14 · 3S JOÃO FELIPE')
    expect(t).toContain('Foto 5 · 08:14')
    expect(t).toContain('BLOCO DE ALOJAMENTO › Térreo › Banheiro Apto. 104 09:02 · 3S JOÃO FELIPE')
    expect(t).toContain('aberta em 05/11 (8 dias)')
    expect(t).toContain('Encerramento (13:20 · CP PATRICIO): Rejunte refeito')
    expect(t).toContain('Antes (registro original)')
    expect(t).toContain('Depois (comprovação)')
    expect(t).toContain('17:40 · 3S JOÃO FELIPE (editada)')
    expect(t).toContain('Lançamentos de dias anteriores recebidos após a emissão')
    expect(t).toContain('12/11/2026 17:55 recebido em 13/11/2026 às 08:02')
    expect(caminhosDasFotos(s)).toHaveLength(22)
  })

  it('escapa o texto do usuário', () => {
    const s = snapshot()
    s.obras[0].observacoes[0].texto = '<script>alert(1)</script> & "aspas"'
    const html = montarHtml(s, opcoes())
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;aspas&quot;')
  })

  it('clima: imagem copiada com a legenda da fonte e dos horários', () => {
    const s = snapshot()
    s.clima = {
      fonte: 'Observatório de Riscos Climáticos de Fortaleza (Prefeitura de Fortaleza)',
      estacao: { codigo: '8836', nome: 'Montese' },
      leitura: '23:20',
      copiado_em: '2026-11-14T02:30:00Z',
      imagem_path: null,
    }
    const html = montarHtml(s, opcoes({ climaImagem: 'data:image/png;base64,CLIMA' }))
    expect(html).toContain('<img src="data:image/png;base64,CLIMA"')
    expect(texto(html)).toContain(
      'Fonte: Observatório de Riscos Climáticos de Fortaleza (Prefeitura de Fortaleza), estação Montese (8836) — leitura das 23:20, cópia de 13/11/2026 às 23:30 (horário de Fortaleza).',
    )
    // pela reserva
    s.clima.estacao = { codigo: '9281', nome: 'Benfica' }
    expect(texto(montarHtml(s, opcoes({ climaImagem: 'data:image/png;base64,CLIMA' })))).toContain('estação Benfica (9281, reserva)')
  })

  it('clima reaproveitado: a legenda diz de qual boletim veio', () => {
    const s = snapshot()
    s.clima = {
      fonte: 'Observatório',
      estacao: { codigo: '8836', nome: 'Montese' },
      leitura: '23:20',
      copiado_em: '2026-11-14T02:30:00Z',
      imagem_path: null,
      reaproveitado_de: 'BA2/261113/COFZ <x>',
    }
    const t = texto(montarHtml(s, opcoes({ climaImagem: 'data:image/png;base64,CLIMA' })))
    expect(t).toContain(
      'cópia de 13/11/2026 às 23:30 (horário de Fortaleza) — reaproveitada do boletim BA2/261113/COFZ &lt;x>, pois o Observatório só mostra as últimas 24 horas. Últimas 24 horas',
    )
  })

  it('clima indisponível: aviso do Observatório com o motivo', () => {
    const s = snapshot()
    s.clima = { indisponivel: true, motivo: 'leitura da estação 8836 com mais de 3 h' }
    const t = texto(montarHtml(s, opcoes()))
    expect(t).toContain('Dados meteorológicos indisponíveis (Observatório de Fortaleza).')
    expect(t).toContain('Motivo: leitura da estação 8836 com mais de 3 h.')
    expect(t).not.toContain('Fonte: Observatório')
  })

  it('dia sem lançamentos: avisos de vazio e sem tabela de tardios', () => {
    const s = snapshot()
    s.obras = s.obras.map((o) => ({ ...o, servicos: [], pendencias_abertas: [], pendencias_encerradas: [], observacoes: [] }))
    s.tardios = []
    const t = texto(montarHtml(s, opcoes()))
    expect(t).toContain('Nenhum registro de serviço no dia.')
    expect(t).toContain('5. PENDÊNCIAS ABERTAS NO DIA (0) Nenhuma pendência aberta no dia.')
    expect(t).toContain('Nenhuma pendência encerrada no dia.')
    expect(t).toContain('Nenhuma observação no dia.')
    expect(t).not.toContain('recebidos após a emissão DATA')
  })

  it('retificação e prévia', () => {
    const r = texto(montarHtml(snapshot(), opcoes({ numero: 'BA2/261113/COFZ-R1', revisao: 1 })))
    expect(r).toContain('BA2/261113/COFZ-R1')
    expect(r).toContain('Retificação R1: substitui as versões anteriores do boletim deste dia.')
    const html = montarHtml(snapshot(), opcoes({ numero: null }))
    const p = texto(html)
    expect(p).toContain(`Nº DO DOCUMENTO ${MARCA_PREVIA}`)
    expect(html).toContain('<div class="marca-previa">PRÉVIA</div>')
    expect(p).toContain('Não é um boletim emitido.')
    expect(p).not.toContain('BA2/261113/COFZ')
  })

  it('rodapé com número e "Página x de y"', () => {
    const r = rodapeHtml('BA2/261113/COFZ', '@font-face{}')
    expect(r).toContain('<style>@font-face{}</style>')
    expect(r).toContain('BA2/261113/COFZ · Boletim de Acompanhamento Diário')
    expect(r).toContain('Página <span class="pageNumber"></span> de <span class="totalPages"></span>')
    expect(rodapeHtml(null)).toContain(MARCA_PREVIA)
  })
})
