/**
 * Acesso do relatório de pendências ao Supabase: a RPC com o JWT de quem pediu e o R2
 * (fotos, logo, PDF e URL assinada) com a chave secreta.
 */
import { createClient } from '@supabase/supabase-js'
import { chaveObjeto, type ClienteR2 } from '../_compartilhado/r2.js'
import { baixarDoR2, ErroRpc, gravarERegistrar, r2DoAmbiente, type Configuracao } from '../boletim/supabase.js'
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

export function criarFonteRelatorio(c: Configuracao, r2: ClienteR2 = r2DoAmbiente()): FonteRelatorio {
  const cliente = createClient(c.url, c.chaveSecreta, { auth: OPCOES_AUTH })
  return {
    baixar(bucket, caminho) {
      return baixarDoR2(r2, bucket, caminho)
    },
    enviar(bucket, caminho, bytes, tipo) {
      return gravarERegistrar(r2, cliente, bucket, caminho, bytes, tipo)
    },
    async assinar(bucket, caminho, segundos) {
      try {
        return await r2.urlAssinada('GET', chaveObjeto(bucket, caminho), segundos)
      } catch (e) {
        throw new Error(`Não foi possível assinar ${bucket}/${caminho}: ${e instanceof Error ? e.message : String(e)}`, { cause: e })
      }
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
