/**
 * Geração do boletim: reivindica os pedidos da fila e, para cada um, lê o snapshot, copia o
 * clima, prepara as fotos e o logo, monta o HTML, gera o PDF, envia PDF e imagem do clima ao
 * bucket `boletins` e conclui a emissão (`concluir_emissao`). Erro → `falhar_emissao`.
 * A prévia faz o mesmo sem número e sem gravar nada.
 */
import type { Browser } from 'playwright-core'
import { capturarClima, type OpcoesClima, type ResultadoClima } from './clima.js'
import { cssFonteRodape, cssFontes } from './fontes.js'
import { numeroSemBarras, partesNoFuso } from './formato.js'
import { dataUrl, prepararFotos, tipoDaImagem } from './fotos.js'
import { abrirNavegador, gerarPdf } from './pdf.js'
import type { FonteBoletim } from './supabase.js'
import { caminhosDasFotos, montarHtml, rodapeHtml } from './template.js'
import type { PedidoReivindicado, Snapshot } from './tipos.js'

export const BUCKET_BOLETINS = 'boletins'
export const BUCKET_FOTOS = 'fotos'
export const BUCKET_ORGANIZACAO = 'organizacao'

export interface Dependencias {
  abrirNavegador: () => Promise<Browser>
  capturarClima: (navegador: Browser, o: OpcoesClima) => Promise<ResultadoClima>
  gerarPdf: (navegador: Browser, html: string, rodape: string) => Promise<Buffer>
  agora: () => Date
  log: (mensagem: string) => void
}

export const DEPENDENCIAS_PADRAO: Dependencias = {
  abrirNavegador,
  capturarClima,
  gerarPdf,
  agora: () => new Date(),
  log: (m) => console.log(`[boletim] ${m}`),
}

/** Caminhos no bucket `boletins`: `<etapa_id>/<número sem barras>.pdf` e `...-clima.png`. */
export function caminhosDoBoletim(etapaId: string, numero: string) {
  const base = `${etapaId}/${numeroSemBarras(numero)}`
  return { pdf: `${base}.pdf`, clima: `${base}-clima.png` }
}

export interface Montado {
  pdf: Buffer
  /** Snapshot com o `clima` preenchido (sem `imagem_path`). */
  snapshot: Snapshot
  imagemClima: Buffer | null
}

/** Folga depois da meia-noite em que a cópia ainda vale para o dia anterior (emissão atrasada). */
export const FOLGA_CLIMA_HORAS = 6

/**
 * A tabela do Observatório mostra só as 24 horas até a cópia: serve para o boletim do dia (ou do
 * dia anterior até as 6 h, quando a emissão atrasa). Em dia antigo (retificação), o gerador reaproveita
 * o clima do boletim anterior do mesmo dia, se houver (`reaproveitarClima`); sem ele, sai sem clima.
 */
export function climaCabeNoDia(data: string, agora: Date, fuso: string): boolean {
  const hoje = partesNoFuso(agora, fuso)
  const iso = `${hoje.ano}-${hoje.mes}-${hoje.dia}`
  if (data === iso) return true
  const ontem = partesNoFuso(new Date(agora.getTime() - 86_400_000), fuso)
  return data === `${ontem.ano}-${ontem.mes}-${ontem.dia}` && Number(hoje.hora) < FOLGA_CLIMA_HORAS
}

const MOTIVO_DIA_ANTIGO = 'boletim de data anterior; o Observatório só mostra as últimas 24 horas'

/**
 * Clima de dia antigo: copia o do boletim anterior da mesma etapa e data (imagem baixada do bucket;
 * `imagem_path` volta nulo, pois a cópia ganha arquivo próprio na emissão). Falha na consulta ou no
 * download não derruba a emissão: registra no log e segue sem clima.
 */
async function reaproveitarClima(fonte: Pick<FonteBoletim, 'baixar' | 'climaAnterior'>, snapshot: Snapshot, deps: Dependencias): Promise<ResultadoClima> {
  try {
    const anterior = await fonte.climaAnterior(snapshot.etapa.id, snapshot.data)
    if (!anterior) {
      return { clima: { indisponivel: true, motivo: `${MOTIVO_DIA_ANTIGO} e nenhum boletim desse dia tem o clima copiado` }, imagem: null }
    }
    const imagem = await fonte.baixar(BUCKET_BOLETINS, anterior.clima.imagem_path ?? '')
    return { clima: { ...anterior.clima, imagem_path: null, reaproveitado_de: anterior.numero }, imagem: Buffer.from(imagem) }
  } catch (e) {
    deps.log(`Clima do boletim anterior não reaproveitado: ${e instanceof Error ? e.message : String(e)}`)
    return { clima: { indisponivel: true, motivo: MOTIVO_DIA_ANTIGO }, imagem: null }
  }
}

/**
 * Monta o PDF de um snapshot (`numero` null = prévia). Clima: captura do Observatório quando cabe no
 * dia; em dia antigo, reaproveita o do boletim anterior do mesmo dia (ou sai indisponível).
 */
export async function montarBoletim(
  fonte: Pick<FonteBoletim, 'baixar' | 'climaAnterior'>,
  navegador: Browser,
  snapshot: Snapshot,
  o: { numero: string | null; revisao: number; deps: Dependencias },
): Promise<Montado> {
  const { deps } = o
  const emitidoEm = deps.agora()
  const [clima, fotos, logo] = await Promise.all([
    climaCabeNoDia(snapshot.data, emitidoEm, snapshot.fuso)
      ? deps.capturarClima(navegador, { principal: snapshot.etapa.estacao, reserva: snapshot.etapa.estacao_reserva, agora: () => emitidoEm })
      : reaproveitarClima(fonte, snapshot, deps),
    prepararFotos(caminhosDasFotos(snapshot), (c) => fonte.baixar(BUCKET_FOTOS, c), { aviso: deps.log }),
    snapshot.organizacao.logo_path
      ? fonte
          .baixar(BUCKET_ORGANIZACAO, snapshot.organizacao.logo_path)
          .then((b) => dataUrl(b, tipoDaImagem(b)))
          .catch((e: unknown) => {
            deps.log(`Logo não usado: ${e instanceof Error ? e.message : String(e)}`)
            return null
          })
      : Promise.resolve(null),
  ])
  if ('indisponivel' in clima.clima) deps.log(`Clima indisponível: ${clima.clima.motivo}`)
  const comClima: Snapshot = { ...snapshot, clima: clima.clima }
  const html = montarHtml(comClima, {
    numero: o.numero,
    revisao: o.revisao,
    emitidoEm,
    fotos,
    logo,
    climaImagem: clima.imagem ? dataUrl(clima.imagem, 'image/png') : null,
    cssFontes: cssFontes(),
  })
  const pdf = await deps.gerarPdf(navegador, html, rodapeHtml(o.numero, cssFonteRodape()))
  return { pdf, snapshot: comClima, imagemClima: clima.imagem }
}

/** Emite um pedido já reivindicado. Lança em caso de erro (quem chama registra a falha). */
export async function emitirPedido(fonte: FonteBoletim, navegador: Browser, pedido: PedidoReivindicado, deps: Dependencias) {
  const snapshot = await fonte.snapshot(pedido.etapa_id, pedido.data)
  const m = await montarBoletim(fonte, navegador, snapshot, { numero: pedido.numero, revisao: pedido.revisao, deps })
  const caminhos = caminhosDoBoletim(pedido.etapa_id, pedido.numero)
  let final = m.snapshot
  if (m.imagemClima && m.snapshot.clima && !('indisponivel' in m.snapshot.clima)) {
    await fonte.enviar(BUCKET_BOLETINS, caminhos.clima, m.imagemClima, 'image/png')
    final = { ...m.snapshot, clima: { ...m.snapshot.clima, imagem_path: caminhos.clima } }
  }
  await fonte.enviar(BUCKET_BOLETINS, caminhos.pdf, m.pdf, 'application/pdf')
  return fonte.concluir(pedido.id, final, caminhos.pdf)
}

export interface ResultadoPedido {
  id: number
  numero: string
  ok: boolean
  erro?: string
}

/**
 * Processa a fila: reivindica até `limite` pedidos e emite um por vez, com um Chromium só.
 * Erro em um pedido → `falhar_emissao` (nova tentativa com espera crescente) e segue para o próximo.
 */
export async function processarFila(fonte: FonteBoletim, deps: Dependencias = DEPENDENCIAS_PADRAO, limite = 2): Promise<ResultadoPedido[]> {
  const pedidos = await fonte.reivindicar(limite)
  if (pedidos.length === 0) return []
  const resultados: ResultadoPedido[] = []
  let navegador: Browser | null = null
  try {
    for (const pedido of pedidos) {
      try {
        navegador ??= await deps.abrirNavegador()
        await emitirPedido(fonte, navegador, pedido, deps)
        deps.log(`Emitido ${pedido.numero} (pedido ${pedido.id})`)
        resultados.push({ id: pedido.id, numero: pedido.numero, ok: true })
      } catch (e) {
        const erro = (e instanceof Error ? e.message : String(e)).split('\n')[0]
        deps.log(`Falha no pedido ${pedido.id} (${pedido.numero}): ${erro}`)
        resultados.push({ id: pedido.id, numero: pedido.numero, ok: false, erro })
        await fonte.falhar(pedido.id, erro).catch((x: unknown) => deps.log(`falhar_emissao: ${String(x)}`))
      }
    }
  } finally {
    await (navegador as Browser | null)?.close().catch(() => undefined)
  }
  return resultados
}
