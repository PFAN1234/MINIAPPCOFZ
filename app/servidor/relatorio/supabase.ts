/**
 * Acesso do relatório de pendências ao Supabase: a RPC com o JWT de quem pediu e o Storage
 * (fotos, logo, PDF e URL assinada) com a chave secreta.
 */
import { createClient } from '@supabase/supabase-js'
import { ErroRpc, type Configuracao } from '../boletim/supabase.js'
import type { RelatorioPendencias } from './tipos.js'

export interface FonteRelatorio {
  baixar(bucket: string, caminho: string): Promise<Uint8Array>
  enviar(bucket: string, caminho: string, bytes: Uint8Array, tipo: string): Promise<void>
  /** URL assinada de leitura, válida por `segundos`. */
  assinar(bucket: string, caminho: string, segundos: number): Promise<string>
}

export interface AcessoRelatorio {
  relatorioPendencias(etapaId: string, obraId: string | null): Promise<RelatorioPendencias>
}

const OPCOES_AUTH = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }

export function criarFonteRelatorio(c: Configuracao): FonteRelatorio {
  const cliente = createClient(c.url, c.chaveSecreta, { auth: OPCOES_AUTH })
  return {
    async baixar(bucket, caminho) {
      const { data, error } = await cliente.storage.from(bucket).download(caminho)
      if (error || !data) throw new Error(`Não foi possível baixar ${bucket}/${caminho}: ${error?.message ?? 'vazio'}`)
      return new Uint8Array(await data.arrayBuffer())
    },
    async enviar(bucket, caminho, bytes, tipo) {
      const { error } = await cliente.storage.from(bucket).upload(caminho, bytes, { contentType: tipo, upsert: true })
      if (error) throw new Error(`Não foi possível enviar ${bucket}/${caminho}: ${error.message}`)
    },
    async assinar(bucket, caminho, segundos) {
      const { data, error } = await cliente.storage.from(bucket).createSignedUrl(caminho, segundos)
      if (error || !data?.signedUrl) throw new Error(`Não foi possível assinar ${bucket}/${caminho}: ${error?.message ?? 'vazio'}`)
      return data.signedUrl
    },
  }
}

/** A RPC roda como o usuário do JWT (o cabeçalho Authorization tem prioridade sobre a chave). */
export function criarAcessoRelatorio(c: Configuracao, jwt: string): AcessoRelatorio {
  const cliente = createClient(c.url, c.chaveSecreta, {
    auth: OPCOES_AUTH,
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  })
  return {
    async relatorioPendencias(etapaId, obraId) {
      const { data, error } = await cliente.rpc('relatorio_pendencias', { p_etapa: etapaId, p_obra: obraId })
      if (error) throw new ErroRpc(`relatorio_pendencias: ${error.message}`, typeof error.code === 'string' ? error.code : null)
      return data as RelatorioPendencias
    },
  }
}
