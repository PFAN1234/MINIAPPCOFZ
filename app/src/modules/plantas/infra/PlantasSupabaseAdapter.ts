import type { Armazenamento } from '@modules/armazenamento/application/ports/Armazenamento.port.ts'
import { ErroEnvio } from '../../../dados/erros.ts'
import { ErroAdmin } from '../../../admin/dados/tipos.ts'
import type { PlantasRepositorio } from '../application/ports/PlantasRepositorio.port.ts'
import type { DadosEditorPlanta, Publicacao, ResultadoPublicacao } from '../domain/tipos.ts'

type Rpc = <T>(nome: string, args?: Record<string, unknown>) => Promise<T>

const MENSAGEM_REDE = 'Sem conexão com o servidor. Verifique a internet e tente de novo.'

/** Adaptador Supabase da planta (admin). `rpc` é o do admin, que traduz os erros das RPCs. */
export function criarPlantasSupabase(armazenamento: Armazenamento, rpc: Rpc): PlantasRepositorio {
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

    async enviarArquivo(pasta, caminho, arquivo, tipo) {
      try {
        // `ja_confirmado` (reenvio) conta como enviado.
        await armazenamento.enviar(pasta, caminho, arquivo, tipo)
      } catch (e) {
        if (e instanceof ErroEnvio) {
          if (e.tipo === 'rede') throw new ErroAdmin(MENSAGEM_REDE, { cause: e })
          if (e.tipo === 'permissao') {
            throw new ErroAdmin(`Sem permissão para gravar ${caminho} (${pasta}).`, { cause: e })
          }
          throw new ErroAdmin(`Falha ao enviar ${caminho}: ${e.message}`, { cause: e })
        }
        throw new ErroAdmin(MENSAGEM_REDE, { cause: e })
      }
    },

    async baixarOriginal(caminho) {
      try {
        const blob = await armazenamento.baixar('originais', caminho)
        return new Uint8Array(await blob.arrayBuffer())
      } catch (e) {
        throw new ErroAdmin('Não foi possível baixar o PDF guardado.', { cause: e })
      }
    },

    publicarRevisao(slug, payload) {
      return rpc<ResultadoPublicacao>('admin_publicar_revisao', { p_slug: slug, p: payload })
    },
  }
}
