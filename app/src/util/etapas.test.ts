import { describe, expect, it } from 'vitest'
import type { ObraDaLista } from '../dados/tipos.ts'
import { etapasDasObras } from './etapas.ts'

const etapa2 = { id: 'e2', slug: '2a-etapa', nome: '2ª ETAPA', ordem: 2 }
const etapa3 = { id: 'e3', slug: '3a-etapa', nome: '3ª ETAPA', ordem: 3 }

describe('etapasDasObras', () => {
  it('junta as etapas das obras e das outras obras, por ordem e sem repetir', () => {
    const obras = [
      { id: 'a', slug: 'a', nome: 'A', etapa: etapa3 },
      { id: 'b', slug: 'b', nome: 'B', etapa: etapa2 },
      { id: 'c', slug: 'c', nome: 'C', etapa: etapa2 },
    ] as ObraDaLista[]
    const outras = [
      { id: 'd', slug: 'd', nome: 'D', solicitacao: null, etapa_id: 'e1', etapa_nome: '1ª ETAPA', etapa_ordem: 1 },
    ]
    expect(etapasDasObras(obras, outras).map((e) => e.id)).toEqual(['e1', 'e2', 'e3'])
  })

  it('obra sem etapa (cache do aparelho de antes das etapas) não derruba a tela', () => {
    const antigas = [{ id: 'a', slug: 'hto', nome: 'HTO' }] as unknown as ObraDaLista[]
    expect(etapasDasObras(antigas, [])).toEqual([])
  })
})
