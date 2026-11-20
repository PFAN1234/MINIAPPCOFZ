import type { SupabaseClient } from '@supabase/supabase-js'
import { CAMINHO_LOGO, ErroAdmin, novoCaminhoLogo, problemaDoLogo } from '../../../admin/dados/tipos.ts'
import type { OrganizacaoAdminRepositorio } from '../application/ports/OrganizacaoAdminRepositorio.port.ts'
import type { Organizacao } from '../domain/tiposAdmin.ts'
import { MENSAGEM_REDE, type Linha, type Rpc } from './validacao.ts'

/** `base` é a URL do projeto (sem barra final), para montar a URL pública do logo. */
export function criarOrganizacaoAdminSupabase(cliente: SupabaseClient, rpc: Rpc, base: string): OrganizacaoAdminRepositorio {
  function organizacaoDe(l: Linha | null): Organizacao {
    const logo = typeof l?.logo_path === 'string' && l.logo_path ? l.logo_path : null
    return {
      nome: typeof l?.nome === 'string' && l.nome ? l.nome : 'CO-FZ',
      logo_path: logo,
      logo_url: logo ? `${base}/storage/v1/object/public/organizacao/${logo}` : null,
      cabecalho: Array.isArray(l?.cabecalho) ? l.cabecalho.map(String) : [],
    }
  }

  return {
    async obterOrganizacao() {
      const d = await rpc<Linha | Linha[] | null>('organizacao')
      return organizacaoDe(Array.isArray(d) ? (d[0] ?? null) : d)
    },

    async salvarOrganizacao(dados) {
      return organizacaoDe(await rpc<Linha | null>('admin_salvar_organizacao', { p: dados }))
    },

    async enviarLogo(arquivo) {
      const problema = problemaDoLogo(arquivo)
      if (problema) throw new ErroAdmin(problema)
      const caminho = novoCaminhoLogo(arquivo.type)
      if (!CAMINHO_LOGO.test(caminho)) throw new ErroAdmin('Caminho do logo inválido.')
      let erro: unknown
      try {
        const { error } = await cliente.storage
          .from('organizacao')
          .upload(caminho, arquivo, { upsert: false, contentType: arquivo.type, cacheControl: '31536000' })
        erro = error
      } catch (e) {
        throw new ErroAdmin(MENSAGEM_REDE, { cause: e })
      }
      if (erro) {
        const msg = (erro as { message?: string }).message ?? ''
        if (/row-level security|unauthorized|403/i.test(msg)) {
          throw new ErroAdmin('Sem permissão para enviar o logo (bucket organizacao).', { cause: erro })
        }
        if (/payload too large|413|exceeded/i.test(msg)) throw new ErroAdmin('O logo pode ter no máximo 1 MB.', { cause: erro })
        throw new ErroAdmin(`Falha ao enviar o logo: ${msg || 'erro do Storage'}`, { cause: erro })
      }
      return caminho
    },
  }
}
