import { useState } from 'react'
import { ComDados, Resultado } from '../componentes.tsx'
import { useAdmins, useIncluirAdmin, useRemoverAdmin, useUsuarios } from '../dados/hooks.ts'
import type { UsuarioApp } from '../dados/tipos.ts'

function rotuloUsuario(u: { nome: string; username: string | null; telegram_id: number }): string {
  return `${u.nome}${u.username ? ` (@${u.username})` : ''} · ${u.telegram_id}`
}

export default function Admins() {
  const admins = useAdmins()
  const remover = useRemoverAdmin()
  const [confirmando, setConfirmando] = useState<string | null>(null)
  const [sucesso, setSucesso] = useState<string | null>(null)

  return (
    <section aria-labelledby="titulo-admins">
      <h1 id="titulo-admins">Admins</h1>
      <p className="adm-dica">
        Admins do Mini App criam e editam todas as obras e incluem ou removem outros admins. O último admin não pode
        ser removido.
      </p>
      <ComDados consulta={admins}>
        {(lista) => (
          <table className="adm-tabela">
            <thead>
              <tr>
                <th scope="col">Nome</th>
                <th scope="col">Telegram</th>
                <th scope="col">Desde</th>
                <th scope="col">
                  <span className="adm-oculto">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lista.map((a) => (
                <tr key={a.usuario_id}>
                  <td>{a.nome}</td>
                  <td>
                    {a.username ? `@${a.username} · ` : ''}
                    {a.telegram_id}
                  </td>
                  <td>
                    {new Date(a.criado_em).toLocaleDateString('pt-BR')}
                    {a.criado_por_nome ? ` por ${a.criado_por_nome}` : ''}
                  </td>
                  <td className="adm-acoes">
                    {confirmando === a.usuario_id ? (
                      <>
                        <button
                          type="button"
                          className="adm-botao adm-botao-perigo"
                          disabled={remover.isPending}
                          onClick={() =>
                            remover.mutate(a.usuario_id, {
                              onSuccess: () => {
                                setConfirmando(null)
                                setSucesso(`${a.nome} não é mais admin.`)
                              },
                            })
                          }
                        >
                          Confirmar remoção de {a.nome}
                        </button>
                        <button type="button" className="adm-botao" onClick={() => setConfirmando(null)}>
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="adm-botao adm-botao-discreto"
                        aria-label={`Remover ${a.nome}`}
                        onClick={() => {
                          remover.reset()
                          setSucesso(null)
                          setConfirmando(a.usuario_id)
                        }}
                      >
                        Remover
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ComDados>
      <Resultado sucesso={sucesso} erro={remover.error} />
      <IncluirAdmin />
    </section>
  )
}

function IncluirAdmin() {
  const usuarios = useUsuarios()
  const incluir = useIncluirAdmin()
  const [escolhido, setEscolhido] = useState('')
  const [sucesso, setSucesso] = useState<string | null>(null)

  return (
    <section className="adm-secao" aria-labelledby="titulo-incluir">
      <h2 id="titulo-incluir">Incluir admin</h2>
      <p className="adm-dica">A pessoa precisa ter aberto o Mini App ao menos uma vez para aparecer na lista.</p>
      <ComDados consulta={usuarios}>
        {(lista: UsuarioApp[]) => {
          const candidatos = lista.filter((u) => !u.eh_admin)
          if (candidatos.length === 0) return <p className="adm-dica">Todos os usuários já são admins.</p>
          return (
            <div className="adm-acoes">
              <label className="adm-campo">
                Usuário
                <select value={escolhido} onChange={(e) => setEscolhido(e.target.value)}>
                  <option value="">Escolha um usuário…</option>
                  {candidatos.map((u) => (
                    <option key={u.id} value={u.id}>
                      {rotuloUsuario(u)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="adm-botao adm-botao-principal"
                disabled={!escolhido || incluir.isPending}
                onClick={() => {
                  const nome = candidatos.find((u) => u.id === escolhido)?.nome ?? ''
                  setSucesso(null)
                  incluir.mutate(escolhido, {
                    onSuccess: () => {
                      setEscolhido('')
                      setSucesso(`${nome} agora é admin.`)
                    },
                  })
                }}
              >
                Incluir admin
              </button>
            </div>
          )
        }}
      </ComDados>
      <Resultado sucesso={sucesso} erro={incluir.error} />
    </section>
  )
}
