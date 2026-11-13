/**
 * Tratamento da requisição de `api/relatorio-pendencias.ts`, separado para os testes:
 * recebe `Request` e devolve `Response`.
 */
import { cssFonteRodape, cssFontes } from '../boletim/fontes.js'
import { dataUrl, reduzirFoto, tipoDaImagem } from '../boletim/fotos.js'
import { DEPENDENCIAS_PADRAO, BUCKET_FOTOS, BUCKET_ORGANIZACAO, type Dependencias } from '../boletim/gerador.js'
import { json, respostaDeRpc } from '../boletim/http.js'
import { ErroRpc } from '../boletim/supabase.js'
import type { AcessoRelatorio, FonteRelatorio } from './supabase.js'
import { caminhosDasFotos, montarHtmlRelatorio, rodapeRelatorio } from './template.js'

export const BUCKET_RELATORIOS = 'relatorios'
export const VALIDADE_URL_SEGUNDOS = 600
export const LADO_FOTO = 800

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface ContextoRelatorio {
  fonte: FonteRelatorio
  /** Acesso com o JWT de quem pediu. */
  acesso: (jwt: string) => AcessoRelatorio
  deps?: Dependencias
}

/** `sub` do payload do JWT (já validado pela RPC), ou null se não for um UUID. */
export function subDoJwt(jwt: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString('utf8')) as { sub?: unknown }
    return typeof payload.sub === 'string' && UUID.test(payload.sub) ? payload.sub.toLowerCase() : null
  } catch {
    return null
  }
}

const slugSeguro = (s: string, padrao: string) => (/^[a-z0-9-]{1,60}$/i.test(s) ? s.toLowerCase() : padrao)

export async function tratarRelatorio(req: Request, c: ContextoRelatorio): Promise<Response> {
  if (req.method !== 'POST') return json({ erro: 'Use POST' }, 405)
  const jwt = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') ?? '')?.[1]?.trim()
  const sub = jwt ? subDoJwt(jwt) : null
  if (!jwt || !sub) return json({ erro: 'Sua sessão expirou. Entre de novo.' }, 401)
  let corpo: unknown
  try {
    corpo = await req.json()
  } catch {
    return json({ erro: 'Corpo inválido: envie JSON com etapa_id e obra_id' }, 400)
  }
  const o = typeof corpo === 'object' && corpo !== null && !Array.isArray(corpo) ? (corpo as Record<string, unknown>) : null
  if (!o || typeof o.etapa_id !== 'string' || !UUID.test(o.etapa_id)) return json({ erro: 'Etapa inválida' }, 400)
  const obraId = o.obra_id ?? null
  if (obraId !== null && (typeof obraId !== 'string' || !UUID.test(obraId))) return json({ erro: 'Obra inválida' }, 400)

  let relatorio
  try {
    relatorio = await c.acesso(jwt).relatorioPendencias(o.etapa_id, obraId)
  } catch (e) {
    if (e instanceof ErroRpc) return respostaDeRpc(e)
    throw e
  }

  const deps = c.deps ?? DEPENDENCIAS_PADRAO
  const fotos = new Map<string, string | null>()
  const caminhos = caminhosDasFotos(relatorio)
  const fila = [...caminhos]
  const trabalhador = async () => {
    for (let p = fila.shift(); p !== undefined; p = fila.shift()) {
      try {
        const jpeg = await reduzirFoto(await c.fonte.baixar(BUCKET_FOTOS, p), LADO_FOTO)
        fotos.set(p, dataUrl(jpeg, 'image/jpeg'))
      } catch (e) {
        deps.log(`Foto ${p} não usada: ${e instanceof Error ? e.message : String(e)}`)
        fotos.set(p, null)
      }
    }
  }
  await Promise.all(Array.from({ length: 4 }, trabalhador))

  let logo: string | null = null
  if (relatorio.organizacao.logo_path) {
    try {
      const bytes = await c.fonte.baixar(BUCKET_ORGANIZACAO, relatorio.organizacao.logo_path)
      logo = dataUrl(bytes, tipoDaImagem(bytes))
    } catch (e) {
      deps.log(`Logo não usado: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const html = montarHtmlRelatorio(relatorio, { fotos, logo, cssFontes: cssFontes() })
  const navegador = await deps.abrirNavegador()
  let pdf: Buffer
  try {
    pdf = await deps.gerarPdf(navegador, html, rodapeRelatorio(relatorio.etapa.nome, cssFonteRodape()))
  } finally {
    await navegador.close().catch(() => undefined)
  }

  const nome = `${slugSeguro(relatorio.etapa.slug, 'etapa')}-${relatorio.obra ? slugSeguro(relatorio.obra.slug, 'obra') : 'etapa'}.pdf`
  const caminho = `pendencias/${sub}/${nome}`
  await c.fonte.enviar(BUCKET_RELATORIOS, caminho, new Uint8Array(pdf), 'application/pdf')
  const url = await c.fonte.assinar(BUCKET_RELATORIOS, caminho, VALIDADE_URL_SEGUNDOS)
  return json({ url })
}

/** Erro inesperado: 500 com mensagem genérica (ou o nome da variável de ambiente que falta). */
export function respostaDeErroRelatorio(e: unknown, log: (m: string) => void = DEPENDENCIAS_PADRAO.log): Response {
  const msg = e instanceof Error ? e.message : String(e)
  log(`Erro: ${msg}`)
  return json({ erro: /^Variável SUPABASE_/.test(msg) ? msg : 'Não foi possível gerar o relatório. Tente de novo.' }, 500)
}
