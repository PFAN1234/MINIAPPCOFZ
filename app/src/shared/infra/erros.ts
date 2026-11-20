/** Registro de erros do cliente (Mini App e site admin) na tabela `erro_cliente`. Contrato: docs/contrato-erros-orfaos.md (A). */
import type { SupabaseClient } from '@supabase/supabase-js'

// Redeclarada aqui (escopo do módulo) porque alguns projetos do tsc não incluem `src/versao.d.ts`.
declare const __VERSAO_APP__: { pr: number | null; commit: string | null; data: string }

export type AppErro = 'miniapp' | 'admin'

const JANELA_DEDUPE_MS = 60_000
const MAX_ENVIOS = 10

let cliente: SupabaseClient | null = null
let app: AppErro = 'miniapp'
const enviados = new Map<string, number>()
let totalEnvios = 0

/** Chamado pelos repositórios Supabase: o cliente (com a sessão) usado para enviar. A fixture não chama. */
export function configurarEnvioErros(novo: SupabaseClient | null, qual: AppErro = 'miniapp'): void {
  cliente = novo
  app = qual
}

/** Zera o estado do módulo (testes). */
export function reiniciarErros(): void {
  cliente = null
  app = 'miniapp'
  enviados.clear()
  totalEnvios = 0
}

/** Mesmo formato do rótulo da tela inicial ("v40.261113.58182c8"). */
function versaoDoApp(): string | null {
  try {
    const v = __VERSAO_APP__
    const aammdd = new Date(v.data).toISOString().slice(2, 10).replaceAll('-', '')
    return [v.pr !== null ? `v${v.pr}` : 'vdev', aammdd, v.commit].filter(Boolean).join('.')
  } catch {
    return null
  }
}

function textoDe(erro: unknown): { mensagem: string; pilha: string | null } {
  if (erro instanceof Error) return { mensagem: erro.message || erro.name, pilha: erro.stack ?? null }
  if (typeof erro === 'string') return { mensagem: erro, pilha: null }
  try {
    return { mensagem: JSON.stringify(erro) ?? String(erro), pilha: null }
  } catch {
    return { mensagem: String(erro), pilha: null }
  }
}

/** Envia o erro ao banco. Nunca lança; sem fixture, sem cliente configurado ou sem sessão, só `console.error`. */
export async function registrarErro(erro: unknown, extra?: Record<string, unknown>): Promise<void> {
  try {
    console.error(erro)
    if (import.meta.env.VITE_DADOS === 'fixture' || !cliente) return
    const { mensagem, pilha } = textoDe(erro)
    if (!mensagem) return
    const agora = Date.now()
    const anterior = enviados.get(mensagem)
    if (anterior !== undefined && agora - anterior < JANELA_DEDUPE_MS) return
    if (totalEnvios >= MAX_ENVIOS) return
    enviados.set(mensagem, agora)
    totalEnvios += 1
    const { data } = await cliente.auth.getSession()
    if (!data.session) return
    await cliente.rpc('registrar_erro_cliente', {
      p_app: app,
      p_versao: versaoDoApp(),
      p_rota: typeof location === 'undefined' ? null : location.pathname + location.search,
      p_mensagem: mensagem,
      p_pilha: pilha,
      p_agente: typeof navigator === 'undefined' ? null : navigator.userAgent,
      p_contexto: extra ?? null,
    })
  } catch {
    // Falha ao enviar o erro não pode gerar outro erro.
  }
}

/** Captura `error` e `unhandledrejection` da janela. Devolve a função que desfaz a instalação. */
export function instalarCapturaGlobal(qual: AppErro): () => void {
  app = qual
  const aoErro = (e: ErrorEvent) => void registrarErro(e.error ?? e.message)
  const aoRejeitar = (e: PromiseRejectionEvent) => void registrarErro(e.reason)
  window.addEventListener('error', aoErro)
  window.addEventListener('unhandledrejection', aoRejeitar)
  return () => {
    window.removeEventListener('error', aoErro)
    window.removeEventListener('unhandledrejection', aoRejeitar)
  }
}
