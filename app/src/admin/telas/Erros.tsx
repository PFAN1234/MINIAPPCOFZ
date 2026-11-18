import { Fragment, useState } from 'react'
import { ComDados } from '../componentes.tsx'
import { useErrosCliente } from '../dados/hooks.ts'

function quando(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

export default function Erros() {
  const erros = useErrosCliente()
  const [aberto, setAberto] = useState<number | null>(null)

  return (
    <section aria-labelledby="titulo-erros">
      <h1 id="titulo-erros">Erros do cliente</h1>
      <p className="adm-dica">
        Erros do Mini App e deste site, dos últimos 90 dias (os 200 mais recentes). Clique numa linha para ver a pilha.
      </p>
      <ComDados consulta={erros}>
        {(lista) =>
          lista.length === 0 ? (
            <p>Nenhum erro registrado.</p>
          ) : (
            <table className="adm-tabela">
              <thead>
                <tr>
                  <th scope="col">Quando</th>
                  <th scope="col">App</th>
                  <th scope="col">Versão</th>
                  <th scope="col">Rota</th>
                  <th scope="col">Usuário</th>
                  <th scope="col">Mensagem</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((e) => (
                  <Fragment key={e.id}>
                    <tr>
                      <td>{quando(e.criado_em)}</td>
                      <td>{e.app === 'admin' ? 'Admin' : 'Mini App'}</td>
                      <td>{e.versao ?? '—'}</td>
                      <td>{e.rota ?? '—'}</td>
                      <td>{e.usuario_nome ?? '—'}</td>
                      <td>
                        <button
                          type="button"
                          className="adm-botao adm-botao-discreto"
                          aria-expanded={aberto === e.id}
                          onClick={() => setAberto(aberto === e.id ? null : e.id)}
                        >
                          {e.mensagem}
                        </button>
                      </td>
                    </tr>
                    {aberto === e.id && (
                      <tr>
                        <td colSpan={6}>
                          <pre className="adm-pilha" style={{ whiteSpace: 'pre-wrap', overflowX: 'auto' }}>
                            {e.pilha ?? 'Sem pilha.'}
                            {e.contexto ? `\n\n${JSON.stringify(e.contexto, null, 2)}` : ''}
                            {e.agente ? `\n\n${e.agente}` : ''}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )
        }
      </ComDados>
    </section>
  )
}
