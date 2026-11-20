import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { CampoBusca } from '@shared/ui/inputs/CampoBusca.tsx'
import { EstadoCarregando, EstadoConsulta, EstadoVazio } from '@shared/ui/feedback/Estado.tsx'
import { AbasEtapa } from '@shared/ui/inputs/AbasEtapa.tsx'
import { EquipeServico } from '@modules/acessos/presentation/miniapp/EquipeServico.tsx'
import { TopoTela } from '@shared/ui/layout/TopoTela.tsx'
import type { ObraDaLista, ResumoObra } from '@modules/obras/domain/tipos.ts'
import type { ObraDisponivel } from '@modules/acessos/domain/tipos.ts'
import {
  useCriarLinkAdmin,
  useEhGestorAlguma,
  useMatrizAcessos,
  useEtapasInicio,
  useObras,
  useObrasDisponiveis,
  usePublicacoesProblema,
  useResumoObras,
  useSolicitarAcesso,
  useSouAdmin,
} from '../../../../dados/hooks.ts'
import { abrirLink } from '@shared/infra/telegram/telegram.ts'
import { useUsuarioId } from '@modules/operacao/presentation/miniapp/contexto.tsx'
import { etapasDasAbas } from '@modules/obras/domain/etapas.ts'
import { useEtapaEscolhida } from '@modules/obras/presentation/miniapp/useEtapaGuardada.ts'
import { useOnline } from '@shared/infra/browser/online.ts'
import { normalizarTexto } from '@shared/kernel/busca.ts'
import { textoPendencias, textoPendenciasResolvidas, textoServicos } from '@shared/kernel/formato.ts'

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
        titulo="Obras"
        idTitulo="titulo-obras"
        base={
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
      <ControleAcesso />
    </>
  )
}

/** Uma obra do Início: o nome (link que cobre o cartão), os 3 totais e, ao gestor, o aviso de publicações com problema. */
function LinhaObra({ obra, resumo }: { obra: ObraDaLista; resumo: ResumoObra | undefined }) {
  const gestor = resumo?.papel === 'gestor'
  return (
    <li className="lista-item obra-linha">
      <div className="obra-linha-cab">
        <Link className="obra-linha-nome lista-titulo" to={`/obras/${obra.slug}`}>
          {obra.nome}
        </Link>
      </div>
      {resumo && (
        <span className="barrinhas">
          <Barrinha tipo="servicos" n={resumo.servicos} texto={textoServicos(resumo.servicos)} />
          <Barrinha tipo="abertas" n={resumo.abertas} texto={textoPendencias(resumo.abertas)} />
          <Barrinha tipo="resolvidas" n={resumo.resolvidas} texto={textoPendenciasResolvidas(resumo.resolvidas)} />
        </span>
      )}
      {gestor && <AvisoPublicacoes obra={obra} />}
    </li>
  )
}

const ROTULO_BARRINHA = { servicos: 'Serviços', abertas: 'Pendências', resolvidas: 'Resolvidas' } as const

/** Um total da obra: o número grande e o rótulo curto embaixo; o texto por extenso fica para o leitor de tela. */
function Barrinha({ tipo, n, texto }: { tipo: keyof typeof ROTULO_BARRINHA; n: number; texto: string }) {
  return (
    <span className={`barrinha barrinha-${tipo}`} role="img" aria-label={texto} title={texto}>
      <b>{n}</b>
      <span className="barrinha-rotulo">{ROTULO_BARRINHA[tipo]}</span>
    </span>
  )
}

/** Só para o gestor: link de alerta quando a obra tem publicações com problema. */
function AvisoPublicacoes({ obra }: { obra: ObraDaLista }) {
  const problemas = usePublicacoesProblema(obra.id, true)
  const n = problemas.data?.length ?? 0
  if (n === 0) return null
  return (
    <Link className="aviso-publicacoes" to={`/obras/${obra.slug}/publicacoes`}>
      {n === 1 ? '1 publicação com problema' : `${n} publicações com problema`}
    </Link>
  )
}

/** Para quem é gestor de alguma obra ou admin: abre o Controle de acesso, com o total de pedidos. */
function ControleAcesso() {
  const gestor = useEhGestorAlguma()
  const admin = useSouAdmin()
  const pode = gestor === true || admin.data === true
  const matriz = useMatrizAcessos(pode)
  if (!pode) return null
  const pedidos = (matriz.data?.pessoas ?? []).reduce((soma, p) => soma + p.pedidos.length, 0)
  return (
    <section className="administracao">
      <Link className="botao" to="/acessos">
        Controle de acesso
        {pedidos > 0 && (
          <>
            {' '}
            <span className="atalho-selo atalho-selo-alerta">{pedidos}</span>
          </>
        )}
      </Link>
      <p className="lista-sub">Escolha quais obras cada pessoa do grupo pode ver.</p>
    </section>
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
