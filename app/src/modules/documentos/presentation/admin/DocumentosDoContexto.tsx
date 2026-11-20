/**
 * Documentos ligados ao que está em foco na central: o elemento selecionado (um só) e/ou o pavimento da
 * vista de planta ativa. Cada documento abre a prévia (`?doc=`) ou, sem prévia, o painel Documentos.
 * Sem documentos, não mostra nada.
 */
import { useDocumentos } from '../../../../admin/dados/hooks.ts'
import type { RefElemento } from '../../../modelos/domain/central.ts'
import { documentosDoPavimento, documentosVinculados, temPrevia, type Documento } from '../../domain/documentos.ts'

interface Props {
  slug: string
  selecao: RefElemento[]
  /** Pavimento da vista de planta ativa, se houver. */
  pavimento: string | null
  aoAbrirPrevia(doc: Documento): void
  aoAbrirPainel(doc: Documento): void
}

export default function DocumentosDoContexto({ slug, selecao, pavimento, aoAbrirPrevia, aoAbrirPainel }: Props) {
  const consulta = useDocumentos(slug)
  const docs = consulta.data ?? []
  const doElemento = selecao.length === 1 ? documentosVinculados(docs, selecao[0]) : []
  const doPavimento = pavimento ? documentosDoPavimento(docs, pavimento) : []
  const bloco = (titulo: string, lista: Documento[]) =>
    lista.length > 0 && (
      <section aria-label={titulo}>
        <h4>{titulo}</h4>
        <ul className="central-gestao-lista">
          {lista.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                className="central-botao"
                onClick={() => (temPrevia(d) ? aoAbrirPrevia(d) : aoAbrirPainel(d))}
              >
                {d.titulo}
              </button>
              <span className="central-sec">{[d.codigo, d.revisao].filter(Boolean).join(' · ')}</span>
            </li>
          ))}
        </ul>
      </section>
    )
  return (
    <>
      {bloco('Documentos deste elemento', doElemento)}
      {bloco('Documentos deste pavimento', doPavimento)}
    </>
  )
}
