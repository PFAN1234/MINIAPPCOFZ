import type { Organizacao } from '../../domain/tiposAdmin.ts'

/** Identidade da organização militar no site de administração (nome, logo e cabeçalho do boletim). */
export interface OrganizacaoAdminRepositorio {
  /** Nome e logo da organização militar (RPC `organizacao()`, também sem sessão). */
  obterOrganizacao(): Promise<Organizacao>
  /** `logo_path` null tira o logo; se vier, precisa já estar no bucket `organizacao`. `cabecalho` ausente mantém; `[]` limpa. */
  salvarOrganizacao(dados: { nome: string; logo_path: string | null; cabecalho?: string[] }): Promise<Organizacao>
  /** Envia o logo ao bucket `organizacao` (PNG, JPEG ou WebP, até 1 MB) e devolve o caminho. */
  enviarLogo(arquivo: Blob): Promise<string>
}
