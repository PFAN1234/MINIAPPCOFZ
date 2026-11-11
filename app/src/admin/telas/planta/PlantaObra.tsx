/** Pavimentos da obra com a planta publicada (`/admin/obras/<slug>/planta`) e o histórico de publicações. */
import { Link, useParams } from 'react-router'
import { ComDados } from '../../componentes.tsx'
import { useEditorPlanta, usePublicacoes } from '../../dados/hooks.ts'
import type { Publicacao } from '../../dados/tipos.ts'

export default function PlantaObra() {
  const { slug = '' } = useParams()
  const consulta = useEditorPlanta(slug)
  return (
    <ComDados consulta={consulta}>
      {(d) => (
        <article aria-labelledby="titulo-planta-obra">
          <p>
            <Link to={`/obras/${slug}`}>← {d.obra.nome}</Link>
          </p>
          <h1 id="titulo-planta-obra">Planta · {d.obra.nome}</h1>
          <p className="adm-dica">Escolha o pavimento para enviar o PDF, ajustar e publicar a planta.</p>
          {d.pavimentos.length === 0 ? (
            <p className="adm-alerta adm-alerta-info">Cadastre os pavimentos na página da obra antes de enviar a planta.</p>
          ) : (
            <table className="adm-tabela">
              <thead>
                <tr>
                  <th scope="col">Pavimento</th>
                  <th scope="col">Planta publicada</th>
                  <th scope="col" className="adm-num">
                    Ambientes ativos
                  </th>
                  <th scope="col">Último PDF</th>
                  <th scope="col">
                    <span className="adm-oculto">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.pavimentos.map((p) => (
                  <tr key={p.codigo}>
                    <td>{p.nome}</td>
                    <td>{p.planta ? `revisão ${p.planta.revisao}` : '—'}</td>
                    <td className="adm-num">{d.ambientes.filter((a) => a.pavimento === p.codigo && a.ativo).length}</td>
                    <td>{p.ultimo_pdf ? `${p.ultimo_pdf.nome ?? 'PDF'} (${p.ultimo_pdf.revisao})` : '—'}</td>
                    <td>
                      <Link className="adm-botao" to={`/obras/${slug}/planta/${p.codigo}`}>
                        Editar planta de {p.nome}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Historico slug={slug} />
        </article>
      )}
    </ComDados>
  )
}

function contagem(resumo: Record<string, unknown>, campo: string): number {
  const dif = resumo.diferencas as Record<string, unknown[]> | undefined
  return Array.isArray(dif?.[campo]) ? dif![campo].length : 0
}

/** Histórico das publicações de planta da obra (mais recente primeiro). */
export function Historico({ slug }: { slug: string }) {
  const consulta = usePublicacoes(slug)
  return (
    <section className="adm-secao" aria-labelledby="titulo-historico">
      <h2 id="titulo-historico">Publicações da planta</h2>
      <ComDados consulta={consulta}>
        {(lista: Publicacao[]) =>
          lista.length === 0 ? (
            <p className="adm-dica">Nenhuma publicação pelo site ainda (as plantas atuais vieram dos scripts).</p>
          ) : (
            <table className="adm-tabela">
              <thead>
                <tr>
                  <th scope="col">Quando</th>
                  <th scope="col">Pavimento</th>
                  <th scope="col">Revisão</th>
                  <th scope="col">Por</th>
                  <th scope="col">PDF</th>
                  <th scope="col" className="adm-num">
                    Ambientes
                  </th>
                  <th scope="col">Diferenças</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((p) => (
                  <tr key={p.id}>
                    <td>{new Date(p.publicado_em).toLocaleString('pt-BR')}</td>
                    <td>{p.pavimento_nome}</td>
                    <td>{p.revisao}</td>
                    <td>{p.publicado_por_nome ?? '—'}</td>
                    <td title={p.pdf_sha256}>
                      {p.pdf_nome ?? 'PDF'} (p. {p.pagina})
                    </td>
                    <td className="adm-num">{String(p.resumo.ambientes ?? '—')}</td>
                    <td>
                      {contagem(p.resumo, 'novos')} novo(s), {contagem(p.resumo, 'removidos')} removido(s),{' '}
                      {contagem(p.resumo, 'herdados')} mantido(s)
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </ComDados>
    </section>
  )
}
