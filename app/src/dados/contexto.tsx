import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { criarRepositorio, type Repositorio } from './repositorio.ts'

const Contexto = createContext<Repositorio | null>(null)

interface Props {
  /** Repositório já pronto (testes); sem ele, usa `criarRepositorio()`. */
  repositorio?: Repositorio
  /** Mostrado enquanto o repositório carrega. */
  carregando?: ReactNode
  children: ReactNode
}

export function RepositorioProvider({ repositorio, carregando = null, children }: Props) {
  const [criado, setCriado] = useState<Repositorio | null>(null)
  const [erro, setErro] = useState<Error | null>(null)

  useEffect(() => {
    if (repositorio) return
    let ativo = true
    criarRepositorio().then(
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

export function useRepositorio(): Repositorio {
  const r = useContext(Contexto)
  if (!r) throw new Error('useRepositorio fora de RepositorioProvider')
  return r
}
