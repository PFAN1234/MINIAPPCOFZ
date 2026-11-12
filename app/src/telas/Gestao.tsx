import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { EstadoConsulta, EstadoVazio } from '../components/Estado.tsx'
import { Horario } from '../components/Horario.tsx'
import { PedidosAcesso } from '../components/PedidosAcesso.tsx'
import { TopoTela } from '../components/TopoTela.tsx'
import {
  useDefinirPapel,
  useObra,
  useParticipantes,
  usePublicacoesProblema,
  useRemoverParticipante,
  useResolverPublicacao,
} from '../dados/hooks.ts'
import type { ObraDetalhe, PapelObra, Participante, PublicacaoProblema } from '../dados/tipos.ts'

/** Gestão da obra: pedidos de acesso, participantes e publicações com problema (só gestor). */
export default function Gestao() {
  const { slug = '' } = useParams()
  const obra = useObra(slug)
  return (
    <EstadoConsulta consulta={obra} topo={<TopoTela titulo="Gestão" />}>
      {(detalhe) => <GestaoCarregada detalhe={detalhe} />}
    </EstadoConsulta>
  )
}

function GestaoCarregada({ detalhe }: { detalhe: ObraDetalhe }) {
  const { obra, papel } = detalhe
  return (
    <section aria-labelledby="titulo-gestao">
      <TopoTela
        titulo="Gestão"
        idTitulo="titulo-gestao"
        subtitulo={<Link to={`/obras/${obra.slug}`}>{obra.nome}</Link>}
      />
      {papel !== 'gestor' ? (
        <EstadoVazio titulo="Só gestores da obra têm acesso à gestão." />
      ) : (
        <>
          <section aria-labelledby="gestao-pedidos" className="gestao-secao">
            <h3 id="gestao-pedidos" className="secao-titulo">
              Pedidos de acesso
            </h3>
            <PedidosAcesso obraId={obra.id} />
          </section>
          <section aria-labelledby="gestao-participantes" className="gestao-secao">
            <h3 id="gestao-participantes" className="secao-titulo">
              Participantes
            </h3>
            <Participantes obraId={obra.id} />
          </section>
          <section aria-labelledby="gestao-publicacoes" className="gestao-secao">
            <h3 id="gestao-publicacoes" className="secao-titulo">
              Publicações com problema
            </h3>
            <Publicacoes obraId={obra.id} />
          </section>
        </>
      )}
    </section>
  )
}

function mensagemDe(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'Não foi possível concluir a ação.'
}

function Participantes({ obraId }: { obraId: string }) {
  const participantes = useParticipantes(obraId)
  const definir = useDefinirPapel(obraId)
  const remover = useRemoverParticipante(obraId)
  const [erro, setErro] = useState<{ usuarioId: string; mensagem: string } | null>(null)

  async function mudarPapel(p: Participante, papel: PapelObra) {
    setErro(null)
    try {
      await definir.mutateAsync({ usuarioId: p.usuario_id, papel })
    } catch (e) {
      setErro({ usuarioId: p.usuario_id, mensagem: mensagemDe(e) })
    }
  }

  async function removerDaObra(p: Participante) {
    if (!window.confirm(`Remover ${p.nome} da obra? Ele precisará pedir acesso de novo.`)) return
    setErro(null)
    try {
      await remover.mutateAsync(p.usuario_id)
    } catch (e) {
      setErro({ usuarioId: p.usuario_id, mensagem: mensagemDe(e) })
    }
  }

  const ocupado = definir.isPending || remover.isPending
  return (
    <EstadoConsulta consulta={participantes}>
      {(lista) => (
        <ul className="lista">
          {lista.map((p) => (
            <li key={p.usuario_id} className="lista-item participante-item">
              <span className="item-texto">
                <span className="lista-titulo">{p.nome}</span>
                {p.username && <span className="lista-sub">@{p.username}</span>}
              </span>
              <span className="participante-acoes">
                <select
                  aria-label={`Papel de ${p.nome}`}
                  value={p.papel}
                  disabled={ocupado}
                  onChange={(e) => void mudarPapel(p, e.target.value as PapelObra)}
                >
                  <option value="equipe">Equipe</option>
                  <option value="gestor">Gestor</option>
                </select>
                <button
                  type="button"
                  className="botao botao-secundario"
                  disabled={ocupado}
                  aria-label={`Remover ${p.nome}`}
                  onClick={() => void removerDaObra(p)}
                >
                  Remover
                </button>
              </span>
              {erro?.usuarioId === p.usuario_id && (
                <p className="form-erro participante-erro" role="alert">
                  {erro.mensagem}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </EstadoConsulta>
  )
}

const ROTULO_TIPO: Record<PublicacaoProblema['tipo'], string> = {
  servico: 'Serviço',
  pendencia: 'Pendência',
  encerramento: 'Encerramento',
}

function textoEstado(p: PublicacaoProblema): string {
  if (p.estado === 'incerto') return 'Incerta: pode ter sido publicada'
  if (p.estado === 'falhou') return 'Falhou'
  return 'Sem sucesso depois de várias tentativas'
}

function Publicacoes({ obraId }: { obraId: string }) {
  const publicacoes = usePublicacoesProblema(obraId)
  const resolver = useResolverPublicacao()
  const [erro, setErro] = useState<{ id: number; mensagem: string } | null>(null)

  async function agir(p: PublicacaoProblema, acao: 'republicar' | 'marcar') {
    const pergunta =
      acao === 'republicar'
        ? 'Reenviar esta publicação ao tópico? Se ela já estiver lá, ficará duplicada.'
        : 'Marcar esta publicação como publicada? Ela sairá desta lista.'
    if (!window.confirm(pergunta)) return
    setErro(null)
    try {
      await resolver.mutateAsync({ id: p.id, acao })
    } catch (e) {
      setErro({ id: p.id, mensagem: mensagemDe(e) })
    }
  }

  return (
    <EstadoConsulta consulta={publicacoes}>
      {(lista) =>
        lista.length === 0 ? (
          <EstadoVazio titulo="Nenhuma publicação com problema." />
        ) : (
          <ul className="lista">
            {lista.map((p) => {
              const resolvivel = p.estado === 'incerto' || p.estado === 'falhou'
              return (
                <li key={p.id} className="lista-item publicacao-problema-item">
                  <span className="registro-topo">
                    <span className="selo selo-servico">{ROTULO_TIPO[p.tipo]}</span>
                    <span className="lista-sub">{p.ambiente}</span>
                  </span>
                  <span className="lista-titulo registro-legenda">{p.legenda}</span>
                  <span className="publicacao publicacao-problema">{textoEstado(p)}</span>
                  {p.erro && <span className="lista-sub publicacao-erro">{p.erro}</span>}
                  <span className="lista-sub">
                    <Horario iso={p.atualizado_em} />
                  </span>
                  {resolvivel && (
                    <span className="registro-acoes">
                      <button
                        type="button"
                        className="botao"
                        disabled={resolver.isPending}
                        onClick={() => void agir(p, 'republicar')}
                      >
                        Reenviar
                      </button>
                      <button
                        type="button"
                        className="botao botao-secundario"
                        disabled={resolver.isPending}
                        onClick={() => void agir(p, 'marcar')}
                      >
                        Marcar como publicada
                      </button>
                    </span>
                  )}
                  {erro?.id === p.id && (
                    <p className="form-erro" role="alert">
                      {erro.mensagem}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        )
      }
    </EstadoConsulta>
  )
}
