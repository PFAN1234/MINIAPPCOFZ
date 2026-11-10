import { useParams } from 'react-router'
import { EstadoConsulta, EstadoErro, EstadoVazio } from '../components/Estado.tsx'
import { Horario } from '../components/Horario.tsx'
import { useDecidirSolicitacao, useObra, useSolicitacoes } from '../dados/hooks.ts'
import type { ObraDetalhe, SolicitacaoAcesso } from '../dados/tipos.ts'

export default function Acessos() {
  const { slug = '' } = useParams()
  const obra = useObra(slug)
  return (
    <EstadoConsulta consulta={obra}>{(detalhe) => <AcessosCarregados detalhe={detalhe} />}</EstadoConsulta>
  )
}

function AcessosCarregados({ detalhe }: { detalhe: ObraDetalhe }) {
  const { obra, papel } = detalhe
  const gestor = papel === 'gestor'
  const pedidos = useSolicitacoes(obra.id, gestor)
  const decidir = useDecidirSolicitacao()

  function decidirPedido(p: SolicitacaoAcesso, aprovar: boolean) {
    if (!aprovar && !window.confirm(`Recusar o pedido de ${p.nome}?`)) return
    decidir.mutate({ id: p.id, aprovar })
  }

  return (
    <section aria-labelledby="titulo-acessos">
      <h2 id="titulo-acessos" className="titulo-tela">
        Pedidos de acesso
      </h2>
      <p className="subtitulo">{obra.nome}</p>
      {!gestor ? (
        <EstadoVazio titulo="Só gestores da obra veem os pedidos de acesso." />
      ) : (
        <EstadoConsulta consulta={pedidos}>
          {(lista) =>
            lista.length === 0 ? (
              <EstadoVazio titulo="Nenhum pedido de acesso pendente." />
            ) : (
              <ul className="lista">
                {lista.map((p) => (
                  <li key={p.id} className="lista-item acesso-item">
                    <span className="item-texto">
                      <span className="lista-titulo">{p.nome}</span>
                      {p.username && <span className="lista-sub">@{p.username}</span>}
                      <span className="lista-sub">
                        <Horario iso={p.criado_em} />
                      </span>
                    </span>
                    <span className="acesso-botoes">
                      <button
                        type="button"
                        className="botao"
                        disabled={decidir.isPending}
                        aria-label={`Aprovar ${p.nome}`}
                        onClick={() => decidirPedido(p, true)}
                      >
                        Aprovar
                      </button>
                      <button
                        type="button"
                        className="botao botao-secundario"
                        disabled={decidir.isPending}
                        aria-label={`Recusar ${p.nome}`}
                        onClick={() => decidirPedido(p, false)}
                      >
                        Recusar
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )
          }
        </EstadoConsulta>
      )}
      {decidir.isError && (
        <EstadoErro
          mensagem={decidir.error instanceof Error ? decidir.error.message : undefined}
        />
      )}
    </section>
  )
}
