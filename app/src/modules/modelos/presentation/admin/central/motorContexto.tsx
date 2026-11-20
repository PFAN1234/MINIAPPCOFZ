import { createContext, useContext, type ReactNode } from 'react'
import type { FabricaMotor } from '../../../application/ports/MotorVisualizador.port.ts'

const Contexto = createContext<FabricaMotor | null>(null)

/**
 * Entrega a fábrica do motor 3D à central. Quem decide qual motor usar (That Open, carregado
 * sob demanda) é o composition root do admin (`apps/admin/main.tsx`); os testes injetam o dublê.
 */
export function FabricaMotorProvider({ fabrica, children }: { fabrica: FabricaMotor; children: ReactNode }) {
  return <Contexto.Provider value={fabrica}>{children}</Contexto.Provider>
}

export function useFabricaMotor(): FabricaMotor {
  const f = useContext(Contexto)
  if (!f) throw new Error('useFabricaMotor fora de FabricaMotorProvider')
  return f
}
