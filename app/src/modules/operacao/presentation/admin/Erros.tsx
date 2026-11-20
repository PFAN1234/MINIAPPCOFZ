import { Fragment, useState } from 'react'
import { ComDados } from '../../../../admin/componentes.tsx'
import { useErrosCliente, useResumoOrfaos } from './hooks.ts'

function quando(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

function AbaErros() {
  const erros = useErrosCliente()
  const [aberto, setAberto] = useState<number | null>(null)

  return (
    <section aria-labelledby="titulo-erros">
      <h2 id="titulo-erros">Erros do cliente</h2>
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

function tamanhoLegivel(bytes: number | null): string {
  if (bytes == null) return '—'
  const unidades = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < unidades.length - 1) {
    v /= 1024
    i++
  }
  return `${i === 0 ? v : v.toFixed(1).replace('.', ',')} ${unidades[i]}`
}

function AbaOrfaos() {
  const resumo = useResumoOrfaos()
  return (
    <section aria-labelledby="titulo-orfaos">
      <h2 id="titulo-orfaos">Arquivos órfãos</h2>
      <p className="adm-dica">
        Simulação: arquivos dos buckets sem referência no banco há mais de 7 dias, conferidos todo dia às 03:17 (UTC). Nada é
        apagado do armazenamento.
      </p>
      <ComDados consulta={resumo}>
        {(r) =>
          r.buckets.length === 0 ? (
            <p>Nenhum arquivo órfão encontrado.</p>
          ) : (
            <>
              <table className="adm-tabela" aria-label="Resumo por bucket">
                <thead>
                  <tr>
                    <th scope="col">Bucket</th>
                    <th scope="col">Arquivos</th>
                    <th scope="col">Tamanho</th>
                  </tr>
                </thead>
                <tbody>
                  {r.buckets.map((b) => (
                    <tr key={b.bucket}>
                      <td>{b.bucket}</td>
                      <td>{b.quantidade}</td>
                      <td>{tamanhoLegivel(b.bytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <h3>Os {r.maiores.length} maiores</h3>
              <table className="adm-tabela" aria-label="Maiores arquivos órfãos">
                <thead>
                  <tr>
                    <th scope="col">Bucket</th>
                    <th scope="col">Caminho</th>
                    <th scope="col">Tamanho</th>
                    <th scope="col">Enviado em</th>
                  </tr>
                </thead>
                <tbody>
                  {r.maiores.map((m) => (
                    <tr key={`${m.bucket}/${m.caminho}`}>
                      <td>{m.bucket}</td>
                      <td style={{ wordBreak: 'break-all' }}>{m.caminho}</td>
                      <td>{tamanhoLegivel(m.tamanho)}</td>
                      <td>{m.criado_em ? quando(m.criado_em) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )
        }
      </ComDados>
    </section>
  )
}

export default function Erros() {
  const [aba, setAba] = useState<'erros' | 'orfaos'>('erros')
  return (
    <section aria-labelledby="titulo-manutencao">
      <h1 id="titulo-manutencao">Manutenção</h1>
      <div role="tablist" aria-label="Manutenção" style={{ display: 'flex', gap: 8, margin: '8px 0' }}>
        <button
          type="button"
          role="tab"
          id="aba-erros"
          aria-selected={aba === 'erros'}
          className="adm-botao adm-botao-discreto"
          onClick={() => setAba('erros')}
        >
          Erros
        </button>
        <button
          type="button"
          role="tab"
          id="aba-orfaos"
          aria-selected={aba === 'orfaos'}
          className="adm-botao adm-botao-discreto"
          onClick={() => setAba('orfaos')}
        >
          Arquivos órfãos
        </button>
      </div>
      <div role="tabpanel" aria-labelledby={aba === 'erros' ? 'aba-erros' : 'aba-orfaos'}>
        {aba === 'erros' ? <AbaErros /> : <AbaOrfaos />}
      </div>
    </section>
  )
}
