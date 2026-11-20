import { CABECALHO_LINHA_MAX, CABECALHO_LINHAS_MAX, CAMINHO_LOGO, ErroAdmin, NOME_OM_MAX, novoCaminhoLogo, problemaDoLogo } from '../../../admin/dados/tipos.ts'
import type { OrganizacaoAdminRepositorio } from '../application/ports/OrganizacaoAdminRepositorio.port.ts'
import type { Organizacao } from '../domain/tiposAdmin.ts'

/** Lê o arquivo como data URL (a fixture guarda o logo em memória). */
function dataUrl(arquivo: Blob): Promise<string> {
  return new Promise((resolver, rejeitar) => {
    const leitor = new FileReader()
    leitor.onload = () => resolver(String(leitor.result))
    leitor.onerror = () => rejeitar(leitor.error ?? new Error('Falha ao ler o arquivo'))
    leitor.readAsDataURL(arquivo)
  })
}

export interface OpcoesOrganizacaoAdminFixture {
  /** Exige sessão válida e admin (vem do repositório composto). */
  exigirAdmin: () => void
}

/** Estado próprio por instância: nome, logo (data URL) e cabeçalho. */
export function criarOrganizacaoAdminFixture({ exigirAdmin }: OpcoesOrganizacaoAdminFixture): OrganizacaoAdminRepositorio {
  const organizacao = {
    nome: 'CO-FZ',
    logo_path: null as string | null,
    cabecalho: [
      'COMANDO DA AERONÁUTICA',
      'DIRETORIA DE INFRAESTRUTURA DA AERONÁUTICA',
      'COMISSÃO DE OBRAS DE FORTALEZA (CO-FZ)',
    ],
  }
  /** Logos enviados: caminho → data URL. */
  const logos = new Map<string, string>()
  const organizacaoAtual = (): Organizacao => ({
    nome: organizacao.nome,
    logo_path: organizacao.logo_path,
    cabecalho: [...organizacao.cabecalho],
    logo_url: organizacao.logo_path ? (logos.get(organizacao.logo_path) ?? null) : null,
  })

  return {
    async obterOrganizacao() {
      // Como a RPC `organizacao()`: também sem sessão (tela de entrada).
      return organizacaoAtual()
    },

    async salvarOrganizacao(d) {
      exigirAdmin()
      const nome = (d.nome ?? '').trim()
      if (!nome || nome.length > NOME_OM_MAX) throw new ErroAdmin(`Informe o nome da OM (até ${NOME_OM_MAX} caracteres)`)
      if (d.logo_path !== null) {
        if (!CAMINHO_LOGO.test(d.logo_path)) throw new ErroAdmin('Caminho do logo inválido')
        if (!logos.has(d.logo_path)) throw new ErroAdmin('Logo não encontrado no Storage: envie o arquivo antes de salvar')
      }
      let cabecalho = organizacao.cabecalho
      if (d.cabecalho !== undefined) {
        if (d.cabecalho.length > CABECALHO_LINHAS_MAX) {
          throw new ErroAdmin(`O cabeçalho pode ter até ${CABECALHO_LINHAS_MAX} linhas`)
        }
        cabecalho = d.cabecalho.map((l) => l.trim())
        if (cabecalho.some((l) => l.length < 1 || l.length > CABECALHO_LINHA_MAX)) {
          throw new ErroAdmin(`Cada linha do cabeçalho precisa ter de 1 a ${CABECALHO_LINHA_MAX} caracteres`)
        }
      }
      organizacao.nome = nome
      organizacao.logo_path = d.logo_path
      organizacao.cabecalho = cabecalho
      return organizacaoAtual()
    },

    async enviarLogo(arquivo) {
      exigirAdmin()
      const problema = problemaDoLogo(arquivo)
      if (problema) throw new ErroAdmin(problema)
      const caminho = novoCaminhoLogo(arquivo.type)
      logos.set(caminho, await dataUrl(arquivo))
      return caminho
    },
  }
}
