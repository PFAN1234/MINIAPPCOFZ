import { useSyncExternalStore } from 'react'
import { Link } from 'react-router'
import { useFila } from '../offline/contexto.tsx'

function assinarConexao(fn: () => void): () => void {
  window.addEventListener('online', fn)
  window.addEventListener('offline', fn)
  return () => {
    window.removeEventListener('online', fn)
    window.removeEventListener('offline', fn)
  }
}
const estaOnline = () => navigator.onLine

/** Faixa acima do conteúdo com o estado da fila de envio e da conexão. */
export function BarraSincronizacao() {
  const { estado, sincronizar } = useFila()
  const online = useSyncExternalStore(assinarConexao, estaOnline)
  const aguardando = estado.itens.filter((i) => i.estado !== 'erro').length
  const comErro = estado.itens.filter((i) => i.estado === 'erro').length

  if (aguardando === 0 && comErro === 0 && online) return null

  return (
    <div className="barra-sinc">
      {aguardando > 0 && (
        <div className="barra-sinc-linha">
          <p role="status">
            {aguardando === 1
              ? '1 registro aguardando envio'
              : `${aguardando} registros aguardando envio`}
          </p>
          <button
            type="button"
            className="botao barra-sinc-botao"
            disabled={estado.sincronizando}
            onClick={() => void sincronizar()}
          >
            {estado.sincronizando ? 'Enviando…' : 'Tentar agora'}
          </button>
        </div>
      )}
      {comErro > 0 && (
        <div className="barra-sinc-linha barra-sinc-erro">
          <p role="status">
            {comErro === 1
              ? '1 registro com erro no envio'
              : `${comErro} registros com erro no envio`}
          </p>
          <Link className="barra-sinc-link" to="/registros">
            Ver
          </Link>
        </div>
      )}
      {aguardando === 0 && comErro === 0 && (
        <div className="barra-sinc-linha">
          <p role="status">Sem conexão · mostrando dados salvos no aparelho</p>
        </div>
      )}
    </div>
  )
}
