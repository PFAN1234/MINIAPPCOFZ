import { useEffect, useRef } from 'react'
import { Link } from 'react-router'
import type { RegistroResumo } from '../dados/tipos.ts'
import type { ItemFila } from '../offline/fila.ts'
import { Horario } from './Horario.tsx'
import { EstadoVazio } from './Estado.tsx'
import { MiniaturaRegistro } from './MiniaturaRegistro.tsx'
import { RegistroLocal } from './RegistroLocal.tsx'

function Selo({ registro }: { registro: RegistroResumo }) {
  if (registro.tipo === 'servico') return <span className="selo selo-servico">Serviço</span>
  return registro.situacao === 'aberta' ? (
    <span className="selo selo-aberta">Pendência aberta</span>
  ) : (
    <span className="selo selo-resolvida">Pendência resolvida</span>
  )
}

const TEXTO_PUBLICACAO: Record<NonNullable<RegistroResumo['publicacao']>, string> = {
  pendente: 'Salvo no servidor · aguardando publicação',
  enviando: 'Salvo no servidor · aguardando publicação',
  publicado: 'Publicado no tópico',
  incerto: 'Publicação com problema',
  falhou: 'Publicação com problema',
}

export function Publicacao({ estado }: { estado: RegistroResumo['publicacao'] }) {
  if (!estado) return null
  const classe =
    estado === 'publicado'
      ? 'publicacao-ok'
      : estado === 'incerto' || estado === 'falhou'
        ? 'publicacao-problema'
        : 'publicacao-espera'
  return <span className={`publicacao ${classe}`}>{TEXTO_PUBLICACAO[estado]}</span>
}

/** Lista de registros; `local` esconde obra e ambiente (já conhecidos na tela do ambiente). */
export function ListaRegistros({
  registros,
  vazio,
  local = false,
  locais = [],
  limite,
  destaque,
}: {
  registros: RegistroResumo[]
  vazio: string
  local?: boolean
  /** Registros ainda no aparelho; aparecem antes dos do servidor. */
  locais?: ItemFila[]
  /** Máximo de itens na soma de locais e servidor. */
  limite?: number
  /** Id de um registro a destacar: rola até ele e abre suas fotos. */
  destaque?: string | null
}) {
  const itemDestaque = useRef<HTMLLIElement>(null)
  const temDestaque = !!destaque && registros.some((r) => r.id === destaque)
  useEffect(() => {
    if (temDestaque) itemDestaque.current?.scrollIntoView?.({ block: 'center' })
  }, [temDestaque])
  const ids = new Set(registros.map((r) => r.id))
  const proprios = locais.filter((i) => !ids.has(i.registro.id))
  const total = limite ?? Infinity
  const mostrarLocais = proprios.slice(0, total)
  const mostrarServidor = registros.slice(0, Math.max(0, total - mostrarLocais.length))
  if (mostrarLocais.length + mostrarServidor.length === 0) return <EstadoVazio titulo={vazio} />
  return (
    <ul className="lista">
      {mostrarLocais.map((i) => (
        <RegistroLocal key={i.registro.id} item={i} local={local} />
      ))}
      {mostrarServidor.map((r) => {
        const conteudo = (
          <>
            <span className="registro-topo">
              <Selo registro={r} />
              <span className="lista-sub">
                <Horario iso={r.capturado_em} />
              </span>
            </span>
            <span className="lista-titulo registro-legenda">{r.legenda}</span>
            <span className="lista-sub">
              {local ? r.autor : `${r.obra.nome} · ${r.ambiente.nome} · ${r.autor}`}
            </span>
            <Publicacao estado={r.publicacao} />
          </>
        )
        return (
          <li
            key={r.id}
            ref={r.id === destaque ? itemDestaque : undefined}
            className={r.id === destaque ? 'registro-item registro-destaque' : 'registro-item'}
          >
            <MiniaturaRegistro registro={r} abrirInicial={r.id === destaque} />
            {r.tipo === 'pendencia' ? (
              <Link
                className="lista-item registro-corpo"
                to={`/obras/${r.obra.slug}/pendencias/${r.id}`}
              >
                {conteudo}
              </Link>
            ) : local ? (
              <div className="lista-item registro-corpo">{conteudo}</div>
            ) : (
              <Link
                className="lista-item registro-corpo"
                to={`/obras/${r.obra.slug}/ambientes/${r.ambiente.codigo}`}
              >
                {conteudo}
              </Link>
            )}
          </li>
        )
      })}
    </ul>
  )
}
