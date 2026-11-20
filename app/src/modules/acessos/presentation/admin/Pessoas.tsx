/**
 * Pessoas (`/pessoas`): quem já abriu o Mini App ou falou no grupo, com o nome de exibição que
 * aparece no boletim (maiúsculas, ex.: "CP PATRICIO"; sem ele vale o nome do Telegram) e o acesso
 * de cada um a cada obra (sem acesso, equipe ou gestor), salvo na hora.
 */
import { useId, useState, type FormEvent } from 'react'
import { Carregando, ComDados, Erro, Resultado } from '../../../../admin/componentes.tsx'
import { useDefinirAcesso, useDefinirNomeExibicao, useMatrizAcessos, useMeuId, usePessoas } from '../../../../admin/dados/hooks.ts'
import { NOME_EXIBICAO_MAX } from '../../../../admin/dados/tipos.ts'
import type { MatrizAcessosAdmin, PapelAcesso, Pessoa } from '@modules/acessos/domain/tipos.ts'

/** Sem acentos e em minúsculas: a busca ignora os dois. */
const simples = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

function casa(p: Pessoa, busca: string): boolean {
  const b = simples(busca.trim().replace(/^@/, ''))
  if (!b) return true
  return [p.nome, p.nome_exibicao ?? '', p.username ?? ''].some((t) => simples(t).includes(b))
}

type PessoaMatriz = MatrizAcessosAdmin['pessoas'][number]
type ObraMatriz = MatrizAcessosAdmin['obras'][number]
type Consulta<T> = {
  data: T | undefined
  isPending: boolean
  error: unknown
  refetch: () => unknown
}

/** Linha da tabela: a pessoa do cadastro (com o nome de exibição) ou, se só estiver na matriz, a da matriz. */
type Linha = {
  pessoa: Pessoa | null
  matriz: PessoaMatriz | null
  id: string
  nome: string
}

function montarLinhas(lista: Pessoa[], matriz: MatrizAcessosAdmin | undefined): Linha[] {
  const porId = new Map(matriz?.pessoas.map((m) => [m.id, m]))
  const linhas: Linha[] = lista.map((p) => ({
    pessoa: p,
    matriz: porId.get(p.id) ?? null,
    id: p.id,
    nome: p.nome,
  }))
  if (matriz) {
    const ids = new Set(lista.map((p) => p.id))
    for (const m of matriz.pessoas) if (!ids.has(m.id)) linhas.push({ pessoa: null, matriz: m, id: m.id, nome: m.nome })
  }
  // Quem tem pedido pendente vem primeiro; o resto mantém a ordem.
  const pedido = (l: Linha) => (l.matriz && l.matriz.pedidos.length > 0 ? 0 : 1)
  return linhas
    .map((l, i) => ({ l, i }))
    .sort((a, b) => pedido(a.l) - pedido(b.l) || a.i - b.i)
    .map((x) => x.l)
}

function casaLinha(l: Linha, busca: string): boolean {
  if (l.pessoa) return casa(l.pessoa, busca)
  const b = simples(busca.trim().replace(/^@/, ''))
  return !b || [l.nome, l.matriz?.username ?? ''].some((t) => simples(t).includes(b))
}

export default function Pessoas() {
  const pessoas = usePessoas()
  const matriz = useMatrizAcessos()
  const meuId = useMeuId().data ?? null
  const idBusca = useId()
  const [busca, setBusca] = useState('')
  return (
    <section aria-labelledby="titulo-pessoas">
      <h1 id="titulo-pessoas">Pessoas</h1>
      <p className="adm-dica">
        Quem já abriu o Mini App ou falou no grupo. Escolha o acesso de cada pessoa a cada obra; o nome de exibição é o
        que sai no boletim e nas observações (em maiúsculas, até {NOME_EXIBICAO_MAX} caracteres); sem ele, vale o nome
        do Telegram.
      </p>
      <ComDados consulta={pessoas}>
        {(lista) => {
          const visiveis = montarLinhas(lista, matriz.data).filter((l) => casaLinha(l, busca))
          return (
            <>
              <div className="adm-campo adm-campo-busca">
                <label htmlFor={idBusca}>Buscar pessoa</label>
                <input
                  id={idBusca}
                  type="search"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Nome, nome de exibição ou @usuário"
                />
              </div>
              {visiveis.length === 0 ? (
                <p className="adm-dica">
                  {lista.length === 0 && !matriz.data?.pessoas.length
                    ? 'Ninguém abriu o Mini App ainda.'
                    : 'Nenhuma pessoa encontrada.'}
                </p>
              ) : (
                <table className="adm-tabela adm-tabela-pessoas" aria-label="Pessoas">
                  <thead>
                    <tr>
                      <th scope="col">Nome de exibição</th>
                      <th scope="col">Telegram</th>
                      {matriz.data ? (
                        matriz.data.obras.map((o) => (
                          <th key={o.id} scope="col">
                            {o.nome}
                          </th>
                        ))
                      ) : (
                        <th scope="col">Acesso às obras</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {visiveis.map((l) => (
                      <LinhaPessoa key={l.id} linha={l} matriz={matriz} meuId={meuId} />
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )
        }}
      </ComDados>
    </section>
  )
}

function LinhaPessoa({
  linha,
  matriz,
  meuId,
}: {
  linha: Linha
  matriz: Consulta<MatrizAcessosAdmin>
  meuId: string | null
}) {
  const { pessoa, matriz: mp } = linha
  return (
    <tr>
      <td>{pessoa ? <NomeExibicao pessoa={pessoa} /> : <span className="adm-dica">sem nome de exibição</span>}</td>
      <td>
        {linha.nome}
        {(pessoa?.username ?? mp?.username) && (
          <span className="adm-dica"> · @{pessoa?.username ?? mp?.username}</span>
        )}{' '}
        {mp?.admin ? (
          <span className="adm-selo">admin do grupo</span>
        ) : (
          pessoa?.eh_admin && <span className="adm-selo">admin</span>
        )}
      </td>
      {matriz.data ? (
        matriz.data.obras.map((o) => (
          <td key={o.id}>
            {mp ? <CelaAcesso obra={o} pessoa={mp} proprio={mp.id === meuId} /> : <span className="adm-dica">-</span>}
          </td>
        ))
      ) : (
        <td>
          {matriz.isPending ? <Carregando /> : <Erro erro={matriz.error} onTentar={() => void matriz.refetch()} />}
        </td>
      )}
    </tr>
  )
}

function CelaAcesso({ obra, pessoa, proprio }: { obra: ObraMatriz; pessoa: PessoaMatriz; proprio: boolean }) {
  const definir = useDefinirAcesso()
  const atual = (pessoa.acessos[obra.id] ?? 'nenhum') as PapelAcesso
  const pediu = atual === 'nenhum' && pessoa.pedidos.includes(obra.id)
  const rotulo = `Acesso de ${pessoa.nome} em ${obra.nome}`
  if (pessoa.admin) {
    return (
      <select
        aria-label={rotulo}
        value="gestor"
        disabled
        title="Administradores do grupo são gestores de todas as obras."
      >
        <option value="gestor">Gestor</option>
      </select>
    )
  }
  // Enquanto grava, mostra a escolha; se der erro, a matriz não mudou e o select volta ao valor anterior.
  const valor = definir.isPending && definir.variables ? definir.variables.papel : pediu ? 'pediu' : atual
  function trocar(papel: PapelAcesso) {
    if (papel === atual) return
    if (proprio && !window.confirm('Alterar o seu próprio acesso?')) return
    definir.mutate({ obraId: obra.id, usuarioId: pessoa.id, papel })
  }
  return (
    <>
      <select
        aria-label={rotulo}
        value={valor}
        disabled={definir.isPending}
        onChange={(e) => trocar(e.target.value as PapelAcesso)}
      >
        {pediu && (
          <option value="pediu" disabled>
            Pediu acesso
          </option>
        )}
        <option value="nenhum">Sem acesso</option>
        <option value="equipe">Equipe</option>
        <option value="gestor">Gestor</option>
      </select>
      <Resultado sucesso={null} erro={definir.error} />
    </>
  )
}

function NomeExibicao({ pessoa }: { pessoa: Pessoa }) {
  const definir = useDefinirNomeExibicao()
  const [valor, setValor] = useState(pessoa.nome_exibicao ?? '')
  const [salvo, setSalvo] = useState<string | null>(null)
  const mudou = valor.trim().replace(/\s+/g, ' ').toUpperCase() !== (pessoa.nome_exibicao ?? '')

  function enviar(e: FormEvent) {
    e.preventDefault()
    setSalvo(null)
    definir.mutate(
      { id: pessoa.id, nome: valor.trim() === '' ? null : valor },
      {
        onSuccess: (r) => {
          setValor(r.nome_exibicao ?? '')
          setSalvo(r.nome_exibicao ? 'Salvo.' : 'Nome de exibição removido.')
        },
      },
    )
  }

  return (
    <>
      <form className="adm-linha-form" onSubmit={enviar}>
        <input
          aria-label={`Nome de exibição de ${pessoa.nome}`}
          // Fica em maiúsculas enquanto digita; o servidor normaliza espaços e maiúsculas de novo.
          value={valor}
          maxLength={NOME_EXIBICAO_MAX}
          onChange={(e) => {
            setValor(e.target.value.toUpperCase())
            setSalvo(null)
            definir.reset()
          }}
          placeholder={pessoa.nome_exibicao ? undefined : 'usa o nome do Telegram'}
        />
        <button
          type="submit"
          className="adm-botao"
          disabled={!mudou || definir.isPending}
          aria-label={`Salvar nome de ${pessoa.nome}`}
        >
          Salvar
        </button>
      </form>
      {!pessoa.nome_exibicao && !valor && <span className="adm-dica">usa o nome do Telegram</span>}
      <Resultado sucesso={salvo} erro={definir.error} />
    </>
  )
}
