import type { OrganizacaoRepositorio } from '../application/ports/OrganizacaoRepositorio.port.ts'

/** Como a linha padrão de `organizacao` no banco: "CO-FZ", sem logo. */
export const NOME_ORGANIZACAO = 'CO-FZ'

export function criarOrganizacaoFixture(logo: string | null | undefined): OrganizacaoRepositorio {
  return {
    async organizacao() {
      return { nome: NOME_ORGANIZACAO, logo_url: logo || null }
    },
  }
}
