import type { EtapaInicio } from '../../domain/tipos.ts'

export interface EtapasInicioRepositorio {
  /** Etapas ativas, com a participação do usuário. */
  etapasInicio(): Promise<EtapaInicio[]>
}
