import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { criarRepositorioAdmin, type RepositorioAdmin } from './repositorio.ts'

const Contexto = createContext<RepositorioAdmin | null>(null)

interface Props {
  /** Repositório já pronto (testes); sem ele, usa `criarRepositorioAdmin()`. */
  repositorio?: RepositorioAdmin
  carregando?: ReactNode
  children: ReactNode
}

export function RepositorioAdminProvider({ repositorio, carregando = null, children }: Props) {
  const [criado, setCriado] = useState<RepositorioAdmin | null>(null)
  const [erro, setErro] = useState<Error | null>(null)

  useEffect(() => {
    if (repositorio) return
    let ativo = true
    criarRepositorioAdmin().then(
      (r) => ativo && setCriado(r),
      (e: unknown) => ativo && setErro(e instanceof Error ? e : new Error(String(e))),
    )
    return () => {
      ativo = false
    }
  }, [repositorio])

  if (erro) throw erro
  const atual = repositorio ?? criado
  if (!atual) return <>{carregando}</>
  return <Contexto.Provider value={atual}>{children}</Contexto.Provider>
}

export function useRepositorioAdmin(): RepositorioAdmin {
  const r = useContext(Contexto)
  if (!r) throw new Error('useRepositorioAdmin fora de RepositorioAdminProvider')
  return r
}
