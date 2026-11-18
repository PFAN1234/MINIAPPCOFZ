import { Component, type ErrorInfo, type ReactNode } from 'react'
import { registrarErro } from '../util/erros.ts'

interface Props {
  children: ReactNode
}

interface Estado {
  falhou: boolean
}

/** Última rede de proteção: mostra "Algo deu errado" com "Recarregar" e registra o erro (com a pilha de componentes). */
export default class ErrorBoundary extends Component<Props, Estado> {
  state: Estado = { falhou: false }

  static getDerivedStateFromError(): Estado {
    return { falhou: true }
  }

  componentDidCatch(erro: Error, info: ErrorInfo): void {
    void registrarErro(erro, { componentStack: info.componentStack ?? null })
  }

  render() {
    if (!this.state.falhou) return this.props.children
    return (
      <div role="alert" style={{ padding: '2rem 1rem', textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.25rem' }}>Algo deu errado</h1>
        <p>O erro foi registrado. Recarregue para continuar.</p>
        <button type="button" onClick={() => location.reload()}>
          Recarregar
        </button>
      </div>
    )
  }
}
