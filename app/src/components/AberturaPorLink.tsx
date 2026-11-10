import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { useRepositorio } from '../dados/contexto.tsx'
import { parametroInicial } from '../telegram.ts'
import { Aviso } from './Aviso.tsx'

const CHAVE_CONSUMIDO = 'startapp-consumido'
const REGISTRO = /^registro_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
const ACESSOS = /^acessos_([a-z0-9][a-z0-9-]*)$/i

function jaConsumido(parametro: string): boolean {
  try {
    return sessionStorage.getItem(CHAVE_CONSUMIDO) === parametro
  } catch {
    return false
  }
}

function marcarConsumido(parametro: string): void {
  try {
    sessionStorage.setItem(CHAVE_CONSUMIDO, parametro)
  } catch {
    // Sem sessionStorage: o link pode ser aberto de novo ao recarregar.
  }
}

/**
 * Trata o parâmetro do link `startapp` uma vez por abertura do app:
 * `registro_<uuid>` abre o registro no ambiente; `acessos_<slug>` abre os pedidos de acesso.
 */
export function AberturaPorLink() {
  const repo = useRepositorio()
  const navigate = useNavigate()
  const [aviso, setAviso] = useState<string | null>(null)

  useEffect(() => {
    const parametro = parametroInicial()
    if (!parametro || jaConsumido(parametro)) return

    const acessos = ACESSOS.exec(parametro)
    if (acessos) {
      marcarConsumido(parametro)
      navigate(`/obras/${acessos[1]}/acessos`)
      return
    }
    const registro = REGISTRO.exec(parametro)
    if (!registro) {
      marcarConsumido(parametro)
      return
    }
    const id = registro[1]
    let ativo = true
    repo
      .localizarRegistro(id)
      .then((r) => {
        if (!ativo) return
        marcarConsumido(parametro)
        if (!r) {
          setAviso('Registro não encontrado ou sem acesso.')
          return
        }
        const aba = r.tipo === 'pendencia' ? 'pendencias' : 'historico'
        navigate(`/obras/${r.slug}/ambientes/${r.codigo}?aba=${aba}&registro=${id}`)
      })
      .catch(() => {
        if (!ativo) return
        marcarConsumido(parametro)
        setAviso('Registro não encontrado ou sem acesso.')
      })
    return () => {
      ativo = false
    }
  }, [repo, navigate])

  if (!aviso) return null
  return (
    <div className="aviso-fixo">
      <Aviso texto={aviso} onFechar={() => setAviso(null)} />
    </div>
  )
}
