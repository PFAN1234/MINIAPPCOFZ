import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Aviso } from '../components/Aviso.tsx'
import { EstadoConsulta } from '../components/Estado.tsx'
import { ListaRegistros } from '../components/ListaRegistros.tsx'
import { TopoTela } from '../components/TopoTela.tsx'
import { useAvisoDaRota } from '../components/useAvisoDaRota.ts'
import { useAutoresRegistros, useObras, useRegistros } from '../dados/hooks.ts'
import type { FiltroRegistros } from '../dados/tipos.ts'
import { useRegistrosLocais } from '../offline/contexto.tsx'
import { etapasDasObras } from '../util/etapas.ts'

const PASSO = 50

type TipoFiltro = '' | 'servico' | 'abertas' | 'resolvidas'

const TIPOS: { id: TipoFiltro; rotulo: string }[] = [
  { id: '', rotulo: 'Todos' },
  { id: 'servico', rotulo: 'Serviços' },
  { id: 'abertas', rotulo: 'Abertas' },
  { id: 'resolvidas', rotulo: 'Resolvidas' },
]

const DATA = /^\d{4}-\d{2}-\d{2}$/

function tipoDaUrl(valor: string | null): TipoFiltro {
  return valor === 'servico' || valor === 'abertas' || valor === 'resolvidas' ? valor : ''
}

/**
 * Registros de todas as obras, com filtros de etapa, obra, tipo, pessoa e período (todos na URL)
 * e "Carregar mais" de 50 em 50.
 */
export default function Registros() {
  const [params, setParams] = useSearchParams()
  const { aviso, fecharAviso } = useAvisoDaRota()
  const etapaId = params.get('etapa') || undefined
  const obraSlug = params.get('obra') || undefined
  const tipoUrl = tipoDaUrl(params.get('tipo'))
  const autorId = params.get('pessoa') || undefined
  const de = DATA.test(params.get('de') ?? '') ? (params.get('de') as string) : undefined
  const ate = DATA.test(params.get('ate') ?? '') ? (params.get('ate') as string) : undefined
  const [limite, setLimite] = useState(PASSO)
  const obras = useObras()
  const autores = useAutoresRegistros()

  const etapas = useMemo(() => etapasDasObras(obras.data ?? [], []), [obras.data])
  const obrasDaEtapa = useMemo(
    () => (obras.data ?? []).filter((o) => !etapaId || o.etapa?.id === etapaId),
    [obras.data, etapaId],
  )
  const obraIdsDaEtapa = useMemo(
    () => (etapaId ? obrasDaEtapa.map((o) => o.id) : undefined),
    [etapaId, obrasDaEtapa],
  )

  const tipo = tipoUrl === 'servico' ? 'servico' : tipoUrl ? 'pendencia' : undefined
  const situacao = tipoUrl === 'abertas' ? 'aberta' : tipoUrl === 'resolvidas' ? 'resolvida' : undefined
  const filtro: FiltroRegistros = { obraSlug, tipo, situacao, etapaId, autorId, de, ate, limite }
  const registros = useRegistros(filtro)
  const locais = useRegistrosLocais({ obraSlug, tipo, situacao, obraIds: obraIdsDaEtapa, autorId, de, ate })

  const ativo = Boolean(etapaId || obraSlug || tipoUrl || autorId || de || ate)

  function mudar(mudancas: Record<string, string | null>) {
    const prox = new URLSearchParams(params)
    for (const [k, v] of Object.entries(mudancas)) {
      if (v === null || v === '') prox.delete(k)
      else prox.set(k, v)
    }
    setParams(prox, { replace: true })
    setLimite(PASSO)
  }

  function mudarEtapa(id: string) {
    const obraAtual = (obras.data ?? []).find((o) => o.slug === obraSlug)
    const limpaObra = Boolean(id && obraAtual && obraAtual.etapa?.id !== id)
    mudar({ etapa: id || null, ...(limpaObra ? { obra: null } : {}) })
  }

  return (
    <section aria-labelledby="titulo-registros">
      <TopoTela titulo="Registros" idTitulo="titulo-registros" />
      {aviso && <Aviso texto={aviso} onFechar={fecharAviso} />}
      <div className="filtros-registros">
        <div className="filtros-linha">
          <select
            className="filtro-select"
            aria-label="Filtrar por etapa"
            value={etapaId ?? ''}
            onChange={(e) => mudarEtapa(e.target.value)}
          >
            <option value="">Todas as etapas</option>
            {etapas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome}
              </option>
            ))}
          </select>
          <select
            className="filtro-select"
            aria-label="Filtrar por obra"
            value={obraSlug ?? ''}
            onChange={(e) => mudar({ obra: e.target.value || null })}
          >
            <option value="">Todas as obras</option>
            {obrasDaEtapa.map((o) => (
              <option key={o.id} value={o.slug}>
                {o.nome}
              </option>
            ))}
          </select>
        </div>
        <fieldset className="tipo-registro filtro-tipo">
          <legend className="sr-only">Tipo de registro</legend>
          <div className="segmentado">
            {TIPOS.map((t) => (
              <label key={t.id || 'todos'}>
                <input
                  type="radio"
                  name="tipo-filtro"
                  value={t.id}
                  checked={tipoUrl === t.id}
                  onChange={() => mudar({ tipo: t.id || null })}
                />
                <span>{t.rotulo}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <select
          className="filtro-select"
          aria-label="Filtrar por pessoa"
          value={autorId ?? ''}
          onChange={(e) => mudar({ pessoa: e.target.value || null })}
        >
          <option value="">Todas as pessoas</option>
          {(autores.data ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.nome}
            </option>
          ))}
        </select>
        <div className="filtros-linha">
          <label className="filtro-data">
            <span>De</span>
            <input
              type="date"
              value={de ?? ''}
              max={ate}
              onChange={(e) => mudar({ de: e.target.value || null })}
            />
          </label>
          <label className="filtro-data">
            <span>Até</span>
            <input
              type="date"
              value={ate ?? ''}
              min={de}
              onChange={(e) => mudar({ ate: e.target.value || null })}
            />
          </label>
        </div>
        {ativo && (
          <button
            type="button"
            className="botao botao-secundario botao-bloco"
            onClick={() => {
              setParams(new URLSearchParams(), { replace: true })
              setLimite(PASSO)
            }}
          >
            Limpar filtros
          </button>
        )}
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
