import { expect, it } from 'vitest'
import { ordenarPorReferencia } from './modelos.ts'

it('ordenarPorReferencia coloca a sigla de referência (ARQ) antes das demais preservando a ordem', () => {
  const ant = { sigla: 'ANT', revisao: 'R01', arquivo: 'ANT.frag', bytes: 1, hash: 'a' }
  const arq = { sigla: 'ARQ', revisao: 'R06', arquivo: 'ARQ.frag', bytes: 1, hash: 'b' }
  const elt = { sigla: 'ELT', revisao: 'R03', arquivo: 'ELT.frag', bytes: 1, hash: 'c' }
  expect(ordenarPorReferencia([ant, arq, elt]).map((m) => m.sigla)).toEqual(['ARQ', 'ANT', 'ELT'])
  expect(ordenarPorReferencia([ant, elt], 'ELT').map((m) => m.sigla)).toEqual(['ELT', 'ANT'])
})
