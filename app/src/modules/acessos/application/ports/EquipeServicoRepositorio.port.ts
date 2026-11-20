import type { EquipeServico, Posicao } from '../../domain/tipos.ts'

/** Equipe de serviço de uma etapa e check-in/check-out do usuário (Mini App). */
export interface EquipeServicoRepositorio {
  equipeServico(etapaId: string): Promise<EquipeServico>
  fazerCheckin(etapaId: string, posicao: Posicao): Promise<EquipeServico>
  fazerCheckout(): Promise<EquipeServico>
}
