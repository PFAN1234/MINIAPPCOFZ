/**
 * Tela inicial do site (`/`): as etapas ativas, cada uma com a tabela das obras dela; as obras
 * arquivadas (de etapas ativas) e as etapas arquivadas em seções próprias; e as obras excluídas.
 */
import { Link, useLocation } from 'react-router'
import { ComDados, mensagemDe } from '../componentes.tsx'
import { useEtapas, useExclusoes, useLimparExclusao, useObrasAdmin } from '../dados/hooks.ts'
import { ROTULO_STATUS, type EtapaLista, type Exclusao, type ObraLista, type StatusObra } from '../dados/tipos.ts'
import type { AvisoObras } from './obra/ArquivarExcluir.tsx'

export function rotuloStatus(status: string | null): string {
  if (status === null) return 'Sem configuração'
  return ROTULO_STATUS[status as StatusObra] ?? status
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

/** Texto curto do grupo do Telegram da etapa. */
export function rotuloGrupo(e: Pick<EtapaLista, 'telegram_vinculado' | 'telegram_chat_titulo'>): string {
  if (!e.telegram_vinculado) return 'Grupo do Telegram não vinculado'
  return e.telegram_chat_titulo ? `Grupo do Telegram: ${e.telegram_chat_titulo}` : 'Grupo do Telegram vinculado'
}

export default function ObrasAdmin() {
  const etapas = useEtapas()
  const obras = useObrasAdmin()
  const estado = useLocation().state as AvisoObras | null
  return (
    <section aria-labelledby="titulo-etapas">
      <div className="adm-titulo-linha">
        <h1 id="titulo-etapas">Etapas</h1>
        <Link className="adm-botao adm-botao-principal" to="/nova-etapa">
          Nova etapa
        </Link>
      </div>
      {estado?.aviso && (
        <p className={`adm-alerta ${estado.tipo === 'ok' ? 'adm-alerta-ok' : 'adm-alerta-aviso'}`} role="status">
          {estado.aviso}
        </p>
      )}
      <ComDados consulta={etapas}>
        {(listaEtapas) => (
          <ComDados consulta={obras}>
            {(listaObras) => <Conteudo etapas={listaEtapas} obras={listaObras} />}
          </ComDados>
        )}
      </ComDados>
      <Exclusoes />
    </section>
  )
}

function Conteudo({ etapas, obras }: { etapas: EtapaLista[]; obras: ObraLista[] }) {
  const ativas = etapas.filter((e) => !e.arquivada_em)
  const arquivadas = etapas.filter((e) => e.arquivada_em)
  const idsAtivas = new Set(ativas.map((e) => e.id))
  const obrasArquivadas = obras.filter((o) => o.arquivada_em && idsAtivas.has(o.etapa_id))
  if (etapas.length === 0) {
    return <p className="adm-dica">Nenhuma etapa cadastrada. Crie a primeira em "Nova etapa".</p>
  }
  return (
    <>
      {ativas.length === 0 && <p className="adm-dica">Nenhuma etapa ativa.</p>}
      {ativas.map((e) => (
        <CartaoEtapa key={e.id} etapa={e} obras={obras.filter((o) => o.etapa_id === e.id && !o.arquivada_em)} />
      ))}
      {obrasArquivadas.length > 0 && (
        <section className="adm-secao" aria-labelledby="titulo-obras-arquivadas">
          <h2 id="titulo-obras-arquivadas">Obras arquivadas ({obrasArquivadas.length})</h2>
          <p className="adm-dica">Não aparecem no Mini App nem publicam no Telegram. Abra a obra para desarquivar.</p>
          <TabelaObras obras={obrasArquivadas} rotulo="Obras arquivadas" comEtapa />
        </section>
      )}
      {arquivadas.length > 0 && (
        <section className="adm-secao" aria-labelledby="titulo-etapas-arquivadas">
          <h2 id="titulo-etapas-arquivadas">Etapas arquivadas ({arquivadas.length})</h2>
          <p className="adm-dica">
            As obras delas não aparecem no Mini App nem publicam no Telegram. Abra a etapa para desarquivar.
          </p>
          <table className="adm-tabela" aria-label="Etapas arquivadas">
            <thead>
              <tr>
                <th scope="col">Etapa</th>
                <th scope="col">Slug</th>
                <th scope="col" className="adm-num">
                  Obras
                </th>
                <th scope="col">Arquivada em</th>
              </tr>
            </thead>
            <tbody>
              {arquivadas.map((e) => (
                <tr key={e.id} className="adm-linha-arquivada">
                  <td>
                    <Link to={`/etapas/${e.slug}`}>{e.nome}</Link>
                  </td>
                  <td>
                    <code>{e.slug}</code>
                  </td>
                  <td className="adm-num">{e.obras}</td>
                  <td>{new Date(e.arquivada_em!).toLocaleString('pt-BR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  )
}

function CartaoEtapa({ etapa, obras }: { etapa: EtapaLista; obras: ObraLista[] }) {
  const idTitulo = `titulo-etapa-${etapa.slug}`
  return (
    <section className="adm-secao adm-cartao-etapa" aria-labelledby={idTitulo}>
      <div className="adm-titulo-linha">
        <div>
          <div className="adm-titulo-etapa">
            <h2 id={idTitulo}>
              <Link to={`/etapas/${etapa.slug}`}>{etapa.nome}</Link>
            </h2>
            {etapa.sigla && (
              <span className="adm-selo adm-selo-sigla" title="Sigla no número do boletim">
                sigla {etapa.sigla}
              </span>
            )}
            {etapa.faltando > 0 && (
              <span
                className="adm-selo adm-selo-incompleto"
                title={`${etapa.faltando} ${etapa.faltando === 1 ? 'campo vazio' : 'campos vazios'} no cadastro do boletim`}
              >
                cadastro incompleto
              </span>
            )}
          </div>
          <p className="adm-dica adm-meta-etapa">
            <code>{etapa.slug}</code> · {plural(etapa.obras - etapa.obras_arquivadas, 'obra ativa', 'obras ativas')}
            {etapa.obras_arquivadas > 0 && ` · ${plural(etapa.obras_arquivadas, 'arquivada', 'arquivadas')}`} ·{' '}
            {rotuloGrupo(etapa)}
          </p>
        </div>
        <div className="adm-acoes adm-acoes-topo">
          <Link className="adm-botao" to={`/etapas/${etapa.slug}`} aria-label={`Abrir etapa ${etapa.nome}`}>
            Abrir etapa
          </Link>
          <Link
            className="adm-botao adm-botao-principal"
            to={`/nova-obra?etapa=${encodeURIComponent(etapa.slug)}`}
            aria-label={`Nova obra em ${etapa.nome}`}
          >
            Nova obra
          </Link>
        </div>
      </div>
      <TabelaObras obras={obras} rotulo={`Obras de ${etapa.nome}`} />
    </section>
  )
}

export function TabelaObras({ obras, rotulo, comEtapa = false }: { obras: ObraLista[]; rotulo: string; comEtapa?: boolean }) {
  if (obras.length === 0) return <p className="adm-dica">Nenhuma obra ativa nesta etapa.</p>
  return (
    <table className="adm-tabela" aria-label={rotulo}>
      <thead>
        <tr>
          <th scope="col">Obra</th>
          <th scope="col">Slug</th>
          {comEtapa && <th scope="col">Etapa</th>}
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
            {comEtapa && (
              <td>
                <Link to={`/etapas/${o.etapa_slug}`}>{o.etapa_nome}</Link>
              </td>
            )}
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
            <th scope="col">Etapa</th>
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
              <td>{e.etapa_nome ? `${e.etapa_nome} (excluída junto)` : '—'}</td>
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
