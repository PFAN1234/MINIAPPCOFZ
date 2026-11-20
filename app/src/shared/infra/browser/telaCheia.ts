import { createContext, useContext, useEffect } from 'react'

/** Permite que uma tela peça ao layout para esconder a barra inferior. */
export const TelaCheiaContexto = createContext<(ativa: boolean) => void>(() => {})

/** Enquanto `ativa` for verdadeiro, a barra inferior fica oculta (ex.: planta em tela cheia). */
export function useTelaCheia(ativa: boolean): void {
  const definir = useContext(TelaCheiaContexto)
  useEffect(() => {
    definir(ativa)
    return () => definir(false)
  }, [ativa, definir])
}
