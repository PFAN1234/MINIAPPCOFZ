import type { PublicacaoProblema } from '@modules/fiscalizacao/domain/tipos.ts'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { EstadoConsulta, EstadoVazio } from '../shared/ui/feedback/Estado.tsx'
import { Horario } from '../components/Horario.tsx'
import { TopoTela } from '../shared/ui/layout/TopoTela.tsx'
import { useObra, usePublicacoesProblema, useResolverPublicacao } from '../dados/hooks.ts'

import type { ObraDetalhe } from '@modules/obras/domain/tipos.ts'

/** Publicações com problema da obra (só gestor). */
export default function PublicacoesTela() {
  const { slug = '' } = useParams()
  const obra = useObra(slug)
  return (
    <EstadoConsulta consulta={obra} topo={<TopoTela titulo="Publicações com problema" />}>
      {(detalhe) => <PublicacoesCarregada detalhe={detalhe} />}
    </EstadoConsulta>
  )
}

function PublicacoesCarregada({ detalhe }: { detalhe: ObraDetalhe }) {
  const { obra, papel } = detalhe
  return (
    <section aria-labelledby="titulo-publicacoes">
      <TopoTela
        titulo="Publicações com problema"
        idTitulo="titulo-publicacoes"
        subtitulo={<Link to={`/obras/${obra.slug}`}>{obra.nome}</Link>}
      />
      {papel !== 'gestor' ? (
        <EstadoVazio titulo="Só gestores da obra têm acesso à gestão." />
      ) : (
        <Publicacoes obraId={obra.id} />
      )}
    </section>
  )
}

function mensagemDe(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'Não foi possível concluir a ação.'
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
