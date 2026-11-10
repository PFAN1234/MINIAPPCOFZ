import { EstadoConsulta, EstadoErro, EstadoVazio } from './Estado.tsx'
import { Horario } from './Horario.tsx'
import { useDecidirSolicitacao, useSolicitacoes } from '../dados/hooks.ts'
import type { SolicitacaoAcesso } from '../dados/tipos.ts'

/** Pedidos de acesso pendentes da obra, com "Aprovar" e "Recusar". Só para gestores. */
export function PedidosAcesso({ obraId }: { obraId: string }) {
  const pedidos = useSolicitacoes(obraId)
  const decidir = useDecidirSolicitacao()

  function decidirPedido(p: SolicitacaoAcesso, aprovar: boolean) {
    if (!aprovar && !window.confirm(`Recusar o pedido de ${p.nome}?`)) return
    decidir.mutate({ id: p.id, aprovar })
  }

  return (
    <>
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
      {decidir.isError && (
        <EstadoErro
          mensagem={decidir.error instanceof Error ? decidir.error.message : undefined}
        />
      )}
    </>
  )
}
