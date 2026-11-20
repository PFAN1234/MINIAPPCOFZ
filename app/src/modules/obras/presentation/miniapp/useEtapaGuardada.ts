import { useState } from 'react'
import { guardarEtapa, lerEtapaGuardada } from '../../domain/etapas.ts'
import type { Etapa } from '../../domain/tipos.ts'

/**
 * Etapa escolhida na tela inicial, lembrada no aparelho. A guardada que não está mais na lista
 * (etapa arquivada, acesso removido) dá lugar à primeira, sem apagar a escolha: ela volta a valer
 * se a etapa reaparecer (por exemplo, quando as "Outras obras" terminam de carregar).
 */
export function useEtapaEscolhida(
  usuarioId: string,
  etapas: readonly Etapa[],
): [Etapa | null, (etapaId: string) => void] {
  const [escolhida, setEscolhida] = useState(() => lerEtapaGuardada(usuarioId))
  const atual = etapas.find((e) => e.id === escolhida) ?? etapas[0] ?? null
  function escolher(etapaId: string) {
    setEscolhida(etapaId)
    guardarEtapa(usuarioId, etapaId)
  }
  return [atual, escolher]
}
