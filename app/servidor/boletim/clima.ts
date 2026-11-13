/**
 * Cópia do clima: abre a página de estações do Observatório de Riscos Climáticos de Fortaleza,
 * acha a linha da estação na tabela "Últimas 24 horas" (a última tabela que tem
 * `button.est-tabela-estacao[data-estacao="<código>"]`) e tira a imagem só dessa linha (escala 2).
 * Leitura com mais de 3 h, linha ausente ou erro → tenta a reserva; sem nenhuma, devolve
 * `{indisponivel: true, motivo}`. Tudo em no máximo 40 s.
 */
import type { Browser, BrowserContext, Page } from 'playwright-core'
import { ESTACOES, FONTE_CLIMA, FUSO_OBSERVATORIO, URL_OBSERVATORIO } from './estacoes.js'
import { partesNoFuso } from './formato.js'
import type { ClimaSnapshot } from './tipos.js'

export const IDADE_MAXIMA_MIN = 180
export const TEMPO_MAXIMO_MS = 40_000

export interface OpcoesClima {
  principal: string | null
  reserva: string | null
  url?: string
  agora?: () => Date
  tempoMaximoMs?: number
  idadeMaximaMin?: number
  /** Antes de abrir a página (os testes servem a cópia gravada por `context.route`). */
  preparar?: (contexto: BrowserContext) => Promise<void>
}

export interface ResultadoClima {
  /** Sem `imagem_path`: quem grava a imagem preenche. */
  clima: ClimaSnapshot
  /** PNG da linha da estação; null quando indisponível. */
  imagem: Buffer | null
}

/**
 * Idade da leitura em minutos a partir do texto da linha ("há 12 min", "há 2 h", "há 1 dia",
 * "agora" ou um horário "HH:MM" de hoje). null quando não reconhece.
 */
export function idadeDaLeitura(texto: string, agora: Date, fuso = FUSO_OBSERVATORIO): number | null {
  const t = texto.replace(/\s+/g, ' ').trim().toLowerCase()
  let m = /há (\d+) ?min/.exec(t)
  if (m) return Number(m[1])
  m = /há (\d+) ?(h|hora)/.exec(t)
  if (m) return Number(m[1]) * 60
  m = /há (\d+) ?dia/.exec(t)
  if (m) return Number(m[1]) * 1440
  if (/\bagora\b/.test(t)) return 0
  m = /\b(\d{1,2})[:h](\d{2})\b/.exec(t)
  if (m) {
    const p = partesNoFuso(agora, fuso)
    const diff = Number(p.hora) * 60 + Number(p.minuto) - (Number(m[1]) * 60 + Number(m[2]))
    return diff >= 0 ? diff : diff + 1440
  }
  return null
}

/** "HH:MM" de `agora − minutos` no fuso. */
function horaDaLeitura(agora: Date, minutos: number): string {
  const p = partesNoFuso(new Date(agora.getTime() - minutos * 60_000), FUSO_OBSERVATORIO)
  return `${p.hora}:${p.minuto}`
}

class Indisponivel extends Error {}

async function copiarLinha(
  pagina: Page,
  codigo: string,
  agora: Date,
  idadeMaxima: number,
): Promise<{ imagem: Buffer; leitura: string; nome: string }> {
  const botao = `button.est-tabela-estacao[data-estacao="${codigo}"]`
  const tabela = pagina.locator('table').filter({ has: pagina.locator(botao) }).last()
  const linha = tabela.locator('tr').filter({ has: pagina.locator(botao) }).last()
  if ((await linha.count()) === 0) throw new Indisponivel(`estação ${codigo} não encontrada na tabela`)
  const texto = (await linha.locator('th').first().innerText()).trim()
  const idade = idadeDaLeitura(texto, agora)
  if (idade === null) throw new Indisponivel(`horário da leitura da estação ${codigo} não reconhecido`)
  if (idade > idadeMaxima) throw new Indisponivel(`leitura da estação ${codigo} com mais de ${Math.round(idadeMaxima / 60)} h`)
  const nome = (await linha.locator(botao).innerText()).trim() || ESTACOES[codigo] || codigo
  await linha.scrollIntoViewIfNeeded()
  const imagem = await linha.screenshot({ type: 'png', animations: 'disabled', scale: 'device' })
  return { imagem, leitura: horaDaLeitura(agora, idade), nome }
}

/** Copia a linha da estação principal (ou da reserva). Nunca lança: falha vira `indisponivel`. */
export async function capturarClima(navegador: Browser, o: OpcoesClima): Promise<ResultadoClima> {
  const agora = (o.agora ?? (() => new Date()))()
  const limite = o.tempoMaximoMs ?? TEMPO_MAXIMO_MS
  const candidatas = [o.principal, o.reserva].filter((c, i, l): c is string => !!c && l.indexOf(c) === i)
  if (candidatas.length === 0) return { clima: { indisponivel: true, motivo: 'etapa sem estação meteorológica' }, imagem: null }

  let contexto: BrowserContext | null = null
  let encerrado = false
  let relogio: ReturnType<typeof setTimeout> | undefined
  const motivos: string[] = []
  const trabalho = async (): Promise<ResultadoClima> => {
    contexto = await navegador.newContext({
      locale: 'pt-BR',
      timezoneId: FUSO_OBSERVATORIO,
      viewport: { width: 1280, height: 900 },
      deviceScaleFactor: 2,
    })
    // Tempo esgotado antes de o contexto existir: fecha aqui mesmo.
    if (encerrado) await contexto.close()
    contexto.setDefaultTimeout(limite)
    if (o.preparar) await o.preparar(contexto)
    const pagina = await contexto.newPage()
    await pagina.goto(o.url ?? URL_OBSERVATORIO, { waitUntil: 'domcontentloaded' })
    await pagina.locator('button.est-tabela-estacao[data-estacao]').first().waitFor({ state: 'attached' })
    // Folhas de estilo e fontes da página (sem esperar além do necessário).
    await pagina.waitForLoadState('load', { timeout: Math.min(15_000, limite) }).catch(() => undefined)
    await pagina.evaluate(() => document.fonts.ready.then(() => undefined)).catch(() => undefined)
    for (const codigo of candidatas) {
      try {
        const r = await copiarLinha(pagina, codigo, agora, o.idadeMaximaMin ?? IDADE_MAXIMA_MIN)
        return {
          clima: {
            fonte: FONTE_CLIMA,
            estacao: { codigo, nome: r.nome },
            leitura: r.leitura,
            copiado_em: agora.toISOString(),
            imagem_path: null,
          },
          imagem: r.imagem,
        }
      } catch (e) {
        if (!(e instanceof Indisponivel)) throw e
        motivos.push(e.message)
      }
    }
    return { clima: { indisponivel: true, motivo: motivos.join('; ') }, imagem: null }
  }
  const tempo = new Promise<ResultadoClima>((resolver) => {
    relogio = setTimeout(
      () => resolver({ clima: { indisponivel: true, motivo: `tempo esgotado (${Math.round(limite / 1000)} s)` }, imagem: null }),
      limite,
    )
  })
  try {
    return await Promise.race([
      trabalho().catch((e: unknown): ResultadoClima => {
        const msg = e instanceof Error ? e.message.split('\n')[0] : String(e)
        return { clima: { indisponivel: true, motivo: [...motivos, `falha ao abrir a página: ${msg}`].join('; ') }, imagem: null }
      }),
      tempo,
    ])
  } finally {
    encerrado = true
    clearTimeout(relogio)
    await (contexto as BrowserContext | null)?.close().catch(() => undefined)
  }
}
