import type { ReactNode } from 'react'

export function EstadoCarregando({ texto = 'Carregando…' }: { texto?: string }) {
  return (
    <div className="estado" role="status" aria-live="polite">
      <p className="estado-texto">{texto}</p>
    </div>
  )
}

interface ErroProps {
  mensagem?: string
  onTentarDeNovo?: () => void
}

export function EstadoErro({
  mensagem = 'Não foi possível carregar.',
  onTentarDeNovo,
}: ErroProps) {
  return (
    <div className="estado estado-erro" role="alert">
      <p className="estado-titulo">Algo deu errado</p>
      <p className="estado-texto">{mensagem}</p>
      {onTentarDeNovo && (
        <button type="button" className="botao" onClick={onTentarDeNovo}>
          Tentar de novo
        </button>
      )}
    </div>
  )
}

export function EstadoVazio({ titulo, texto }: { titulo: string; texto?: string }) {
  return (
    <div className="estado-vazio">
      <p className="estado-vazio-titulo">{titulo}</p>
      {texto && <p className="estado-vazio-texto">{texto}</p>}
    </div>
  )
}

interface Consulta<T> {
  data: T | undefined
  isPending: boolean
  isError: boolean
  error: unknown
  refetch: () => unknown
  fetchStatus?: 'fetching' | 'paused' | 'idle'
}

/** Trata carregamento e erro de uma consulta e entrega os dados prontos. */
export function EstadoConsulta<T>({
  consulta,
  children,
}: {
  consulta: Consulta<T>
  children: (dados: T) => ReactNode
}) {
  // Dados já vistos (inclusive os guardados no aparelho) valem mais que um erro de rede.
  if (consulta.data !== undefined) return <>{children(consulta.data)}</>
  if (consulta.fetchStatus === 'paused') {
    return (
      <div className="estado" role="status">
        <p className="estado-texto">Sem conexão. Esta tela aparece quando o sinal voltar.</p>
        <button type="button" className="botao" onClick={() => void consulta.refetch()}>
          Tentar de novo
        </button>
      </div>
    )
  }
  if (consulta.isPending) return <EstadoCarregando />
  const msg = consulta.error instanceof Error ? consulta.error.message : undefined
  return <EstadoErro mensagem={msg} onTentarDeNovo={() => void consulta.refetch()} />
}
