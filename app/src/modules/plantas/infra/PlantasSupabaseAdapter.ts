import type { SupabaseClient } from '@supabase/supabase-js'
import { ErroAdmin } from '../../../admin/dados/tipos.ts'
import type { PlantasRepositorio } from '../application/ports/PlantasRepositorio.port.ts'
import type { DadosEditorPlanta, Publicacao, ResultadoPublicacao } from '../domain/tipos.ts'

type Rpc = <T>(nome: string, args?: Record<string, unknown>) => Promise<T>

const MENSAGEM_REDE = 'Sem conexão com o servidor. Verifique a internet e tente de novo.'

/** Adaptador Supabase da planta (admin). `rpc` é o do admin, que traduz os erros das RPCs. */
export function criarPlantasSupabase(cliente: SupabaseClient, rpc: Rpc): PlantasRepositorio {
  return {
    obterEditorPlanta(slug) {
      return rpc<DadosEditorPlanta>('admin_editor_planta', { p_slug: slug })
    },

    async listarPublicacoes(slug) {
      return ((await rpc<Publicacao[]>('admin_listar_publicacoes', { p_slug: slug })) ?? []).map((l) => ({
        ...l,
        resumo: (l.resumo ?? {}) as Record<string, unknown>,
      }))
    },

    async enviarArquivo(bucket, caminho, arquivo, tipo) {
      let erro: unknown
      try {
        const { error } = await cliente.storage.from(bucket).upload(caminho, arquivo, { upsert: true, contentType: tipo })
        erro = error
      } catch (e) {
        throw new ErroAdmin(MENSAGEM_REDE, { cause: e })
      }
      if (erro) {
        const msg = (erro as { message?: string }).message ?? ''
        if (/row-level security|unauthorized|403/i.test(msg)) {
          throw new ErroAdmin(`Sem permissão para gravar ${caminho} no Storage (${bucket}).`, { cause: erro })
        }
        if (/payload too large|413|exceeded/i.test(msg)) {
          throw new ErroAdmin(`Arquivo grande demais para o bucket ${bucket}: ${caminho}.`, { cause: erro })
        }
        throw new ErroAdmin(`Falha ao enviar ${caminho}: ${msg || 'erro do Storage'}`, { cause: erro })
      }
    },

    async baixarOriginal(caminho) {
      const { data, error } = await cliente.storage.from('originais').download(caminho)
      if (error || !data) throw new ErroAdmin('Não foi possível baixar o PDF guardado.', { cause: error })
      return new Uint8Array(await data.arrayBuffer())
    },

    publicarRevisao(slug, payload) {
      return rpc<ResultadoPublicacao>('admin_publicar_revisao', { p_slug: slug, p: payload })
    },
  }
}
