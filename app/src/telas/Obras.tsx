import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { CampoBusca } from '../components/CampoBusca.tsx'
import { EstadoConsulta, EstadoVazio } from '../components/Estado.tsx'
import { ListaRegistros } from '../components/ListaRegistros.tsx'
import { useObras, useRegistros } from '../dados/hooks.ts'
import { useRegistrosLocais } from '../offline/contexto.tsx'
import { normalizarTexto } from '../util/busca.ts'
import { textoPendencias } from '../util/formato.ts'

const MINIMO_PARA_BUSCA = 5

export default function Obras() {
  const obras = useObras()
  const recentes = useRegistros({ limite: 5 })
  const locais = useRegistrosLocais()
  const abertas = useRegistros({ tipo: 'pendencia', situacao: 'aberta' })
  const [busca, setBusca] = useState('')

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
              return (
                <EstadoVazio
                  titulo="Nenhuma obra por aqui ainda"
                  texto="A lista das obras que você pode acessar aparecerá aqui."
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
      <section aria-labelledby="titulo-recentes">
        <h2 id="titulo-recentes">Últimos registros</h2>
        <EstadoConsulta consulta={recentes}>
          {(lista) => <ListaRegistros registros={lista} locais={locais} limite={5} vazio="Nenhum registro ainda" />}
        </EstadoConsulta>
      </section>
    </>
  )
}
