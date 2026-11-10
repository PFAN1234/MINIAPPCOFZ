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
  const regsAguardando = estado.itens.filter((i) => i.estado !== 'erro').length
  const regsComErro = estado.itens.filter((i) => i.estado === 'erro').length
  const encsAguardando = estado.encerramentos.filter((i) => i.estado !== 'erro').length
  const encsComErro = estado.encerramentos.filter((i) => i.estado === 'erro')
  const aguardando = regsAguardando + encsAguardando
  const comErro = regsComErro + encsComErro.length
  // Só registros: o texto de sempre; com encerramentos na fila, fala em "itens".
  const soRegistros = encsAguardando === 0 && encsComErro.length === 0
  // Um único encerramento com erro leva direto à pendência dele.
  const destinoErro =
    regsComErro === 0 && encsComErro.length === 1
      ? `/obras/${encsComErro[0].encerramento.obra.slug}/pendencias/${encsComErro[0].encerramento.pendenciaId}`
      : '/registros'

  if (aguardando === 0 && comErro === 0 && online) return null

  return (
    <div className="barra-sinc">
      {aguardando > 0 && (
        <div className="barra-sinc-linha">
          <p role="status">
            {soRegistros
              ? aguardando === 1
                ? '1 registro aguardando envio'
                : `${aguardando} registros aguardando envio`
              : aguardando === 1
                ? '1 item aguardando envio'
                : `${aguardando} itens aguardando envio`}
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
            {soRegistros
              ? comErro === 1
                ? '1 registro com erro no envio'
                : `${comErro} registros com erro no envio`
              : comErro === 1
                ? '1 item com erro no envio'
                : `${comErro} itens com erro no envio`}
          </p>
          <Link className="barra-sinc-link" to={destinoErro}>
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
