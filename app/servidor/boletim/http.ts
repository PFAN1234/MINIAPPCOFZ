/**
 * Tratamento das requisições das funções da Vercel (`api/gerar-boletim.ts` e
 * `api/previa-boletim.ts`), separado para os testes: recebem `Request` e devolvem `Response`.
 */
import { timingSafeEqual } from 'node:crypto'
import { aplicarEdicao, validarEdicao, type Edicao } from './edicao.js'
import { DEPENDENCIAS_PADRAO, montarBoletim, processarFila, type Dependencias } from './gerador.js'
import { ErroRpc, type AcessoAdmin, type FonteBoletim } from './supabase.js'
import type { Snapshot } from './tipos.js'

export const CABECALHO_SEGREDO_INTERNO = 'x-segredo-interno'

export const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } })

export function igualConstante(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export interface ContextoGerar {
  fonte: FonteBoletim
  deps?: Dependencias
  /** Mantém a função viva depois da resposta (`waitUntil` da Vercel). */
  aoFundo: (trabalho: Promise<unknown>) => void
}

/**
 * POST com `x-segredo-interno` (o mesmo segredo do Vault que o `publish-outbox` usa): responde
 * 202 na hora e processa a fila em segundo plano (o pg_net não espera o PDF ficar pronto).
 */
export async function tratarGerar(req: Request, c: ContextoGerar): Promise<Response> {
  if (req.method !== 'POST') return json({ erro: 'Use POST' }, 405)
  const recebido = req.headers.get(CABECALHO_SEGREDO_INTERNO)
  const segredo = await c.fonte.segredoInterno()
  if (recebido === null || segredo === null || !igualConstante(recebido, segredo)) return json({ erro: 'Não autorizado' }, 401)
  const deps = c.deps ?? DEPENDENCIAS_PADRAO
  c.aoFundo(
    processarFila(c.fonte, deps).catch((e: unknown) => {
      deps.log(`Fila: ${e instanceof Error ? e.message : String(e)}`)
    }),
  )
  return json({ aceito: true }, 202)
}

export interface ContextoPrevia {
  fonte: Pick<FonteBoletim, 'baixar' | 'climaAnterior'>
  /** Acesso com o JWT de quem pediu. */
  acesso: (jwt: string) => AcessoAdmin
  deps?: Dependencias
}

const DATA = /^\d{4}-\d{2}-\d{2}$/
const SLUG = /^[a-z0-9-]{1,40}$/

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Erro de RPC do banco → resposta com a mensagem em português (sem o prefixo com o nome da RPC). */
export function respostaDeRpc(e: ErroRpc): Response {
  const status = e.codigo === 'P0002' ? 404 : e.codigo === '22023' ? 400 : e.codigo === '42501' ? 403 : 500
  return json({ erro: e.message.replace(/^[a-z_]+: /, '') }, status)
}

/**
 * Prévia do boletim, sempre com `Authorization: Bearer <JWT do admin>`:
 * - GET `?etapa=<slug>&data=AAAA-MM-DD`: o dia como está hoje no banco;
 * - POST `{boletim_id, edicao}`: o snapshot do boletim emitido com a edição aplicada (clima reaproveitado).
 */
export async function tratarPrevia(req: Request, c: ContextoPrevia): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'POST') return json({ erro: 'Use GET ou POST' }, 405)
  const jwt = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') ?? '')?.[1]?.trim()
  if (!jwt) return json({ erro: 'Sua sessão expirou. Entre de novo.' }, 401)
  let slug = ''
  let data = ''
  let boletimId = ''
  let edicao: Edicao = {}
  if (req.method === 'GET') {
    const url = new URL(req.url)
    slug = url.searchParams.get('etapa') ?? ''
    data = url.searchParams.get('data') ?? ''
    if (!SLUG.test(slug)) return json({ erro: 'Etapa inválida' }, 400)
    if (!DATA.test(data)) return json({ erro: 'Data inválida: use AAAA-MM-DD' }, 400)
  } else {
    let corpo: unknown
    try {
      corpo = await req.json()
    } catch {
      return json({ erro: 'Corpo inválido: envie JSON com boletim_id e edicao' }, 400)
    }
    const o = typeof corpo === 'object' && corpo !== null && !Array.isArray(corpo) ? (corpo as Record<string, unknown>) : null
    if (!o || typeof o.boletim_id !== 'string' || !UUID.test(o.boletim_id)) return json({ erro: 'Boletim inválido' }, 400)
    boletimId = o.boletim_id
    try {
      edicao = validarEdicao(o.edicao)
    } catch (e) {
      return json({ erro: (e as Error).message }, 400)
    }
  }
  const acesso = c.acesso(jwt)
  if (!(await acesso.souAdmin())) return json({ erro: 'Acesso negado: apenas admins do Mini App.' }, 403)
  let snapshot: Snapshot
  try {
    if (req.method === 'GET') {
      snapshot = await acesso.snapshot(slug, data)
    } else {
      const b = await acesso.boletim(boletimId)
      snapshot = aplicarEdicao(b.snapshot, edicao)
      slug = snapshot.etapa.slug
      data = snapshot.data
    }
  } catch (e) {
    if (e instanceof ErroRpc) return respostaDeRpc(e)
    throw e
  }
  const deps = c.deps ?? DEPENDENCIAS_PADRAO
  const navegador = await deps.abrirNavegador()
  try {
    const { pdf } = await montarBoletim(c.fonte, navegador, snapshot, {
      numero: null,
      revisao: 0,
      deps,
      reaproveitarSempre: req.method === 'POST',
    })
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="previa-${slug}-${data}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } finally {
    await navegador.close().catch(() => undefined)
  }
}

/** Erro inesperado (configuração, Chromium): 500 com a mensagem, sem detalhes internos. */
export function respostaDeErro(e: unknown, log: (m: string) => void = DEPENDENCIAS_PADRAO.log): Response {
  const msg = e instanceof Error ? e.message : String(e)
  log(`Erro: ${msg}`)
  return json({ erro: /^Variável SUPABASE_/.test(msg) ? msg : 'Não foi possível gerar o boletim. Tente de novo.' }, 500)
}
