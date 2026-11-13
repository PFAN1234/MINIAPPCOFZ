/**
 * Aba "Relatórios" (rota `/boletins`; por ora só o boletim diário): pedidos não emitidos e boletins emitidos de todas as etapas (ou de uma, com
 * `?etapa=<slug>`), por período (padrão: últimos 30 dias). Com uma etapa escolhida, também o bloco
 * Pré-visualizar / Emitir agora. Contrato: docs/contrato-boletim.md, partes 3 e 4.
 */
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { ComDados } from '../../componentes.tsx'
import { useEtapa, useEtapas, useTodosBoletins } from '../../dados/hooks.ts'
import type { EtapaLista } from '../../dados/tipos.ts'
import { hojeNoFuso, somarDiasIso } from '../../formato.ts'
import EmitirOuPreverDaEtapa from './EmitirOuPrever.tsx'
import { Emitidos, Pedidos } from './Tabelas.tsx'

const FUSO_PADRAO = 'America/Fortaleza'
const DIAS_PADRAO = 30

export default function Boletins() {
  const [params, setParams] = useSearchParams()
  const slug = params.get('etapa') ?? ''
  const etapas = useEtapas()
  const hoje = hojeNoFuso(FUSO_PADRAO)
  const [de, setDe] = useState(() => somarDiasIso(hoje, -DIAS_PADRAO))
  const [ate, setAte] = useState(hoje)

  function escolherEtapa(novo: string) {
    const p = new URLSearchParams(params)
    if (novo) p.set('etapa', novo)
    else p.delete('etapa')
    setParams(p, { replace: true })
  }

  return (
    <section aria-labelledby="titulo-boletins">
      <h1 id="titulo-boletins">Relatórios</h1>
      <h2 className="adm-subtitulo">Boletim de acompanhamento diário</h2>
      <ComDados consulta={etapas}>
        {(lista) => {
          const etapa = slug ? lista.find((e) => e.slug === slug) : undefined
          return (
            <>
              <div className="adm-filtros">
                <div className="adm-campo-form">
                  <label htmlFor="filtro-etapa">Etapa</label>
                  <select id="filtro-etapa" value={slug} onChange={(e) => escolherEtapa(e.target.value)}>
                    <option value="">Todas</option>
                    {lista.map((e) => (
                      <option key={e.slug} value={e.slug}>
                        {e.nome}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="adm-campo-form">
                  <label htmlFor="filtro-de">De</label>
                  <input id="filtro-de" type="date" value={de} max={ate || undefined} onChange={(e) => setDe(e.target.value)} />
                </div>
                <div className="adm-campo-form">
                  <label htmlFor="filtro-ate">Até</label>
                  <input id="filtro-ate" type="date" value={ate} min={de || undefined} onChange={(e) => setAte(e.target.value)} />
                </div>
              </div>
              {slug && !etapa ? (
                <p className="adm-alerta adm-alerta-erro" role="alert">
                  Etapa não encontrada.
                </p>
              ) : (
                <>
                  {etapa && <BlocoEmitir etapa={etapa} />}
                  <Listas slug={slug} de={de} ate={ate} />
                </>
              )}
            </>
          )
        }}
      </ComDados>
    </section>
  )
}

function BlocoEmitir({ etapa }: { etapa: EtapaLista }) {
  const detalhe = useEtapa(etapa.slug)
  return (
    <ComDados consulta={detalhe}>
      {(d) => <EmitirOuPreverDaEtapa etapa={d} telegramVinculado={etapa.telegram_vinculado} />}
    </ComDados>
  )
}

function Listas({ slug, de, ate }: { slug: string; de: string; ate: string }) {
  const consulta = useTodosBoletins({ etapa: slug || undefined, de: de || undefined, ate: ate || undefined })
  return (
    <ComDados consulta={consulta}>
      {(d) => (
        <>
          <Pedidos pedidos={d.pedidos} />
          <Emitidos boletins={d.boletins} />
        </>
      )}
    </ComDados>
  )
}
