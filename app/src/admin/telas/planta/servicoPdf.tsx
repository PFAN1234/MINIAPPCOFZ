/**
 * Acesso ao processamento de PDF nas telas. Por padrão carrega `servicoNavegador.ts` sob
 * demanda (pdf.js e encoder WebP num chunk só do editor); os testes passam um serviço falso.
 */
import { createContext, useContext, type ReactNode } from 'react'
import type { ServicoPdf } from '../../planta/servico.ts'

type Carregar = () => Promise<ServicoPdf>

const carregarPadrao: Carregar = () => import('../../planta/servicoNavegador.ts').then((m) => m.servicoNavegador)

const Contexto = createContext<Carregar>(carregarPadrao)

export function ServicoPdfProvider({ servico, children }: { servico: ServicoPdf; children: ReactNode }) {
  return <Contexto.Provider value={() => Promise.resolve(servico)}>{children}</Contexto.Provider>
}

export function useServicoPdf(): Carregar {
  return useContext(Contexto)
}
