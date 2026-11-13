import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { CampoBusca } from '../components/CampoBusca.tsx'
import { EstadoCarregando, EstadoConsulta, EstadoVazio } from '../components/Estado.tsx'
import { AbasEtapa } from '../components/AbasEtapa.tsx'
import { EquipeServico } from '../components/EquipeServico.tsx'
import { TopoTela } from '../components/TopoTela.tsx'
import type { ObraDaLista, ObraDisponivel, ResumoObra } from '../dados/tipos.ts'
import {
  useCriarLinkAdmin,
  useEtapasInicio,
  useObras,
  useObrasDisponiveis,
  usePublicacoesProblema,
  useResumoObras,
  useSolicitacoes,
  useSolicitarAcesso,
  useSouAdmin,
} from '../dados/hooks.ts'
import { abrirLink } from '../telegram.ts'
import { useUsuarioId } from '../offline/contexto.tsx'
import { etapasDasAbas, useEtapaEscolhida } from '../util/etapas.ts'
import { useOnline } from '../util/online.ts'
import { normalizarTexto } from '../util/busca.ts'
import { textoPendencias, textoPendenciasResolvidas, textoServicos } from '../util/formato.ts'

const MINIMO_PARA_BUSCA = 5

export default function Obras() {
  const obras = useObras()
  const resumo = useResumoObras()
  const [busca, setBusca] = useState('')
  const online = useOnline()
  const disponiveis = useObrasDisponiveis()
  const todasOutras = useMemo(() => (online ? (disponiveis.data ?? []) : []), [online, disponiveis.data])
  // Só afirma que não há obras depois de saber se há outras para pedir acesso.
  const outrasConhecidas = !online || !disponiveis.isPending

  // Uma etapa por vez: a lista, a busca, "Outras obras" e a equipe de serviço seguem a escolhida.
  const inicio = useEtapasInicio()
  const etapas = useMemo(
    () => etapasDasAbas(inicio.data ?? [], obras.data ?? [], todasOutras),
    [inicio.data, obras.data, todasOutras],
  )
  const [etapa, escolherEtapa] = useEtapaEscolhida(useUsuarioId(), etapas)
  // Sem a resposta de `etapas_inicio` (sinal ou cache), vale ter obra própria na etapa.
  const participa = etapa
    ? (inicio.data?.find((e) => e.id === etapa.id)?.participa ??
      (obras.data ?? []).some((o) => o.etapa?.id === etapa.id))
    : true
  const outras = etapa ? todasOutras.filter((o) => o.etapa_id === etapa.id) : todasOutras

  const porObra = useMemo(() => {
    return new Map((resumo.data ?? []).map((r) => [r.obra_id, r]))
  }, [resumo.data])

  return (
    <>
      <TopoTela
        lista
        titulo="Obras"
        idTitulo="titulo-obras"
        aoLado={
          etapa && (
            <AbasEtapa
              etapas={etapas}
              valor={etapa.id}
              onMudar={(id) => {
                escolherEtapa(id)
                setBusca('')
              }}
            />
          )
        }
      />
      <section aria-labelledby="titulo-obras">
        <EstadoConsulta consulta={obras}>
          {(todas) => {
            const lista = etapa ? todas.filter((o) => o.etapa?.id === etapa.id) : todas
            if (lista.length === 0) {
              if (!outrasConhecidas) return <EstadoCarregando />
              if (outras.length > 0) return null
              if (!participa) {
                return (
                  <EstadoVazio
                    titulo="Você não participa desta etapa"
                    texto="Entre no grupo dela no Telegram e abra o app de novo para pedir acesso."
                  />
                )
              }
              return (
                <EstadoVazio
                  titulo="Você ainda não tem acesso a nenhuma obra"
                  texto="Entre no grupo da obra no Telegram e abra o app de novo para pedir acesso."
                />
              )
            }
            const termo = normalizarTexto(busca)
            const visiveis = termo
              ? lista.filter((o) => normalizarTexto(o.nome).includes(termo))
              : lista
            return (
              <>
                {lista.length > MINIMO_PARA_BUSCA && (
                  <CampoBusca valor={busca} onMudar={setBusca} rotulo="Buscar obra" placeholder="Buscar obra" />
                )}
                {visiveis.length === 0 ? (
                  <EstadoVazio titulo="Nenhuma obra encontrada" texto="Tente outro nome." />
                ) : (
                  <ul className="lista">
                    {visiveis.map((o) => (
                      <LinhaObra key={o.id} obra={o} resumo={porObra.get(o.id)} />
                    ))}
                  </ul>
                )}
              </>
            )
          }}
        </EstadoConsulta>
      </section>
      {outras.length > 0 && <OutrasObras obras={outras} />}
      {etapa && <EquipeServico etapaId={etapa.id} />}
      <Administracao />
    </>
  )
}

/** Uma obra do Início: o nome (link), as 3 barrinhas de totais e, para o gestor, o botão Gestão. */
function LinhaObra({ obra, resumo }: { obra: ObraDaLista; resumo: ResumoObra | undefined }) {
  const gestor = resumo?.papel === 'gestor'
  return (
    <li className="lista-item obra-linha">
      <Link className="obra-linha-nome lista-titulo" to={`/obras/${obra.slug}`}>
        {obra.nome}
      </Link>
      {resumo && (
        <span className="barrinhas">
          <Barrinha tipo="servicos" n={resumo.servicos} texto={textoServicos(resumo.servicos)} />
          <Barrinha tipo="abertas" n={resumo.abertas} texto={textoPendencias(resumo.abertas)} />
          <Barrinha tipo="resolvidas" n={resumo.resolvidas} texto={textoPendenciasResolvidas(resumo.resolvidas)} />
        </span>
      )}
      {gestor && <BotaoGestao obra={obra} />}
    </li>
  )
}

function Barrinha({ tipo, n, texto }: { tipo: 'servicos' | 'abertas' | 'resolvidas'; n: number; texto: string }) {
  return (
    <span className={`barrinha barrinha-${tipo}`} role="img" aria-label={texto} title={texto}>
      {n}
    </span>
  )
}

/** Atalho da Gestão, com selo de alerta (pedidos de acesso e publicações com problema). */
function BotaoGestao({ obra }: { obra: ObraDaLista }) {
  const pedidos = useSolicitacoes(obra.id, true)
  const problemas = usePublicacoesProblema(obra.id, true)
  const n = (pedidos.data?.length ?? 0) + (problemas.data?.length ?? 0)
  return (
    <Link className="atalho" to={`/obras/${obra.slug}/gestao`}>
      Gestão{' '}
      {n > 0 && <span className="atalho-selo atalho-selo-alerta">{n}</span>}
    </Link>
  )
}

/** Só para admins do Mini App: abre o site de administração no navegador, já com a sessão. */
function Administracao() {
  const admin = useSouAdmin()
  const criar = useCriarLinkAdmin()
  if (admin.data !== true) return null
  return (
    <section className="administracao">
      <button
        type="button"
        className="botao"
        disabled={criar.isPending}
        onClick={() => criar.mutate(undefined, { onSuccess: (link) => abrirLink(link.url) })}
      >
        {criar.isPending ? 'Abrindo…' : 'Administração'}
      </button>
      <p className="lista-sub">Abre o site de administração no navegador (o link vale por 2 minutos).</p>
      {criar.isError && (
        <p className="erro-texto" role="alert">
          {criar.error instanceof Error ? criar.error.message : 'Não foi possível abrir a administração.'}
        </p>
      )}
    </section>
  )
}

function OutrasObras({ obras }: { obras: ObraDisponivel[] }) {
  const solicitar = useSolicitarAcesso()
  return (
    <section aria-labelledby="titulo-outras">
      <h2 id="titulo-outras">Outras obras</h2>
      <ul className="lista">
        {obras.map((o) => (
          <li key={o.id} className="lista-item lista-item-linha">
            <span className="item-texto">
              <span className="lista-titulo">{o.nome}</span>
              {o.solicitacao === 'recusada' && <span className="lista-sub">Pedido recusado</span>}
            </span>
            {o.solicitacao === 'pendente' ? (
              <span className="selo">Aguardando aprovação</span>
            ) : (
              <button
                type="button"
                className="botao"
                disabled={solicitar.isPending}
                aria-label={`${o.solicitacao === 'recusada' ? 'Pedir de novo' : 'Solicitar acesso'}: ${o.nome}`}
                onClick={() => solicitar.mutate(o.id)}
              >
                {o.solicitacao === 'recusada' ? 'Pedir de novo' : 'Solicitar acesso'}
              </button>
            )}
          </li>
        ))}
      </ul>
      {solicitar.isError && (
        <p className="erro-texto" role="alert">
          {solicitar.error instanceof Error ? solicitar.error.message : 'Não foi possível pedir acesso.'}
        </p>
      )}
    </section>
  )
}
