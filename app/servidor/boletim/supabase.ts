/**
 * Acesso do gerador ao Supabase: RPCs da fila com a chave secreta (service_role), R2
 * (fotos, logo, boletins) e, na prévia, as RPCs de admin com o JWT de quem pediu.
 * Variáveis: `SUPABASE_URL` e `SUPABASE_SECRET_KEY`, mais `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
 * `R2_SECRET_ACCESS_KEY` e `R2_BUCKET` (ver app/.env.example).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { chaveObjeto, configDoAmbiente, criarR2, type ClienteR2 } from '../_compartilhado/r2.js'
import type { Edicao } from './edicao.js'
import type { ClimaComDados, PedidoReivindicado, Snapshot } from './tipos.js'

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

/** O que o gerador usa do banco e do R2 (os testes trocam por uma versão em memória). */
export interface FonteBoletim {
  segredoInterno(): Promise<string | null>
  reivindicar(limite: number): Promise<PedidoReivindicado[]>
  snapshot(etapaId: string, data: string): Promise<Snapshot>
  /** Snapshot gravado de um boletim emitido (base de uma retificação). */
  snapshotDoBoletim(id: string): Promise<Snapshot>
  concluir(id: number, snapshot: Snapshot, pdfPath: string): Promise<{ boletim_id: string; numero: string }>
  falhar(id: number, erro: string): Promise<void>
  /** Clima do boletim de maior revisão da data que tem imagem copiada (null se não houver). */
  climaAnterior(etapaId: string, data: string): Promise<{ numero: string; clima: ClimaComDados } | null>
  baixar(bucket: string, caminho: string): Promise<Uint8Array>
  enviar(bucket: string, caminho: string, bytes: Uint8Array, tipo: string): Promise<void>
}

/** Acesso de um admin (prévia): confere `sou_admin` e lê o snapshot com o JWT dele. */
export interface AcessoAdmin {
  souAdmin(): Promise<boolean>
  snapshot(slug: string, data: string): Promise<Snapshot>
  /** `admin_boletim`: o boletim emitido com o snapshot gravado (e os demais campos). */
  boletim(id: string): Promise<{ snapshot: Snapshot; [campo: string]: unknown }>
}

/** Erro de RPC com o código do Postgres (22023, P0002, 42501...). */
export class ErroRpc extends Error {
  readonly codigo: string | null
  constructor(mensagem: string, codigo: string | null) {
    super(mensagem)
    this.name = 'ErroRpc'
    this.codigo = codigo
  }
}

const OPCOES_AUTH = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }

async function chamar<T>(cliente: SupabaseClient, nome: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await cliente.rpc(nome, args)
  if (error) throw new ErroRpc(`${nome}: ${error.message}`, typeof error.code === 'string' ? error.code : null)
  return data as T
}

/** Cliente R2 a partir do ambiente (lança com o nome da variável que falta). */
export function r2DoAmbiente(env: NodeJS.ProcessEnv = process.env): ClienteR2 {
  return criarR2(configDoAmbiente((n) => env[n]))
}

/** Grava no R2 e registra o arquivo na tabela `arquivo` (RPC só do service_role). */
export async function gravarERegistrar(
  r2: ClienteR2,
  cliente: SupabaseClient,
  pasta: string,
  caminho: string,
  bytes: Uint8Array,
  tipo: string,
): Promise<void> {
  const chave = chaveObjeto(pasta, caminho)
  try {
    await r2.gravar(chave, bytes, tipo)
  } catch (e) {
    throw new Error(`Não foi possível enviar ${chave}: ${e instanceof Error ? e.message : String(e)}`, { cause: e })
  }
  await chamar(cliente, 'arquivo_registrar_servico', {
    p_pasta: pasta,
    p_caminho: caminho,
    p_tamanho: bytes.length,
    p_tipo: tipo,
  })
}

export async function baixarDoR2(r2: ClienteR2, pasta: string, caminho: string): Promise<Uint8Array> {
  try {
    return await r2.baixar(chaveObjeto(pasta, caminho))
  } catch (e) {
    throw new Error(`Não foi possível baixar ${pasta}/${caminho}: ${e instanceof Error ? e.message : String(e)}`, { cause: e })
  }
}

export function criarFonteSupabase(c: Configuracao, r2: ClienteR2 = r2DoAmbiente()): FonteBoletim {
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
        base_boletim_id: typeof l.base_boletim_id === 'string' ? l.base_boletim_id : null,
        edicao: l.edicao && typeof l.edicao === 'object' ? (l.edicao as Edicao) : null,
      }))
    },
    snapshot(etapaId, data) {
      return chamar<Snapshot>(cliente, 'boletim_snapshot', { p_etapa: etapaId, p_data: data })
    },
    snapshotDoBoletim(id) {
      return chamar<Snapshot>(cliente, 'boletim_snapshot_emitido', { p_boletim: id })
    },
    concluir(id, snapshot, pdfPath) {
      return chamar(cliente, 'concluir_emissao', { p_id: id, p_snapshot: snapshot, p_pdf_path: pdfPath })
    },
    async falhar(id, erro) {
      await chamar(cliente, 'falhar_emissao', { p_id: id, p_erro: erro.slice(0, 2000) })
    },
    async climaAnterior(etapaId, data) {
      const r = await chamar<{ numero?: unknown; clima?: Partial<ClimaComDados> & { indisponivel?: unknown } } | null>(
        cliente,
        'boletim_clima_anterior',
        { p_etapa: etapaId, p_data: data },
      )
      const c = r?.clima
      if (!r || !c || c.indisponivel || typeof c.imagem_path !== 'string' || !c.imagem_path || typeof r.numero !== 'string') return null
      return { numero: r.numero, clima: c as ClimaComDados }
    },
    baixar(bucket, caminho) {
      return baixarDoR2(r2, bucket, caminho)
    },
    enviar(bucket, caminho, bytes, tipo) {
      return gravarERegistrar(r2, cliente, bucket, caminho, bytes, tipo)
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
    boletim(id) {
      return chamar<{ snapshot: Snapshot }>(cliente, 'admin_boletim', { p_id: id })
    },
  }
}
