import type { Armazenamento } from '@modules/armazenamento/application/ports/Armazenamento.port.ts'
import { CAMINHO_LOGO, ErroAdmin, novoCaminhoLogo, problemaDoLogo } from '../../../admin/dados/tipos.ts'
import type { OrganizacaoAdminRepositorio } from '../application/ports/OrganizacaoAdminRepositorio.port.ts'
import type { Organizacao } from '../domain/tiposAdmin.ts'
import { ErroEnvio } from '../../../dados/erros.ts'
import { MENSAGEM_REDE, type Linha, type Rpc } from './validacao.ts'

export function criarOrganizacaoAdminSupabase(armazenamento: Armazenamento, rpc: Rpc): OrganizacaoAdminRepositorio {
  async function organizacaoDe(l: Linha | null): Promise<Organizacao> {
    const logo = typeof l?.logo_path === 'string' && l.logo_path ? l.logo_path : null
    // Sem URL (falha ou arquivo ausente), o logo fica sem imagem; o resto da organização segue.
    const url = logo ? await armazenamento.urls('organizacao', [logo]).then((m) => m.get(logo) ?? null, () => null) : null
    return {
      nome: typeof l?.nome === 'string' && l.nome ? l.nome : 'CO-FZ',
      logo_path: logo,
      logo_url: url,
      cabecalho: Array.isArray(l?.cabecalho) ? l.cabecalho.map(String) : [],
    }
  }

  return {
    async obterOrganizacao() {
      const d = await rpc<Linha | Linha[] | null>('organizacao')
      return await organizacaoDe(Array.isArray(d) ? (d[0] ?? null) : d)
    },

    async salvarOrganizacao(dados) {
      return await organizacaoDe(await rpc<Linha | null>('admin_salvar_organizacao', { p: dados }))
    },

    async enviarLogo(arquivo) {
      const problema = problemaDoLogo(arquivo)
      if (problema) throw new ErroAdmin(problema)
      const caminho = novoCaminhoLogo(arquivo.type)
      if (!CAMINHO_LOGO.test(caminho)) throw new ErroAdmin('Caminho do logo inválido.')
      try {
        // `ja_confirmado` conta como enviado.
        await armazenamento.enviar('organizacao', caminho, arquivo, arquivo.type)
      } catch (e) {
        if (e instanceof ErroEnvio) {
          if (e.tipo === 'rede') throw new ErroAdmin(MENSAGEM_REDE, { cause: e })
          if (e.tipo === 'permissao') throw new ErroAdmin('Sem permissão para enviar o logo.', { cause: e })
          throw new ErroAdmin(`Falha ao enviar o logo: ${e.message}`, { cause: e })
        }
        throw new ErroAdmin(MENSAGEM_REDE, { cause: e })
      }
      return caminho
    },
  }
}
