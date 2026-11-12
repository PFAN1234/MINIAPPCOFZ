import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { EstadoConsulta } from '../components/Estado.tsx'
import { ListaRegistros } from '../components/ListaRegistros.tsx'
import { TopoTela } from '../components/TopoTela.tsx'
import { useObras, useRegistros } from '../dados/hooks.ts'
import type { TipoRegistro } from '../dados/tipos.ts'
import { useRegistrosLocais } from '../offline/contexto.tsx'

const PASSO = 50

const TIPOS: { id: TipoRegistro | ''; rotulo: string }[] = [
  { id: '', rotulo: 'Todos' },
  { id: 'servico', rotulo: 'Serviços' },
  { id: 'pendencia', rotulo: 'Pendências' },
]

/** Registros de todas as obras, com filtros de obra e tipo (ficam na URL) e "Carregar mais" de 50 em 50. */
export default function Registros() {
  const [params, setParams] = useSearchParams()
  const obraSlug = params.get('obra') ?? undefined
  const tipoParam = params.get('tipo')
  const tipo: TipoRegistro | undefined =
    tipoParam === 'servico' || tipoParam === 'pendencia' ? tipoParam : undefined
  const [limite, setLimite] = useState(PASSO)
  const obras = useObras()
  const registros = useRegistros({ obraSlug, tipo, limite })
  const locais = useRegistrosLocais({ obraSlug, tipo })

  function mudar(mudancas: Record<string, string | null>) {
    const prox = new URLSearchParams(params)
    for (const [k, v] of Object.entries(mudancas)) {
      if (v === null || v === '') prox.delete(k)
      else prox.set(k, v)
    }
    setParams(prox, { replace: true })
    setLimite(PASSO)
  }

  return (
    <section aria-labelledby="titulo-registros">
      <TopoTela lista titulo="Registros" idTitulo="titulo-registros" />
      <div className="filtros-registros">
        <select
          className="filtro-select"
          aria-label="Filtrar por obra"
          value={obraSlug ?? ''}
          onChange={(e) => mudar({ obra: e.target.value || null })}
        >
          <option value="">Todas as obras</option>
          {(obras.data ?? []).map((o) => (
            <option key={o.id} value={o.slug}>
              {o.nome}
            </option>
          ))}
        </select>
        <fieldset className="tipo-registro filtro-tipo">
          <legend className="sr-only">Tipo de registro</legend>
          <div className="segmentado">
            {TIPOS.map((t) => (
              <label key={t.id || 'todos'}>
                <input
                  type="radio"
                  name="tipo-filtro"
                  value={t.id}
                  checked={(tipo ?? '') === t.id}
                  onChange={() => mudar({ tipo: t.id || null })}
                />
                <span>{t.rotulo}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <EstadoConsulta consulta={registros}>
        {(lista) => (
          <>
            <ListaRegistros registros={lista} locais={locais} vazio="Nenhum registro ainda" />
            {lista.length >= limite && (
              <button
                type="button"
                className="botao botao-secundario botao-bloco"
                onClick={() => setLimite((l) => l + PASSO)}
              >
                Carregar mais
              </button>
            )}
          </>
        )}
      </EstadoConsulta>
    </section>
  )
}
