import { Link, useLocation } from 'react-router'
import { ComDados, mensagemDe } from '../componentes.tsx'
import { useExclusoes, useLimparExclusao, useObrasAdmin } from '../dados/hooks.ts'
import { ROTULO_STATUS, type Exclusao, type ObraLista, type StatusObra } from '../dados/tipos.ts'
import type { AvisoObras } from './obra/ArquivarExcluir.tsx'

export function rotuloStatus(status: string | null): string {
  if (status === null) return 'Sem configuração'
  return ROTULO_STATUS[status as StatusObra] ?? status
}

export default function ObrasAdmin() {
  const obras = useObrasAdmin()
  const estado = useLocation().state as AvisoObras | null
  return (
    <section aria-labelledby="titulo-obras">
      <div className="adm-titulo-linha">
        <h1 id="titulo-obras">Obras</h1>
        <Link className="adm-botao adm-botao-principal" to="/nova-obra">
          Nova obra
        </Link>
      </div>
      {estado?.aviso && (
        <p className={`adm-alerta ${estado.tipo === 'ok' ? 'adm-alerta-ok' : 'adm-alerta-aviso'}`} role="status">
          {estado.aviso}
        </p>
      )}
      <ComDados consulta={obras}>
        {(lista) => {
          const ativas = lista.filter((o) => !o.arquivada_em)
          const arquivadas = lista.filter((o) => o.arquivada_em)
          return lista.length === 0 ? (
            <p className="adm-dica">Nenhuma obra cadastrada.</p>
          ) : (
            <>
              <TabelaObras obras={ativas} rotulo="Obras ativas" />
              {arquivadas.length > 0 && (
                <>
                  <h2>Arquivadas ({arquivadas.length})</h2>
                  <p className="adm-dica">Não aparecem no Mini App nem publicam no Telegram. Abra a obra para desarquivar.</p>
                  <TabelaObras obras={arquivadas} rotulo="Obras arquivadas" />
                </>
              )}
            </>
          )
        }}
      </ComDados>
      <Exclusoes />
    </section>
  )
}

function TabelaObras({ obras, rotulo }: { obras: ObraLista[]; rotulo: string }) {
  if (obras.length === 0) return <p className="adm-dica">Nenhuma obra ativa.</p>
  return (
    <table className="adm-tabela" aria-label={rotulo}>
      <thead>
        <tr>
          <th scope="col">Obra</th>
          <th scope="col">Slug</th>
          <th scope="col">Pavimentos</th>
          <th scope="col" className="adm-num">
            Ambientes ativos
          </th>
          <th scope="col">Status</th>
        </tr>
      </thead>
      <tbody>
        {obras.map((o) => (
          <tr key={o.id} className={o.arquivada_em ? 'adm-linha-arquivada' : undefined}>
            <td>
              <Link to={`/obras/${o.slug}`}>{o.nome}</Link>
            </td>
            <td>
              <code>{o.slug}</code>
            </td>
            <td>{o.pavimentos.length ? o.pavimentos.map((p) => p.nome).join(', ') : '—'}</td>
            <td className="adm-num">{o.ambientes_ativos}</td>
            <td>
              {o.arquivada_em ? (
                <span className="adm-selo adm-selo-arquivada">Arquivada</span>
              ) : (
                <span className={`adm-selo adm-selo-${o.status ?? 'vazio'}`}>{rotuloStatus(o.status)}</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function totalArquivos(e: Exclusao): number {
  return Object.values(e.arquivos_removidos ?? {}).reduce((s, v) => s + (v ?? 0), 0)
}

/** Obras excluídas; a limpeza de arquivos que falhou pode ser repetida. */
function Exclusoes() {
  const consulta = useExclusoes()
  const limpar = useLimparExclusao()
  const lista = consulta.data ?? []
  if (lista.length === 0) return null
  return (
    <section className="adm-secao" aria-labelledby="titulo-exclusoes">
      <h2 id="titulo-exclusoes">Obras excluídas</h2>
      <table className="adm-tabela">
        <thead>
          <tr>
            <th scope="col">Obra</th>
            <th scope="col">Quando</th>
            <th scope="col">Por</th>
            <th scope="col">Arquivos</th>
          </tr>
        </thead>
        <tbody>
          {lista.map((e) => (
            <tr key={e.id}>
              <td>
                {e.nome} <code>{e.slug}</code>
              </td>
              <td>{new Date(e.excluida_em).toLocaleString('pt-BR')}</td>
              <td>{e.excluida_por_nome ?? '—'}</td>
              <td>
                {e.arquivos_removidos_em ? (
                  `${totalArquivos(e)} removido(s)`
                ) : (
                  <>
                    <span className="adm-selo adm-selo-revisar" title={e.arquivos_erro ?? undefined}>
                      pendente
                    </span>{' '}
                    <button
                      type="button"
                      className="adm-botao adm-botao-mini"
                      disabled={limpar.isPending}
                      onClick={() => limpar.mutate(e.id)}
                    >
                      Tentar de novo
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {limpar.isError && (
        <p className="adm-alerta adm-alerta-erro" role="alert">
          {mensagemDe(limpar.error)}
        </p>
      )}
      {limpar.data?.pendente && (
        <p className="adm-alerta adm-alerta-aviso" role="status">
          Ainda ficaram arquivos: {limpar.data.erro ?? 'tente de novo mais tarde'}.
        </p>
      )}
    </section>
  )
}
