/**
 * HTML do relatório de pendências, no visual do boletim (mesmo CSS, cabeçalho em tabela, fotos
 * em grade). O rodapé ("página x de y") vai no `footerTemplate` do Chromium (`rodapeRelatorio`).
 */
import { CSS } from '../boletim/template.js'
import { comQuebras, dataBr, dataHoraBr, escapar, numeroBr } from '../boletim/formato.js'
import type { FotoRelatorio, PendenciaRelatorio, RelatorioPendencias } from './tipos.js'

export interface OpcoesRelatorio {
  /** Foto (caminho no bucket `fotos`) → data URL; null/ausente = não foi possível baixar. */
  fotos: Map<string, string | null>
  logo: string | null
  /** `@font-face` das fontes embutidas (`cssFontes()`). */
  cssFontes: string
}

const CSS_RELATORIO = `
.fotos { grid-template-columns: repeat(2, 1fr); }
.cartao { border: 1px solid #bbb; padding: 6px 8px; margin-bottom: 6px; break-inside: avoid; }
.cartao .reg-cab b { font-size: 10.5pt; }
.cartao .meta { font-size: 9pt; color: #444; margin: 2px 0; }
.cartao .resolucao { margin-top: 6px; padding-top: 4px; border-top: 1px dashed #999; font-size: 10pt; }
.tag.resolvida { background: #dcefdc; color: #1f5f24; }
`

export const TITULO = 'RELATÓRIO DE PENDÊNCIAS'

function cabecalho(r: RelatorioPendencias, o: OpcoesRelatorio): string {
  const logo = o.logo ? `<img src="${o.logo}" alt="Logo da organização">` : ''
  const posicao = dataHoraBr(new Date(r.gerado_em), r.fuso)
  return `<table class="cab">
<tr>
  <td class="logo">${logo}</td>
  <td class="om"><div class="l1">${escapar(r.organizacao.nome)}</div></td>
  <td class="doc"><div class="rot">POSIÇÃO</div><div class="val">${escapar(posicao.replace(' às ', ' · '))}</div></td>
</tr>
<tr><td class="chave cinza">ASSUNTO</td><td colspan="2" class="assunto">${TITULO}</td></tr>
<tr><td class="chave cinza">ETAPA</td><td colspan="2">${escapar(r.etapa.nome)}</td></tr>
<tr><td class="chave cinza">OBRA</td><td colspan="2">${escapar(r.obra ? r.obra.nome : 'Todas as obras')}</td></tr>
</table>
<div class="emissao">Posição em ${escapar(posicao)}</div>`
}

const plural = (n: number, um: string, varios: string) => `${numeroBr(n)} ${n === 1 ? um : varios}`

export function estatisticas(pendencias: PendenciaRelatorio[]) {
  const abertas = pendencias.filter((p) => p.situacao === 'aberta')
  const resolvidas = pendencias.filter((p) => p.situacao === 'resolvida')
  const pct = pendencias.length === 0 ? 0 : Math.round((resolvidas.length / pendencias.length) * 100)
  const medio = resolvidas.length === 0 ? null : resolvidas.reduce((a, p) => a + p.dias, 0) / resolvidas.length
  return { total: pendencias.length, abertas, resolvidas, pct, medio }
}

function secaoResumo(r: RelatorioPendencias): string {
  const e = estatisticas(r.pendencias)
  const kpi = (v: string, rotulo: string, classe = '') =>
    `<div class="kpi ${classe}"><div class="v">${escapar(v)}</div><div class="r">${escapar(rotulo)}</div></div>`
  const kpis = `<div class="kpis" style="grid-template-columns: repeat(5, 1fr)">
${kpi(numeroBr(e.total), 'registradas')}${kpi(numeroBr(e.abertas.length), 'abertas', 'mais')}${kpi(numeroBr(e.resolvidas.length), 'resolvidas', 'menos')}${kpi(`${e.pct}%`, 'resolvidas (percentual)', 'dest')}${kpi(e.medio === null ? '—' : numeroBr(e.medio, 1), 'dias, em média, para resolver')}
</div>`
  let tabela = ''
  if (!r.obra && r.pendencias.length > 0) {
    const nomes = [...new Set(r.pendencias.map((p) => p.obra))]
    const linhas = nomes.map((nome) => {
      const doObra = r.pendencias.filter((p) => p.obra === nome)
      const ab = doObra.filter((p) => p.situacao === 'aberta')
      const antiga = ab.length === 0 ? '—' : plural(Math.max(...ab.map((p) => p.dias)), 'dia', 'dias')
      return `<tr><td>${escapar(nome)}</td><td>${ab.length}</td><td>${doObra.length - ab.length}</td><td>${doObra.length}</td><td>${antiga}</td></tr>`
    })
    tabela = `<table class="obras"><tr><th>Obra</th><th>Abertas</th><th>Resolvidas</th><th>Total</th><th>Aberta mais antiga</th></tr>${linhas.join('')}</table>`
  }
  return `<h2><span>1.</span>RESUMO</h2><div class="sec">${kpis}${tabela}</div>`
}

function foto(o: OpcoesRelatorio, f: FotoRelatorio, rotulo: string): string {
  const src = o.fotos.get(f.path) ?? null
  const img = src ? `<img src="${src}" alt="">` : '<span class="falta">foto indisponível</span>'
  return `<figure class="foto"><div class="img">${img}</div><figcaption>${escapar(rotulo)}</figcaption></figure>`
}

function fotosDe(o: OpcoesRelatorio, fotos: FotoRelatorio[], rotulo: (i: number) => string): string {
  if (fotos.length === 0) return ''
  return `<div class="fotos">${fotos.map((f, i) => foto(o, f, rotulo(i))).join('')}</div>`
}

const codigo = (n: number) => `P-${String(n).padStart(3, '0')}`

function cartao(p: PendenciaRelatorio, n: number, r: RelatorioPendencias, o: OpcoesRelatorio): string {
  const local = [p.obra, p.pavimento, p.ambiente].filter(Boolean).map(escapar).join(' › ')
  const aberta = p.situacao === 'aberta'
  const desde = `aberta em ${dataBr(p.aberta_em, r.fuso)}${aberta ? ` · há ${plural(p.dias, 'dia', 'dias')}` : ''}`
  const enc = p.encerramento
  const resolucao = enc
    ? `<div class="resolucao"><b>Resolvida em ${dataBr(enc.em, r.fuso)} por ${escapar(enc.autor)} (${plural(p.dias, 'dia', 'dias')})</b>${
        enc.observacao ? `<p>${comQuebras(enc.observacao)}</p>` : ''
      }${fotosDe(o, enc.fotos, (i) => `Resolução · foto ${i + 1}`)}</div>`
    : ''
  return `<div class="cartao"><div class="reg-cab"><b>${codigo(n)} · ${local}</b><span class="tag ${aberta ? 'aberta' : 'resolvida'}">${aberta ? 'ABERTA' : 'RESOLVIDA'}</span></div>
<div class="meta">${escapar(desde)} · ${escapar(p.autor)}</div>
${p.legenda ? `<p>${comQuebras(p.legenda)}</p>` : ''}${fotosDe(o, p.fotos, (i) => `Foto ${i + 1}`)}${resolucao}</div>`
}

export function montarHtmlRelatorio(r: RelatorioPendencias, o: OpcoesRelatorio): string {
  const abertas = r.pendencias.filter((p) => p.situacao === 'aberta')
  const resolvidas = r.pendencias.filter((p) => p.situacao === 'resolvida')
  const lista = (titulo: string, itens: PendenciaRelatorio[], inicio: number, rot: string) =>
    `<h2><span>${rot}</span>${titulo}</h2><div class="sec">${
      itens.length === 0 ? '<p class="vazio">Nenhuma.</p>' : itens.map((p, i) => cartao(p, inicio + i, r, o)).join('')
    }</div>`
  const corpo =
    r.pendencias.length === 0
      ? '<p class="vazio">Nenhuma pendência registrada.</p>'
      : `${secaoResumo(r)}${lista('PENDÊNCIAS ABERTAS', abertas, 1, '2.')}${lista('PENDÊNCIAS RESOLVIDAS', resolvidas, abertas.length + 1, '3.')}`
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>${TITULO}</title>
<style>
${o.cssFontes}
${CSS}
${CSS_RELATORIO}
</style></head><body>
${cabecalho(r, o)}
${corpo}
</body></html>
`
}

/** Caminhos de todas as fotos do relatório (sem repetição). */
export function caminhosDasFotos(r: RelatorioPendencias): string[] {
  return [...new Set(r.pendencias.flatMap((p) => [...p.fotos, ...(p.encerramento?.fotos ?? [])]).map((f) => f.path))]
}

/** `footerTemplate` do Chromium: "Relatório de pendências · <etapa> · página X de Y". */
export function rodapeRelatorio(etapa: string, cssFonte = ''): string {
  return (
    (cssFonte ? `<style>${cssFonte}</style>` : '') +
    '<div style="width:100%;font-family:\'Boletim Serif\',\'Liberation Serif\',serif;font-size:8px;color:#444;padding:0 12mm;text-align:center">' +
    `Relatório de pendências · ${escapar(etapa)} · página <span class="pageNumber"></span> de <span class="totalPages"></span></div>`
  )
}
