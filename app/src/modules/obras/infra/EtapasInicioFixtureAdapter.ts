import type { EtapasInicioRepositorio } from '../application/ports/EtapasInicioRepositorio.port.ts'
import type { Etapa } from '../domain/tipos.ts'

/** Todas as etapas ativas; o usuário participa de todas, menos da `etapaSemParticipacao`. */
export function criarEtapasInicioFixture(etapas: readonly Etapa[], etapaSemParticipacao: string): EtapasInicioRepositorio {
  return {
    async etapasInicio() {
      return etapas.map((e) => ({ ...e, participa: e.id !== etapaSemParticipacao }))
    },
  }
}
