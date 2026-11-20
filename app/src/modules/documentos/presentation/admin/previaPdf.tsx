/**
 * Acesso à prévia de PDF nas telas. Por padrão carrega `previaPdfNavegador.ts` sob demanda
 * (pdf.js num chunk à parte); os testes passam uma implementação falsa.
 */
import { createContext, useContext, type ReactNode } from 'react'
import type { PreviaPdf } from '../../application/ports/PreviaPdf.port.ts'

type Carregar = () => Promise<PreviaPdf>

const carregarPadrao: Carregar = () => import('../../infra/previaPdfNavegador.ts').then((m) => m.previaPdfNavegador)

const Contexto = createContext<Carregar>(carregarPadrao)

export function PreviaPdfProvider({ previa, children }: { previa: PreviaPdf; children: ReactNode }) {
  return <Contexto.Provider value={() => Promise.resolve(previa)}>{children}</Contexto.Provider>
}

export function usePreviaPdf(): Carregar {
  return useContext(Contexto)
}
