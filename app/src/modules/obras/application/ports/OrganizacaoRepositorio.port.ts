import type { Organizacao } from '../../domain/tipos.ts'

export interface OrganizacaoRepositorio {
  /** Nome e logo da organização militar (faixa de identidade do topo). */
  organizacao(): Promise<Organizacao>
}
