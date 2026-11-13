/**
 * Acesso do gerador ao Supabase: RPCs da fila com a chave secreta (service_role), Storage
 * (fotos, logo, boletins) e, na prévia, as RPCs de admin com o JWT de quem pediu.
 * Variáveis: `SUPABASE_URL` e `SUPABASE_SECRET_KEY` (ver app/.env.example).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { PedidoReivindicado, Snapshot } from './tipos.js'

export interface Configuracao {
  url: string
  chaveSecreta: string
}

/** Lê a configuração do ambiente; lança com o nome da variável que falta. */
export function configuracaoDoAmbiente(env: NodeJS.ProcessEnv = process.env): Configuracao {
  const url = (env.SUPABASE_URL ?? '').trim().replace(/\/+$/, '')
  const chaveSecreta = (env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
  if (!url) throw new Error('Variável SUPABASE_URL não configurada')
  if (!chaveSecreta) throw new Error('Variável SUPABASE_SECRET_KEY não configurada')
  return { url, chaveSecreta }
}

/** O que o gerador usa do banco e do Storage (os testes trocam por uma versão em memória). */
export interface FonteBoletim {
  segredoInterno(): Promise<string | null>
  reivindicar(limite: number): Promise<PedidoReivindicado[]>
  snapshot(etapaId: string, data: string): Promise<Snapshot>
  concluir(id: number, snapshot: Snapshot, pdfPath: string): Promise<{ boletim_id: string; numero: string }>
  falhar(id: number, erro: string): Promise<void>
  baixar(bucket: string, caminho: string): Promise<Uint8Array>
  enviar(bucket: string, caminho: string, bytes: Uint8Array, tipo: string): Promise<void>
}

/** Acesso de um admin (prévia): confere `sou_admin` e lê o snapshot com o JWT dele. */
export interface AcessoAdmin {
  souAdmin(): Promise<boolean>
  snapshot(slug: string, data: string): Promise<Snapshot>
}

/** Erro de RPC com o código do Postgres (22023, P0002, 42501...). */
export class ErroRpc extends Error {
  constructor(
    mensagem: string,
    readonly codigo: string | null,
  ) {
    super(mensagem)
    this.name = 'ErroRpc'
  }
}

const OPCOES_AUTH = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }

async function chamar<T>(cliente: SupabaseClient, nome: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await cliente.rpc(nome, args)
  if (error) throw new ErroRpc(`${nome}: ${error.message}`, typeof error.code === 'string' ? error.code : null)
  return data as T
}

export function criarFonteSupabase(c: Configuracao): FonteBoletim {
  const cliente = createClient(c.url, c.chaveSecreta, { auth: OPCOES_AUTH })
  return {
    async segredoInterno() {
      try {
        const s = await chamar<unknown>(cliente, 'segredo_interno')
        return typeof s === 'string' && s !== '' ? s : null
      } catch {
        return null
      }
    },
    async reivindicar(limite) {
      const r = await chamar<unknown>(cliente, 'reivindicar_emissoes', { p_limite: limite })
      return (Array.isArray(r) ? r : []).map((l: Record<string, unknown>) => ({
        id: Number(l.id),
        etapa_id: String(l.etapa_id),
        data: String(l.data),
        revisao: Number(l.revisao ?? 0),
        numero: String(l.numero),
      }))
    },
    snapshot(etapaId, data) {
      return chamar<Snapshot>(cliente, 'boletim_snapshot', { p_etapa: etapaId, p_data: data })
    },
    concluir(id, snapshot, pdfPath) {
      return chamar(cliente, 'concluir_emissao', { p_id: id, p_snapshot: snapshot, p_pdf_path: pdfPath })
    },
    async falhar(id, erro) {
      await chamar(cliente, 'falhar_emissao', { p_id: id, p_erro: erro.slice(0, 2000) })
    },
    async baixar(bucket, caminho) {
      const { data, error } = await cliente.storage.from(bucket).download(caminho)
      if (error || !data) throw new Error(`Não foi possível baixar ${bucket}/${caminho}: ${error?.message ?? 'vazio'}`)
      return new Uint8Array(await data.arrayBuffer())
    },
    async enviar(bucket, caminho, bytes, tipo) {
      const { error } = await cliente.storage.from(bucket).upload(caminho, bytes, { contentType: tipo, upsert: true })
      if (error) throw new Error(`Não foi possível enviar ${bucket}/${caminho}: ${error.message}`)
    },
  }
}

/** As RPCs de admin rodam como o usuário do JWT (o cabeçalho Authorization tem prioridade). */
export function criarAcessoAdmin(c: Configuracao, jwt: string): AcessoAdmin {
  const cliente = createClient(c.url, c.chaveSecreta, {
    auth: OPCOES_AUTH,
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  })
  return {
    async souAdmin() {
      try {
        return (await chamar<unknown>(cliente, 'sou_admin')) === true
      } catch {
        return false
      }
    },
    snapshot(slug, data) {
      return chamar<Snapshot>(cliente, 'admin_boletim_snapshot', { p_slug: slug, p_data: data })
    },
  }
}
