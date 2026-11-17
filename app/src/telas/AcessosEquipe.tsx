import { useState } from 'react'
import { CampoBusca } from '../components/CampoBusca.tsx'
import { EstadoCarregando, EstadoErro, EstadoVazio } from '../components/Estado.tsx'
import { TopoTela } from '../components/TopoTela.tsx'
import { ErroEnvio } from '../dados/erros.ts'
import { useDefinirAcesso, useMatrizAcessos } from '../dados/hooks.ts'
import type { MatrizAcessos, PapelAcesso, PessoaAcesso } from '../dados/tipos.ts'
import { useUsuarioId } from '../offline/contexto.tsx'
import { normalizarTexto } from '../util/busca.ts'
import { useOnline } from '../util/online.ts'

const MINIMO_PARA_BUSCA = 6
const DICA_ADMIN = 'Administradores do grupo são gestores de todas as obras.'
const OPCOES: { papel: PapelAcesso; rotulo: string }[] = [
  { papel: 'nenhum', rotulo: 'Sem acesso' },
  { papel: 'equipe', rotulo: 'Equipe' },
  { papel: 'gestor', rotulo: 'Gestor' },
]

function mensagemDe(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'Não foi possível concluir a ação.'
}

/** Lista de pessoas x obras: o gestor libera o acesso de qualquer pessoa a qualquer obra. */
export default function AcessosEquipe() {
  const matriz = useMatrizAcessos()
  const online = useOnline()
  return (
    <section aria-labelledby="titulo-acessos-equipe">
      <TopoTela titulo="Controle de acesso" idTitulo="titulo-acessos-equipe" />
      <p className="lista-sub">
        Marque o acesso de cada pessoa às obras. A lista mostra quem já abriu o app ou falou no grupo.
      </p>
      {!online && (
        <p className="lista-sub" role="status">
          Sem conexão. Os acessos só podem ser alterados online.
        </p>
      )}
      {matriz.isPending ? (
        <EstadoCarregando />
      ) : matriz.isError ? (
        matriz.error instanceof ErroEnvio && matriz.error.tipo === 'permissao' ? (
          <EstadoVazio titulo="Só gestores veem a lista de acessos." />
        ) : (
          <EstadoErro mensagem={mensagemDe(matriz.error)} onTentarDeNovo={() => void matriz.refetch()} />
        )
      ) : (
        <Lista matriz={matriz.data} online={online} />
      )}
    </section>
  )
}

function Lista({ matriz, online }: { matriz: MatrizAcessos; online: boolean }) {
  const [busca, setBusca] = useState('')
  const eu = useUsuarioId()
  if (matriz.pessoas.length === 0) {
    return (
      <EstadoVazio titulo="Ninguém do grupo apareceu ainda. As pessoas aparecem aqui depois de abrir o app ou mandar uma mensagem no grupo." />
    )
  }
  const termo = normalizarTexto(busca)
  const visiveis = termo
    ? matriz.pessoas.filter((p) => normalizarTexto(`${p.nome} ${p.username ?? ''}`).includes(termo))
    : matriz.pessoas
  return (
    <>
      {matriz.pessoas.length > MINIMO_PARA_BUSCA && (
        <CampoBusca valor={busca} onMudar={setBusca} rotulo="Buscar pessoa" placeholder="Buscar por nome ou @username" />
      )}
      {visiveis.length === 0 ? (
        <EstadoVazio titulo="Nenhuma pessoa encontrada" texto="Tente outro nome." />
      ) : (
        <ul className="lista">
          {visiveis.map((p) => (
            <CartaoPessoa key={p.id} pessoa={p} obras={matriz.obras} souEu={p.id === eu} online={online} />
          ))}
        </ul>
      )}
    </>
  )
}

function CartaoPessoa({
  pessoa,
  obras,
  souEu,
  online,
}: {
  pessoa: PessoaAcesso
  obras: MatrizAcessos['obras']
  souEu: boolean
  online: boolean
}) {
  const definir = useDefinirAcesso()
  const [erro, setErro] = useState<string | null>(null)
  // Linha em salvamento: mostra a opção escolhida até a resposta; em erro volta ao valor anterior.
  const [salvando, setSalvando] = useState<{ obraId: string; papel: PapelAcesso } | null>(null)

  async function escolher(obraId: string, papel: PapelAcesso) {
    setErro(null)
    if (souEu && !window.confirm('Alterar o seu próprio acesso?')) return
    setSalvando({ obraId, papel })
    try {
      await definir.mutateAsync({ obraId, usuarioId: pessoa.id, papel })
    } catch (e) {
      setErro(mensagemDe(e))
    } finally {
      setSalvando(null)
    }
  }

  return (
    <li className="lista-item acesso-cartao">
      <span className="registro-topo">
        <span className="lista-titulo">{pessoa.nome}</span>
        {pessoa.username && <span className="lista-sub">@{pessoa.username}</span>}
        {pessoa.admin && <span className="selo">Admin do grupo</span>}
        {pessoa.pedidos.length > 0 && <span className="selo">Pediu acesso</span>}
      </span>
      {obras.map((o) => {
        const atual: PapelAcesso = pessoa.admin ? 'gestor' : (pessoa.acessos[o.id] ?? 'nenhum')
        // Pedido pendente sem acesso: nenhum botão marcado.
        const pediu = !pessoa.admin && pessoa.pedidos.includes(o.id) && !pessoa.acessos[o.id]
        const valor = salvando?.obraId === o.id ? salvando.papel : pediu ? null : atual
        const travado = definir.isPending || !online || pessoa.admin
        return (
          <div key={o.id} className="acesso-linha">
            <span className="acesso-obra">
              {o.nome}
              {pessoa.pedidos.includes(o.id) && <span className="lista-sub"> pediu</span>}
            </span>
            <div role="group" aria-label={`Acesso de ${pessoa.nome} em ${o.nome}`} className="acesso-seletor">
              {OPCOES.map(({ papel, rotulo }) => (
                <button
                  key={papel}
                  type="button"
                  className="acesso-opcao"
                  aria-pressed={valor === papel}
                  disabled={travado}
                  onClick={() => {
                    if (papel !== atual || pediu) void escolher(o.id, papel)
                  }}
                >
                  {rotulo}
                </button>
              ))}
            </div>
          </div>
        )
      })}
      {pessoa.admin && <p className="lista-sub">{DICA_ADMIN}</p>}
      {erro && (
        <p className="form-erro" role="alert">
          {erro}
        </p>
      )}
    </li>
  )
}
