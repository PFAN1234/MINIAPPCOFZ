/**
 * HTML do Boletim de Acompanhamento Diário a partir do snapshot, no layout da prévia v2
 * (docs/mockups/boletim-diario-v2.pdf, gerada por docs/mockups/reproduce/boletim/gerar.py):
 * cabeçalho no modelo da CO-FZ, seções 1 a 8, fotos 4 por linha, A4. O rodapé (número e
 * "Página x de y") vai no `footerTemplate` do Chromium (`rodapeHtml`).
 */
import { ESTACOES, FONTE_CLIMA, FUSO_OBSERVATORIO } from './estacoes.js'
import {
  areaM2,
  cidadeDoFuso,
  comQuebras,
  dataBr,
  dataHoraBr,
  diaMesBr,
  diasComSinal,
  escapar,
  expedicao,
  horaBr,
  moeda,
  numeroBr,
  partesNoFuso,
} from './formato.js'
import type { FotoSnapshot, ObraSnapshot, PendenciaEncerradaSnapshot, RegistroSnapshot, Snapshot } from './tipos.js'

export const MARCA_PREVIA = 'PRÉVIA — sem número'

export interface OpcoesTemplate {
  /** Número do boletim; null = prévia. */
  numero: string | null
  /** Revisão (0 = original). */
  revisao: number
  /** Instante da emissão (ou da prévia). */
  emitidoEm: Date
  /** Foto (caminho no bucket `fotos`) → data URL; null = não foi possível baixar. */
  fotos: Map<string, string | null>
  /** Logo da OM em data URL. */
  logo: string | null
  /** Imagem do clima (linha da estação) em data URL. */
  climaImagem: string | null
  /** `@font-face` das fontes embutidas (`cssFontes()`); vazio usa as do sistema. */
  cssFontes: string
}

export const CSS = `
@page { size: A4; margin: 12mm 12mm 16mm 12mm; }
* { box-sizing: border-box; }
html { padding-right: 2px; }
body { margin: 0; font-family: "Boletim Serif", "Liberation Serif", "Times New Roman", serif; color: #111; font-size: 11.5pt; }
table.cab { width: 100%; border-collapse: collapse; }
table.cab td { border: 1.4px solid #222; padding: 4px 8px; vertical-align: middle; }
.cinza { background: #d9d9d9; }
.logo { width: 19%; text-align: center; }
.logo img { width: 112px; max-height: 140px; object-fit: contain; display: block; margin: 4px auto; }
.om { text-align: center; font-weight: bold; line-height: 1.15; }
.om .l1 { font-size: 14.5pt; } .om .l2 { font-size: 10.8pt; } .om .curta { white-space: nowrap; }
.doc { width: 26%; text-align: center; padding: 0 !important; }
.doc div { border-bottom: 1.4px solid #222; padding: 6px 4px; }
.doc div:last-child { border-bottom: 0; }
.doc .rot { background: #d9d9d9; font-size: 8.5pt; }
.doc .val { font-weight: bold; font-size: 11.5pt; }
.doc .val.previa { color: #8b1e1e; font-size: 10.5pt; }
.chave { font-weight: bold; font-size: 10.5pt; width: 19%; }
.assunto { text-align: center; font-weight: bold; font-size: 15pt; }
.just { text-align: justify; }
h2 { font-size: 12.5pt; margin: 14px 0 6px; display: flex; gap: 10px; break-after: avoid; }
h3.obra { font-size: 10.5pt; margin: 10px 0 4px; letter-spacing: .03em; border-bottom: 1px solid #999; padding-bottom: 2px; break-after: avoid; text-transform: uppercase; }
.dados { padding-left: 26px; font-size: 10.8pt; line-height: 1.45; }
.dados span { margin-right: 18px; }
.prazo { margin: 8px 0 0 26px; font-size: 10pt; break-inside: avoid; }
.barra { height: 9px; background: #e4e4e4; border: 1px solid #999; margin: 3px 0; position: relative; }
.barra i { position: absolute; inset: 0 auto 0 0; background: #3d5f8c; }
.barra em { position: absolute; top: -3px; bottom: -3px; border-left: 2px solid #111; }
.legenda-prazo { display: flex; justify-content: space-between; color: #333; font-size: 9pt; }
.clima { break-inside: avoid; }
.clima img { display: block; width: 100%; border: 1px solid #bbb; }
.fonte { font-size: 8.5pt; color: #444; margin-top: 3px; }
.indisponivel { border: 1px solid #999; padding: 6px 8px; font-size: 10pt; color: #444; }
.indisponivel small { display: block; color: #666; font-size: 8.5pt; margin-top: 2px; }
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; }
.kpi { border: 1px solid #999; padding: 5px 7px; break-inside: avoid; }
.kpi .v { font-size: 17pt; font-weight: bold; line-height: 1.1; }
.kpi .r { font-size: 8.8pt; color: #333; }
.kpi.mais .v { color: #a33; } .kpi.menos .v { color: #2e7d32; }
.kpi.dest { background: #eef2f8; border-color: #3d5f8c; }
.grupo { font-size: 9pt; font-weight: bold; color: #333; margin: 8px 0 3px; text-transform: uppercase; letter-spacing: .04em; break-after: avoid; }
.kpis3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; }
.linha { border: 1px solid #999; padding: 5px 8px; font-size: 9.6pt; line-height: 1.35; break-inside: avoid; }
.linha b { font-size: 11pt; }
table.obras { width: 100%; border-collapse: collapse; font-size: 9.6pt; margin-top: 6px; }
table.obras th, table.obras td { border: 1px solid #555; padding: 3px 6px; text-align: center; }
table.obras th { background: #d9d9d9; font-size: 8.8pt; }
table.obras td:first-child { text-align: left; }
table.obras tr.total td { font-weight: bold; background: #f0f0f0; }
table.obras tr { break-inside: avoid; }
.registro { border: 1px solid #bbb; padding: 6px 8px; margin-bottom: 6px; break-inside: avoid; position: relative; }
.reg-cab { display: flex; justify-content: space-between; gap: 8px; font-size: 10pt; }
.reg-cab span { color: #444; font-size: 9pt; white-space: nowrap; }
.registro p, .pend p { margin: 3px 0 5px; font-size: 10pt; text-align: justify; }
.fotos { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.foto { margin: 0; break-inside: avoid; }
.foto .img { aspect-ratio: 4 / 3; background: #eee; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.foto img { width: 100%; height: 100%; object-fit: contain; display: block; }
.foto .falta { font-family: "Boletim Sans", "Liberation Sans", sans-serif; font-size: 8pt; color: #777; text-align: center; padding: 4px; }
.foto figcaption { font-size: 8.5pt; color: #444; margin-top: 2px; }
.foto figcaption:empty { display: none; }
.pendencias { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.pend { border: 1px solid #bbb; padding: 6px; display: grid; grid-template-columns: 38% 1fr; gap: 8px; break-inside: avoid; }
.pendencias .larga { grid-column: 1 / -1; margin-bottom: 0; }
.larga .tag { display: inline-block; margin-top: 4px; }
.pend .reg-cab { flex-direction: column; gap: 1px; font-size: 9.2pt; }
.pend .reg-cab span { white-space: normal; }
.pend p { font-size: 9.4pt; }
.tag { font-family: "Boletim Sans", "Liberation Sans", sans-serif; font-size: 7.5pt; font-weight: bold; padding: 1px 5px; border-radius: 2px; letter-spacing: .05em; }
.tag.aberta { background: #f6dede; color: #8b1e1e; }
.nota { font-size: 8.8pt; color: #555; font-style: italic; margin: 2px 0 0; }
.vazio { font-size: 10pt; color: #444; margin: 2px 0 6px; }
.obs-obra { font-size: 10pt; margin: 2px 0 8px; }
.obs-obra .item { display: grid; grid-template-columns: 150px 1fr; gap: 8px; padding: 3px 0; border-bottom: 1px dotted #bbb; break-inside: avoid; }
.obs-obra .quem { color: #444; font-size: 9pt; }
table.equipe { width: 100%; border-collapse: collapse; font-size: 9.4pt; margin-bottom: 8px; }
table.equipe th, table.equipe td { border: 1px solid #999; padding: 3px 5px; text-align: left; }
table.equipe th { background: #d9d9d9; font-size: 8.5pt; }
table.tardios { width: 100%; border-collapse: collapse; font-size: 9.4pt; }
table.tardios th, table.tardios td { border: 1px solid #999; padding: 3px 5px; text-align: left; vertical-align: top; }
table.tardios th { background: #d9d9d9; font-size: 8.5pt; }
table.tardios tr { break-inside: avoid; }
table.tardios td:nth-child(-n+2), table.tardios td:nth-child(4) { white-space: nowrap; }
.assinaturas { display: grid; grid-template-columns: 1fr 1fr; gap: 34px 40px; margin: 34px 30px 0; }
.assinaturas.uma { grid-template-columns: 1fr; width: 50%; margin: 34px auto 0; }
.assin { text-align: center; font-size: 10pt; break-inside: avoid; }
.assin div { border-top: 1px solid #111; padding-top: 3px; }
.emissao { margin-top: 16px; font-size: 9pt; color: #333; border-top: 1px solid #ccc; padding-top: 6px; }
.sec { padding-left: 26px; }
.marca-previa { position: fixed; top: 42%; left: 0; right: 0; text-align: center; font-family: "Boletim Sans", "Liberation Sans", sans-serif; font-size: 64pt; font-weight: bold; color: rgba(139, 30, 30, .09); transform: rotate(-28deg); pointer-events: none; z-index: 10; }
`

const cel = (rotulo: string, valor: string) => `<b>${escapar(rotulo)}:</b> ${valor}`

function linhaDados(partes: (string | null)[]): string {
  const p = partes.filter((x): x is string => x !== null)
  if (p.length === 0) return ''
  return `<div>${p.map((x, i) => (i < p.length - 1 ? `<span>${x}</span>` : x)).join('')}</div>`
}

const ou = (v: string | null | undefined) => (v ? escapar(v) : '—')

function cabecalho(s: Snapshot, o: OpcoesTemplate): string {
  const linhas = s.organizacao.cabecalho.length > 0 ? s.organizacao.cabecalho : [s.organizacao.nome]
  // Linhas curtas não quebram (como na prévia v2); as longas quebram para não sair da célula.
  const om = linhas
    .map((l, i) => `<div class="${i === 0 ? 'l1' : 'l2'}${l.length <= 48 ? ' curta' : ''}">${escapar(l)}</div>`)
    .join('')
  const logo = o.logo ? `<img src="${o.logo}" alt="Logo da OM">` : ''
  const numero = o.numero
    ? `<div class="val">${escapar(o.numero)}</div>`
    : `<div class="val previa">${escapar(MARCA_PREVIA)}</div>`
  const responsaveis = s.responsaveis.map((r) => escapar(r.nome)).join(', ') || '—'
  return `<table class="cab">
<tr>
  <td class="logo">${logo}</td>
  <td class="om">${om}</td>
  <td class="doc"><div class="rot">Nº DO DOCUMENTO</div>${numero}<div class="rot">EXPEDIÇÃO</div><div class="val">${escapar(expedicao(o.emitidoEm, s.fuso))}</div></td>
</tr>
<tr><td class="chave cinza">ASSUNTO</td><td colspan="2" class="assunto">BOLETIM DE ACOMPANHAMENTO DIÁRIO</td></tr>
<tr><td class="chave cinza">OBRA/SERVIÇO</td><td colspan="2" class="just">${comQuebras(s.etapa.objeto ?? s.etapa.nome)}</td></tr>
<tr><td class="chave cinza">LOCAL</td><td colspan="2">${comQuebras(s.etapa.local ?? s.etapa.endereco ?? '—')}</td></tr>
<tr><td class="chave cinza">RESPONSÁVEIS</td><td colspan="2">${responsaveis}</td></tr>
</table>`
}

function secaoDados(s: Snapshot): string {
  const e = s.etapa
  const aditivos =
    e.aditivos.length === 0
      ? 'nenhum'
      : e.aditivos
          .map((a) => {
            const efeitos = [a.prazo_dias !== 0 ? diasComSinal(a.prazo_dias) : null, a.valor !== 0 ? moeda(a.valor) : null]
              .filter(Boolean)
              .join(', ')
            return `${escapar(a.numero)} (${dataBr(a.data)}${efeitos ? `; ${efeitos}` : ''})`
          })
          .join('; ')
  const contratada = e.contratada
    ? `${escapar(e.contratada)}${e.contratada_cnpj ? ` · CNPJ ${escapar(e.contratada_cnpj)}` : ''}`
    : '—'
  const prazo = e.prazo
  const termino = prazo ? cel('TÉRMINO ATUAL', dataBr(prazo.termino_atual)) : null
  const valorAtual = prazo?.valor_atual != null ? cel('VALOR ATUALIZADO', moeda(prazo.valor_atual)) : null
  const dados = [
    linhaDados([cel('CONTRATANTE', ou(e.contratante))]),
    linhaDados([
      e.area_construida_m2 != null ? cel('ÁREA TOTAL CONSTRUÍDA', areaM2(e.area_construida_m2)) : null,
      cel('CONTRATO', ou(e.contrato)),
    ]),
    linhaDados([cel('CONTRATADA', contratada)]),
    linhaDados([cel('ORDEM DE SERVIÇO Nº', ou(e.os_numero)), cel('DATA DE ASSINATURA DA OS', e.os_data ? dataBr(e.os_data) : '—')]),
    linhaDados([
      cel('VIGÊNCIA ORIGINAL', e.vigencia_meses != null ? `${e.vigencia_meses} ${e.vigencia_meses === 1 ? 'mês' : 'meses'}` : '—'),
      cel('VALOR ORIGINAL', e.valor_original != null ? moeda(e.valor_original) : '—'),
    ]),
    // Sem aditivos, uma linha só (como na prévia v2); com aditivos, a lista ocupa a linha dela.
    ...(e.aditivos.length === 0
      ? [linhaDados([cel('ADITIVOS', aditivos), termino, valorAtual])]
      : [linhaDados([cel('ADITIVOS', aditivos)]), linhaDados([termino, valorAtual])]),
  ].join('\n')
  let barra = ''
  if (prazo && prazo.dias_totais > 0) {
    const pct = Math.max(0, Math.min(100, prazo.percentual ?? 0))
    const restam =
      prazo.dias_restantes >= 0
        ? `restam ${numeroBr(prazo.dias_restantes)} ${prazo.dias_restantes === 1 ? 'dia' : 'dias'}`
        : `prazo vencido há ${numeroBr(-prazo.dias_restantes)} ${prazo.dias_restantes === -1 ? 'dia' : 'dias'}`
    barra = `<div class="prazo">
  <b>PRAZO DECORRIDO:</b> ${numeroBr(prazo.dias_decorridos)} de ${numeroBr(prazo.dias_totais)} dias (${numeroBr(prazo.percentual ?? 0, 1)}%) · ${restam}
  <div class="barra"><i style="width:${pct.toFixed(2)}%"></i><em style="left:${pct.toFixed(2)}%"></em></div>
  <div class="legenda-prazo"><span>OS ${e.os_data ? dataBr(e.os_data) : '—'}</span><span>hoje ${dataBr(s.data)}</span><span>término ${dataBr(prazo.termino_atual)}</span></div>
</div>`
  }
  return `<h2><span>1.</span>DADOS DA OBRA/SERVIÇO</h2>\n<div class="dados">\n${dados}\n</div>\n${barra}`
}

/** Legenda da imagem do clima ou o aviso de indisponível. */
export function secaoClima(s: Snapshot, imagem: string | null): string {
  const titulo = '<h2><span>2.</span>CONDIÇÕES METEOROLÓGICAS</h2>'
  const c = s.clima
  if (!c || 'indisponivel' in c || !imagem) {
    const motivo = c && 'indisponivel' in c ? c.motivo : !c ? 'não consultado' : 'imagem não disponível'
    return `${titulo}
<div class="clima"><div class="indisponivel">Dados meteorológicos indisponíveis (Observatório de Fortaleza).<small>Motivo: ${escapar(motivo)}.</small></div></div>`
  }
  const nome = c.estacao.nome || ESTACOES[c.estacao.codigo] || c.estacao.codigo
  const reserva = s.etapa.estacao_reserva === c.estacao.codigo && s.etapa.estacao !== c.estacao.codigo
  const copia = dataHoraBr(new Date(c.copiado_em), FUSO_OBSERVATORIO)
  const leitura = c.leitura ? `leitura das ${escapar(c.leitura)}, ` : ''
  const reaproveitada = c.reaproveitado_de
    ? ` — reaproveitada do boletim ${escapar(c.reaproveitado_de)}, pois o Observatório só mostra as últimas 24 horas`
    : ''
  return `${titulo}
<div class="clima">
<img src="${imagem}" alt="Linha da estação ${escapar(nome)} na tabela Últimas 24 horas do Observatório">
<div class="fonte">Fonte: ${escapar(FONTE_CLIMA)}, estação ${escapar(nome)} (${escapar(c.estacao.codigo)}${reserva ? ', reserva' : ''}) — ${leitura}cópia de ${escapar(copia)} (horário de Fortaleza)${reaproveitada}. Últimas 24 horas até a cópia: temperatura, umidade, chuva acumulada, vento (médio, rumo e rajada) e índice UV.</div>
</div>`
}

function kpi(valor: string, rotulo: string, cls = ''): string {
  return `<div class="kpi ${cls}"><div class="v">${valor}</div><div class="r">${escapar(rotulo)}</div></div>`
}

function secaoIndicadores(s: Snapshot): string {
  const p = s.indicadores.pendencias
  const a = s.indicadores.atividade
  const sinal = (n: number, c: '+' | '−') => (n === 0 ? '0' : `${c}${numeroBr(n)}`)
  const taxa = p.taxa_resolucao == null ? '—' : `${numeroBr(p.taxa_resolucao, 1)}%`
  const tempo =
    p.tempo_medio_resolucao_dias == null
      ? '—'
      : `${numeroBr(p.tempo_medio_resolucao_dias, 1)} ${p.tempo_medio_resolucao_dias === 1 ? 'dia' : 'dias'}`
  const linhasObra = s.indicadores.por_obra
    .map(
      (o) =>
        `<tr><td>${escapar(o.obra)}</td><td>${o.servicos}</td><td>${o.abertas_no_dia}</td><td>${o.encerradas_no_dia}</td><td>${o.abertas_fim}</td><td>${o.mais_15}</td></tr>`,
    )
    .join('')
  const soma = (k: 'servicos' | 'abertas_no_dia' | 'encerradas_no_dia' | 'abertas_fim' | 'mais_15') =>
    s.indicadores.por_obra.reduce((t, o) => t + (o[k] ?? 0), 0)
  const tabela =
    s.indicadores.por_obra.length === 0
      ? ''
      : `<table class="obras">
<tr><th>OBRA</th><th>SERVIÇOS NO DIA</th><th>PEND. ABERTAS NO DIA</th><th>PEND. ENCERRADAS NO DIA</th><th>ABERTAS AO FIM DO DIA</th><th>ABERTAS &gt; 15 DIAS</th></tr>
${linhasObra}
<tr class="total"><td>Total da etapa</td><td>${soma('servicos')}</td><td>${soma('abertas_no_dia')}</td><td>${soma('encerradas_no_dia')}</td><td>${soma('abertas_fim')}</td><td>${soma('mais_15')}</td></tr>
</table>`
  return `<h2><span>3.</span>INDICADORES</h2>
<div class="grupo">Pendências no dia</div>
<div class="kpis">
  ${kpi(numeroBr(p.abertas_inicio), 'abertas no início do dia')}
  ${kpi(sinal(p.abertas_no_dia, '+'), 'abertas no dia', p.abertas_no_dia > 0 ? 'mais' : '')}
  ${kpi(sinal(p.encerradas_no_dia, '−'), 'encerradas no dia', p.encerradas_no_dia > 0 ? 'menos' : '')}
  ${kpi(numeroBr(p.abertas_fim), 'abertas ao fim do dia', 'dest')}
</div>
<div class="grupo">Acumulado desde a OS</div>
<div class="kpis3">
  <div class="linha"><b>${numeroBr(p.total_abertas)}</b> abertas · <b>${numeroBr(p.total_encerradas)}</b> encerradas<br>taxa de resolução <b>${taxa}</b></div>
  <div class="linha">Abertas há mais de 7 / 15 / 30 dias<br><b>${p.mais_7} · ${p.mais_15} · ${p.mais_30}</b></div>
  <div class="linha">Tempo médio de resolução<br><b>${tempo}</b></div>
</div>
<div class="grupo">Atividade no dia</div>
<div class="kpis3">
  <div class="linha"><b>${numeroBr(a.registros_servico)}</b> ${a.registros_servico === 1 ? 'registro' : 'registros'} de serviço · <b>${numeroBr(a.fotos)}</b> ${a.fotos === 1 ? 'foto' : 'fotos'}</div>
  <div class="linha"><b>${numeroBr(a.ambientes)}</b> ${a.ambientes === 1 ? 'ambiente' : 'ambientes'} com lançamento</div>
  <div class="linha"><b>${numeroBr(a.pessoas)}</b> ${a.pessoas === 1 ? 'pessoa' : 'pessoas'} com lançamento</div>
</div>
${tabela}`
}

function foto(o: OpcoesTemplate, f: FotoSnapshot, rotulo: string): string {
  const src = o.fotos.get(f.path) ?? null
  const img = src ? `<img src="${src}" alt="">` : '<span class="falta">foto indisponível</span>'
  return `<figure class="foto"><div class="img">${img}</div><figcaption>${escapar(rotulo)}</figcaption></figure>`
}

function fotosDe(o: OpcoesTemplate, fotos: FotoSnapshot[], rotulo: (i: number) => string): string {
  if (fotos.length === 0) return ''
  return `<div class="fotos">${fotos.map((f, i) => foto(o, f, rotulo(i))).join('')}</div>`
}

const local = (r: { pavimento: string; ambiente: string }) => [r.pavimento, r.ambiente].filter(Boolean).map(escapar).join(' › ')

function secaoServicos(s: Snapshot, o: OpcoesTemplate): string {
  const obras = s.obras.filter((x) => x.servicos.length > 0)
  const corpo =
    obras.length === 0
      ? '<p class="vazio">Nenhum registro de serviço no dia.</p>'
      : obras
          .map(
            (obra) =>
              `<h3 class="obra">${escapar(obra.nome)}</h3>` +
              obra.servicos
                .map((r) => {
                  const hora = horaBr(r.hora, s.fuso)
                  return `<div class="registro"><div class="reg-cab"><b>${local(r)}</b><span>${escapar(hora)} · ${escapar(r.autor)}</span></div>${
                    r.legenda ? `<p>${comQuebras(r.legenda)}</p>` : ''
                  }${fotosDe(o, r.fotos, (i) => `Foto ${i + 1} · ${hora}`)}</div>`
                })
                .join(''),
          )
          .join('')
  return `<h2><span>4.</span>SERVIÇOS EM EXECUÇÃO</h2>\n<div class="sec">${corpo}</div>`
}

function secaoAbertas(s: Snapshot, o: OpcoesTemplate): string {
  const itens: { obra: ObraSnapshot; r: RegistroSnapshot }[] = s.obras.flatMap((obra) => obra.pendencias_abertas.map((r) => ({ obra, r })))
  const titulo = `<h2><span>5.</span>PENDÊNCIAS ABERTAS NO DIA (${itens.length})</h2>`
  if (itens.length === 0) return `${titulo}\n<div class="sec"><p class="vazio">Nenhuma pendência aberta no dia.</p></div>`
  const cards = itens
    .map(({ obra, r }) => {
      const hora = horaBr(r.hora, s.fuso)
      const cab = `<div class="reg-cab"><b>${escapar(obra.nome.toUpperCase())} › ${local(r)}</b><span>${escapar(hora)} · ${escapar(r.autor)}</span></div>`
      const legenda = r.legenda ? `<p>${comQuebras(r.legenda)}</p>` : ''
      if (r.fotos.length > 1) {
        // Várias fotos: a linha inteira, com as fotos 4 por linha.
        return `<div class="registro larga">${cab}${legenda}${fotosDe(o, r.fotos, (i) => `Foto ${i + 1} · ${hora}`)}<span class="tag aberta">ABERTA</span></div>`
      }
      const capa = r.fotos[0]
        ? foto(o, r.fotos[0], '')
        : '<figure class="foto"><div class="img"><span class="falta">sem foto</span></div></figure>'
      return `<div class="pend"><div class="pend-foto">${capa}</div><div>${cab}${legenda}<span class="tag aberta">ABERTA</span></div></div>`
    })
    .join('')
  return `${titulo}\n<div class="sec pendencias">${cards}</div>`
}

function secaoEncerradas(s: Snapshot, o: OpcoesTemplate): string {
  const itens: { obra: ObraSnapshot; p: PendenciaEncerradaSnapshot }[] = s.obras.flatMap((obra) =>
    obra.pendencias_encerradas.map((p) => ({ obra, p })),
  )
  const titulo = `<h2><span>6.</span>PENDÊNCIAS ENCERRADAS NO DIA (${itens.length})</h2>`
  if (itens.length === 0) return `${titulo}\n<div class="sec"><p class="vazio">Nenhuma pendência encerrada no dia.</p></div>`
  const blocos = itens
    .map(({ obra, p }) => {
      const enc = p.encerramento
      const aberta = `aberta em ${diaMesBr(p.aberta_em, s.fuso)} (${p.dias_aberta} ${p.dias_aberta === 1 ? 'dia' : 'dias'})`
      const fotos = [
        ...p.fotos_registro.map((f) => ({ f, rotulo: 'Antes (registro original)' })),
        ...enc.fotos.map((f) => ({ f, rotulo: 'Depois (comprovação)' })),
      ]
      return `<div class="registro"><div class="reg-cab"><b>${escapar(obra.nome.toUpperCase())} › ${local(p)}</b><span>${escapar(aberta)}</span></div>
${p.legenda ? `<p><b>Pendência:</b> ${comQuebras(p.legenda)}</p>` : ''}
<p><b>Encerramento</b> (${escapar(horaBr(enc.hora, s.fuso))} · ${escapar(enc.autor)})${enc.observacao ? `: ${comQuebras(enc.observacao)}` : '.'}</p>
${fotos.length > 0 ? `<div class="fotos">${fotos.map((x) => foto(o, x.f, x.rotulo)).join('')}</div>` : ''}</div>`
    })
    .join('')
  return `${titulo}\n<div class="sec">${blocos}</div>`
}

const ROTULO_TARDIO: Record<string, string> = {
  servico: 'Serviço',
  pendencia: 'Pendência',
  encerramento: 'Encerramento',
  observacao: 'Observação',
}

function secaoObservacoes(s: Snapshot): string {
  const obras = s.obras.filter((x) => x.observacoes.length > 0)
  const obs =
    obras.length === 0
      ? '<p class="vazio">Nenhuma observação no dia.</p>'
      : obras
          .map(
            (obra) =>
              `<h3 class="obra">${escapar(obra.nome)}</h3><div class="obs-obra">${obra.observacoes
                .map(
                  (x) =>
                    `<div class="item"><span class="quem">${escapar(horaBr(x.hora, s.fuso))} · ${escapar(x.autor)}${x.editada ? ' (editada)' : ''}</span><span>${comQuebras(x.texto)}</span></div>`,
                )
                .join('')}</div>`,
          )
          .join('')
  const tardios =
    s.tardios.length === 0
      ? ''
      : `<h3 class="obra">Lançamentos de dias anteriores recebidos após a emissão</h3>
<table class="tardios"><tr><th>DATA E HORA</th><th>TIPO</th><th>OBRA / AMBIENTE</th><th>AUTOR</th><th>TEXTO</th></tr>
${s.tardios
  .map(
    (t) =>
      `<tr><td>${dataBr(t.data)}${t.hora ? ` ${escapar(horaBr(t.hora, s.fuso))}` : ''}${
        t.recebido_em ? `<br><small>recebido em ${escapar(dataHoraBr(new Date(t.recebido_em), s.fuso))}</small>` : ''
      }</td><td>${escapar(ROTULO_TARDIO[t.tipo] ?? t.tipo)}</td><td>${escapar(t.obra)}${t.ambiente ? ` › ${escapar(t.ambiente)}` : ''}</td><td>${escapar(t.autor)}</td><td>${comQuebras(t.texto ?? '')}</td></tr>`,
  )
  .join('')}
</table>`
  return `<h2><span>7.</span>OBSERVAÇÕES</h2>\n<div class="sec">${obs}${tardios}</div>`
}

/** `dd/mm HH:MM` no fuso do snapshot. */
function diaHoraBr(instante: string, fuso: string): string {
  const p = partesNoFuso(new Date(instante), fuso)
  return `${p.dia}/${p.mes} ${p.hora}:${p.minuto}`
}

function tabelaEquipe(s: Snapshot): string {
  const eq = s.equipe_servico
  if (!eq) return ''
  if (eq.length === 0) {
    return '<p class="vazio">Nenhum check-in de serviço neste dia; assinam os responsáveis cadastrados na etapa.</p>'
  }
  const saida = (x: (typeof eq)[number]) =>
    x.saida_em === null ? 'em serviço' : x.saida_automatica ? 'não registrada' : diaHoraBr(x.saida_em, s.fuso)
  return `<table class="equipe"><tr><th>Militar</th><th>Entrada</th><th>Saída</th></tr>${eq
    .map(
      (x) =>
        `<tr><td>${escapar(x.nome)}</td><td>${escapar(diaHoraBr(x.entrada_em, s.fuso))}</td><td>${escapar(saida(x))}</td></tr>`,
    )
    .join('')}</table>`
}

function secaoResponsaveis(s: Snapshot, o: OpcoesTemplate): string {
  const r = s.responsaveis
  const assin =
    r.length === 0
      ? '<p class="vazio">Nenhum responsável cadastrado na etapa.</p>'
      : `<div class="assinaturas${r.length === 1 ? ' uma' : ''}">${r
          .map((x) => `<div class="assin"><div>${escapar(x.nome)}<br>${escapar(x.funcao)}</div></div>`)
          .join('')}</div>`
  const quando = dataHoraBr(o.emitidoEm, s.fuso)
  const cidade = cidadeDoFuso(s.fuso)
  const texto = o.numero
    ? `Emitido pelo Fiscal Bot em ${quando} (horário de ${cidade}), com os lançamentos de ${dataBr(s.data)}.${
        o.revisao > 0 ? ` Retificação R${o.revisao}: substitui as versões anteriores do boletim deste dia.` : ''
      } Lançamentos deste dia recebidos após a emissão entram no boletim seguinte.`
    : `${MARCA_PREVIA}: gerada pelo Fiscal Bot em ${quando} (horário de ${cidade}), com os lançamentos de ${dataBr(s.data)} até este momento. Não é um boletim emitido.`
  return `<div style="break-inside: avoid"><h2><span>8.</span>RESPONSÁVEIS</h2>
<div class="sec">${tabelaEquipe(s)}${assin}<div class="emissao">${escapar(texto)}</div></div></div>`
}

/** HTML completo do boletim. */
export function montarHtml(s: Snapshot, o: OpcoesTemplate): string {
  const titulo = o.numero ? `Boletim ${o.numero}` : `Prévia do boletim de ${dataBr(s.data)}`
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>${escapar(titulo)}</title>
<style>
${o.cssFontes}
${CSS}
</style></head><body>
${o.numero ? '' : `<div class="marca-previa">PRÉVIA</div>`}
${cabecalho(s, o)}
${secaoDados(s)}
${secaoClima(s, o.climaImagem)}
${secaoIndicadores(s)}
${secaoServicos(s, o)}
${secaoAbertas(s, o)}
${secaoEncerradas(s, o)}
${secaoObservacoes(s)}
${secaoResponsaveis(s, o)}
</body></html>
`
}

/** `footerTemplate` do Chromium: número, título e "Página x de y" (`cssFonte`: `@font-face` da serifada). */
export function rodapeHtml(numero: string | null, cssFonte = ''): string {
  const esquerda = numero ? `${escapar(numero)} · Boletim de Acompanhamento Diário` : 'Boletim de Acompanhamento Diário'
  const meio = numero ? 'Fiscal Bot' : escapar(MARCA_PREVIA)
  return (
    (cssFonte ? `<style>${cssFonte}</style>` : '') +
    '<div style="width:100%;font-family:\'Boletim Serif\',\'Liberation Serif\',serif;font-size:8px;color:#444;padding:0 12mm;display:flex;justify-content:space-between">' +
    `<span>${esquerda}</span><span>${meio}</span>` +
    '<span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>'
  )
}

/** Caminhos de todas as fotos do snapshot (sem repetição). */
export function caminhosDasFotos(s: Snapshot): string[] {
  const todos = s.obras.flatMap((o) => [
    ...o.servicos.flatMap((r) => r.fotos),
    ...o.pendencias_abertas.flatMap((r) => r.fotos),
    ...o.pendencias_encerradas.flatMap((p) => [...p.fotos_registro, ...p.encerramento.fotos]),
  ])
  return [...new Set(todos.map((f) => f.path))]
}
