import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { Carregando, Erro } from '../../../../../admin/componentes.tsx'
import { useRepositorioAdmin } from '../../../../../admin/dados/contexto.tsx'
import type { ObraCentral } from '../../../domain/tipos.ts'

export const CHAVE_OBRAS_CENTRAL = ['admin', 'central', 'obras'] as const

export function useObrasCentral() {
  const repo = useRepositorioAdmin()
  return useQuery({ queryKey: CHAVE_OBRAS_CENTRAL, queryFn: () => repo.listarObrasCentral() })
}

const semArquivos = (o: ObraCentral) => o.disciplinas === 0 && o.documentos === 0 && o.issues_abertas === 0

function dataCurta(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pt-BR')
}

/** Lista de obras da Central de modelos. */
export default function CentralModelos() {
  const obras = useObrasCentral()
  const [busca, setBusca] = useState('')

  if (obras.isPending) return <Carregando texto="Carregando as obras…" />
  if (obras.isError) return <Erro erro={obras.error} onTentar={() => void obras.refetch()} />

  const termo = busca.trim().toLowerCase()
  const filtradas = obras.data.filter((o) => o.nome.toLowerCase().includes(termo))
  const comArquivos = filtradas.filter((o) => !semArquivos(o))
  const vazias = filtradas.filter(semArquivos)

  return (
    <section className="central-lista">
      <h1>Modelos</h1>
      <input
        type="search"
        className="adm-campo"
        placeholder="Buscar obra pelo nome"
        aria-label="Buscar obra"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
      />
      {filtradas.length === 0 && <p>Nenhuma obra encontrada.</p>}
      <ul className="central-cards">
        {comArquivos.map((o) => (
          <li key={o.obra_id} className="central-card">
            <Link to={`/modelos/${o.slug}`}>
              <strong>{o.nome}</strong>
            </Link>
            <dl>
              <div>
                <dt>Disciplinas</dt>
                <dd>{o.disciplinas}</dd>
              </div>
              <div>
                <dt>Documentos</dt>
                <dd>{o.documentos}</dd>
              </div>
              <div>
                <dt>Issues abertas</dt>
                <dd>{o.issues_abertas}</dd>
              </div>
              <div>
                <dt>Atualizado em</dt>
                <dd>{dataCurta(o.atualizado_em)}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
      {vazias.length > 0 && (
        <details className="central-vazias">
          <summary>Sem arquivos ({vazias.length})</summary>
          <ul>
            {vazias.map((o) => (
              <li key={o.obra_id}>
                <span>{o.nome}</span>
                <Link to={`/modelos/${o.slug}?painel=gestao`}>Enviar primeiro modelo</Link>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
