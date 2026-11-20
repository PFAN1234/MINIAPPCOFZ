import { ErroEnvio } from '../../../dados/erros.ts'

/** Linha crua devolvida pelas RPCs. */
export type Linha = Record<string, unknown>

// Mesma regra de `dados/supabase.ts` (lá serve às demais operações do Mini App).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function exigirUuid(valor: string, nome: string): string {
  if (!UUID.test(valor)) throw new ErroEnvio('validacao', `Identificador inválido (${nome}).`)
  return valor
}
