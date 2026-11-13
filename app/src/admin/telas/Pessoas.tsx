/**
 * Pessoas (`/pessoas`): quem já abriu o Mini App, com o nome de exibição que aparece no boletim
 * (maiúsculas, ex.: "CP PATRICIO"; sem ele vale o nome do Telegram) e as obras de cada um.
 */
import { useId, useState, type FormEvent } from 'react'
import { ComDados, Resultado } from '../componentes.tsx'
import { useDefinirNomeExibicao, usePessoas } from '../dados/hooks.ts'
import { NOME_EXIBICAO_MAX, type Pessoa } from '../dados/tipos.ts'

/** Sem acentos e em minúsculas: a busca ignora os dois. */
const simples = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

function casa(p: Pessoa, busca: string): boolean {
  const b = simples(busca.trim().replace(/^@/, ''))
  if (!b) return true
  return [p.nome, p.nome_exibicao ?? '', p.username ?? ''].some((t) => simples(t).includes(b))
}

export default function Pessoas() {
  const pessoas = usePessoas()
  const idBusca = useId()
  const [busca, setBusca] = useState('')
  return (
    <section aria-labelledby="titulo-pessoas">
      <h1 id="titulo-pessoas">Pessoas</h1>
      <p className="adm-dica">
        Quem já abriu o Mini App. O nome de exibição é o que sai no boletim e nas observações (em maiúsculas, até{' '}
        {NOME_EXIBICAO_MAX} caracteres); sem ele, vale o nome do Telegram.
      </p>
      <ComDados consulta={pessoas}>
        {(lista) => {
          const visiveis = lista.filter((p) => casa(p, busca))
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
                <p className="adm-dica">{lista.length === 0 ? 'Ninguém abriu o Mini App ainda.' : 'Nenhuma pessoa encontrada.'}</p>
              ) : (
                <table className="adm-tabela adm-tabela-pessoas" aria-label="Pessoas">
                  <thead>
                    <tr>
                      <th scope="col">Nome de exibição</th>
                      <th scope="col">Telegram</th>
                      <th scope="col">Obras</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiveis.map((p) => (
                      <LinhaPessoa key={p.id} pessoa={p} />
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

function LinhaPessoa({ pessoa }: { pessoa: Pessoa }) {
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
    <tr>
      <td>
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
          <button type="submit" className="adm-botao" disabled={!mudou || definir.isPending} aria-label={`Salvar nome de ${pessoa.nome}`}>
            Salvar
          </button>
        </form>
        {!pessoa.nome_exibicao && !valor && <span className="adm-dica">usa o nome do Telegram</span>}
        <Resultado sucesso={salvo} erro={definir.error} />
      </td>
      <td>
        {pessoa.nome}
        {pessoa.username && <span className="adm-dica"> · @{pessoa.username}</span>}{' '}
        {pessoa.eh_admin && <span className="adm-selo">admin</span>}
      </td>
      <td>
        {pessoa.participacoes.length === 0 ? (
          <span className="adm-dica">nenhuma obra</span>
        ) : (
          <ul className="adm-lista-simples">
            {pessoa.participacoes.map((o) => (
              <li key={o.obra_slug}>
                {o.obra_nome} <span className="adm-dica">({o.etapa_nome}) · {o.papel}</span>
              </li>
            ))}
          </ul>
        )}
      </td>
    </tr>
  )
}
