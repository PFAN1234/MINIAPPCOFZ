import type { Armazenamento } from '@modules/armazenamento/application/ports/Armazenamento.port.ts'
import type { SupabaseClient } from '@supabase/supabase-js'
import { erroDoSupabase } from '../../../dados/erros.ts'
import { erroDeColunaAusente } from '../../../shared/infra/errosSupabase.ts'
import type { ModelosRepositorio } from '../application/ports/ModelosRepositorio.port.ts'
import type { ModeloFrag } from '../domain/modelos.ts'
import type { DadosModelos, ModeloAdmin, ObraCentral, RegistroModelo } from '../domain/tipos.ts'

type Linha = Record<string, unknown>
type Rpc = <T>(nome: string, args?: Record<string, unknown>) => Promise<T>

function checar<T>(resposta: { data: T | null; error: { message: string } | null }): T {
  if (resposta.error) throw new Error(resposta.error.message)
  return resposta.data as T
}

/**
 * Adaptador Supabase dos modelos. `rpcAdmin` traduz os erros das chamadas admin; o app do campo
 * não usa essas operações, então o padrão apenas repassa a mensagem.
 */
export function criarModelosSupabase(
  cliente: SupabaseClient,
  armazenamento: Armazenamento,
  rpcAdmin?: Rpc,
): ModelosRepositorio {
  const rpc: Rpc =
    rpcAdmin ??
    (async (nome, args) => {
      const { data, error } = await cliente.rpc(nome, args)
      if (error) throw new Error(error.message)
      return data as never
    })
  return {
    async listarModelos(slug) {
      const obra = checar(await cliente.from('obra').select('id, slug, nome').eq('slug', slug).maybeSingle()) as { id: string } | null
      if (!obra) throw new Error('Obra não encontrada.')
      const comMatriz = await cliente
        .from('modelo')
        .select('sigla, revisao, caminho, bytes, hash, matriz')
        .eq('obra_id', obra.id)
        .order('sigla')
      const resposta = erroDeColunaAusente(comMatriz.error)
        ? await cliente.from('modelo').select('sigla, revisao, caminho, bytes, hash').eq('obra_id', obra.id).order('sigla')
        : comMatriz
      const linhas = checar(resposta) as Linha[]
      return linhas.map(
        (l): ModeloFrag => ({
          sigla: String(l.sigla),
          revisao: l.revisao == null ? null : String(l.revisao),
          arquivo: String(l.caminho),
          bytes: Number(l.bytes),
          hash: String(l.hash),
          ...(Array.isArray(l.matriz) && l.matriz.length === 16 ? { matriz: l.matriz.map(Number) } : {}),
        }),
      )
    },

    async baixarModelo(_slug, modelo) {
      try {
        const blob = await armazenamento.baixar('modelos', modelo.arquivo)
        return await blob.arrayBuffer()
      } catch (e) {
        throw erroDoSupabase(e)
      }
    },

    async listarModelosAdmin(slug) {
      const d = await rpc<DadosModelos | null>('admin_listar_modelos', { p_slug: slug })
      const numero = (v: unknown) => (v == null ? null : Number(v))
      return {
        modelos: (d?.modelos ?? []).map((m) => ({ ...m, bytes: Number(m.bytes) })),
        historico: (d?.historico ?? []).map((h) => ({ ...h, bytes: numero(h.bytes), ifc_bytes: numero(h.ifc_bytes) })),
      }
    },

    async listarObrasCentral() {
      const linhas = await rpc<ObraCentral[] | null>('admin_central_obras')
      return (linhas ?? []).map((o) => ({
        ...o,
        disciplinas: Number(o.disciplinas),
        documentos: Number(o.documentos),
        issues_abertas: Number(o.issues_abertas),
      }))
    },

    async registrarModelo(slug, registro: RegistroModelo) {
      const m = await rpc<ModeloAdmin>('admin_registrar_modelo', { p_slug: slug, p: registro })
      return { ...m, bytes: Number(m.bytes) }
    },

    async retirarModelo(slug, sigla) {
      await rpc('admin_retirar_modelo', { p_slug: slug, p_sigla: sigla })
    },
  }
}
