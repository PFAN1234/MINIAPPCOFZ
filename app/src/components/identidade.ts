import { createContext } from 'react'
import type { Organizacao } from '../dados/tipos.ts'

/** Nome do app, na faixa de identidade do topo e nas telas de entrada. */
export const NOME_APP = 'Fiscal Bot'

/**
 * Organização militar mostrada na faixa de identidade do `TopoTela`. Entregue pelo `Layout`
 * (consulta `organizacao`); `null` enquanto não há dados (primeira abertura sem sinal, erro) ou
 * fora do `Layout`, e então a faixa mostra só "Fiscal Bot".
 */
export const OrganizacaoContexto = createContext<Organizacao | null>(null)
