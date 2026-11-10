import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { CampoBusca } from '../components/CampoBusca.tsx'
import { EstadoCarregando, EstadoConsulta, EstadoVazio } from '../components/Estado.tsx'
import { ListaRegistros } from '../components/ListaRegistros.tsx'
import type { ObraDisponivel } from '../dados/tipos.ts'
import { useObras, useObrasDisponiveis, useRegistros, useSolicitarAcesso } from '../dados/hooks.ts'
import { useRegistrosLocais } from '../offline/contexto.tsx'
import { useOnline } from '../util/online.ts'
import { normalizarTexto } from '../util/busca.ts'
import { textoPendencias } from '../util/formato.ts'

const MINIMO_PARA_BUSCA = 5

export default function Obras() {
  const obras = useObras()
  const recentes = useRegistros({ limite: 5 })
  const locais = useRegistrosLocais()
  const abertas = useRegistros({ tipo: 'pendencia', situacao: 'aberta' })
  const [busca, setBusca] = useState('')
  const online = useOnline()
  const disponiveis = useObrasDisponiveis()
  const outras = online ? (disponiveis.data ?? []) : []
  // Só afirma que não há obras depois de saber se há outras para pedir acesso.
  const outrasConhecidas = !online || !disponiveis.isPending

  const porObra = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of abertas.data ?? []) m.set(r.obra.id, (m.get(r.obra.id) ?? 0) + 1)
    return m
  }, [abertas.data])

  return (
    <>
      <section aria-labelledby="titulo-obras">
        <h2 id="titulo-obras">Obras</h2>
        <EstadoConsulta consulta={obras}>
          {(lista) => {
            if (lista.length === 0) {
              if (!outrasConhecidas) return <EstadoCarregando />
              if (outras.length > 0) return null
              return (
                <EstadoVazio
                  titulo="Você ainda não tem acesso a nenhuma obra"
                  texto="Entre no grupo da obra no Telegram e abra o app de novo para pedir acesso."
                />
              )
            }
            const termo = normalizarTexto(busca)
            const visiveis = termo
              ? lista.filter((o) => normalizarTexto(o.nome).includes(termo))
              : lista
            return (
              <>
                {lista.length > MINIMO_PARA_BUSCA && (
                  <CampoBusca valor={busca} onMudar={setBusca} rotulo="Buscar obra" placeholder="Buscar obra" />
                )}
                {visiveis.length === 0 ? (
                  <EstadoVazio titulo="Nenhuma obra encontrada" texto="Tente outro nome." />
                ) : (
                  <ul className="lista">
                    {visiveis.map((o) => {
                      const n = porObra.get(o.id) ?? 0
                      return (
                        <li key={o.id}>
                          <Link className="lista-item lista-item-linha" to={`/obras/${o.slug}`}>
                            <span className="lista-titulo">{o.nome}</span>
                            {n > 0 && <span className="selo selo-aberta">{textoPendencias(n)}</span>}
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </>
            )
          }}
        </EstadoConsulta>
      </section>
      {outras.length > 0 && <OutrasObras obras={outras} />}
      <section aria-labelledby="titulo-recentes">
        <h2 id="titulo-recentes">Últimos registros</h2>
        <EstadoConsulta consulta={recentes}>
          {(lista) => <ListaRegistros registros={lista} locais={locais} limite={5} vazio="Nenhum registro ainda" />}
        </EstadoConsulta>
      </section>
    </>
  )
}

function OutrasObras({ obras }: { obras: ObraDisponivel[] }) {
  const solicitar = useSolicitarAcesso()
  return (
    <section aria-labelledby="titulo-outras">
      <h2 id="titulo-outras">Outras obras</h2>
      <ul className="lista">
        {obras.map((o) => (
          <li key={o.id} className="lista-item lista-item-linha">
            <span className="item-texto">
              <span className="lista-titulo">{o.nome}</span>
              {o.solicitacao === 'recusada' && <span className="lista-sub">Pedido recusado</span>}
            </span>
            {o.solicitacao === 'pendente' ? (
              <span className="selo">Aguardando aprovação</span>
            ) : (
              <button
                type="button"
                className="botao"
                disabled={solicitar.isPending}
                aria-label={`${o.solicitacao === 'recusada' ? 'Pedir de novo' : 'Solicitar acesso'}: ${o.nome}`}
                onClick={() => solicitar.mutate(o.id)}
              >
                {o.solicitacao === 'recusada' ? 'Pedir de novo' : 'Solicitar acesso'}
              </button>
            )}
          </li>
        ))}
      </ul>
      {solicitar.isError && (
        <p className="erro-texto" role="alert">
          {solicitar.error instanceof Error ? solicitar.error.message : 'Não foi possível pedir acesso.'}
        </p>
      )}
    </section>
  )
}
