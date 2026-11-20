import type { AmbienteDetalhe, ObraDaLista, ObraDetalhe, ResumoObra } from '../../domain/tipos.ts'

/** Obras do Mini App: lista, totais, detalhe (pavimentos e ambientes) e ambiente. */
export interface ObrasRepositorio {
  /** Obras em que o usuário participa, cada uma com a sua etapa. */
  listarObras(): Promise<ObraDaLista[]>
  /** Totais por obra visível (serviços, pendências abertas e resolvidas) e o papel do usuário. */
  resumoObras(): Promise<ResumoObra[]>
  /** Pavimentos (com planta ativa), ambientes e pendências abertas por ambiente. */
  obterObra(slug: string): Promise<ObraDetalhe>
  obterAmbiente(slug: string, codigo: string): Promise<AmbienteDetalhe>
}
