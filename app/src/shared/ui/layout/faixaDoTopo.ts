import { createContext, type ReactNode } from 'react'

/**
 * Faixa que o `TopoTela` mostra logo abaixo do azul (a de envio e de sem sinal, entregue pelo
 * `Layout`). Fica abaixo, e não acima, para o azul do topo emendar com o cabeçalho do Telegram.
 */
export const FaixaDoTopo = createContext<ReactNode>(null)
