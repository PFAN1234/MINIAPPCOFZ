/**
 * Seção "Boletins" da página da etapa: os boletins emitidos (abrir o PDF), os pedidos de emissão
 * ainda não emitidos (na fila, gerando ou com falha), a prévia de uma data e a emissão manual
 * (ou retificação). Contrato: docs/contrato-boletim.md, parte 3.
 */
import { useEffect, useState } from 'react'
import { ComDados, mensagemDe } from '../../componentes.tsx'
import { useBoletins, useOrganizacao, usePedirEmissao, usePreviaBoletim, useUrlPdfBoletim } from '../../dados/hooks.ts'
import type { BoletimEmitido, EstadoEmissao, EtapaDetalhe, PedidoEmissao } from '../../dados/tipos.ts'
import { dataBr, dataHoraBr, hojeNoFuso, numeroBoletim } from '../../formato.ts'

const ROTULO_ESTADO: Record<EstadoEmissao, string> = {
  pendente: 'na fila',
  gerando: 'gerando',
  emitido: 'emitido',
  falhou: 'falhou',
}

/** Situação do envio ao Telegram (`publicacao_telegram.estado`). */
function rotuloPublicacao(b: BoletimEmitido): string {
  if (b.publicado) return 'publicado'
  if (b.publicacao_estado === 'falhou') return 'falhou'
  if (b.publicacao_estado === 'incerto') return 'incerto (conferir no grupo)'
  if (b.publicacao_estado === 'enviando') return 'enviando'
  return 'aguardando'
}

/** Abre a URL numa aba nova; devolve false se o navegador bloquear. */
function abrir(url: string): boolean {
  const aba = window.open(url, '_blank')
  if (aba) aba.opener = null
  return aba !== null
}

export default function Boletins({ etapa, telegramVinculado }: { etapa: EtapaDetalhe; telegramVinculado: boolean }) {
  const consulta = useBoletins(etapa.slug)
  return (
    <section className="adm-secao" aria-labelledby="titulo-boletins">
      <h2 id="titulo-boletins">Boletins</h2>
      <p className="adm-dica">
        Emissão automática todos os dias às {etapa.boletim_horario} ({etapa.fuso.replace('America/', '').replace('_', ' ')}),
        com os lançamentos do dia. O PDF vai para o grupo do Telegram da etapa, no tópico Geral.
      </p>
      <ComDados consulta={consulta}>
        {(dados) => (
          <>
            <EmitirOuPrever etapa={etapa} boletins={dados.boletins} pedidos={dados.pedidos} telegramVinculado={telegramVinculado} />
            <Pedidos pedidos={dados.pedidos} />
            <Emitidos boletins={dados.boletins} />
          </>
        )}
      </ComDados>
    </section>
  )
}

// --- Prévia e emissão manual -----------------------------------------------------------------

function EmitirOuPrever({
  etapa,
  boletins,
  pedidos,
  telegramVinculado,
}: {
  etapa: EtapaDetalhe
  boletins: BoletimEmitido[]
  pedidos: PedidoEmissao[]
  telegramVinculado: boolean
}) {
  const hoje = hojeNoFuso(etapa.fuso)
  const [data, setData] = useState(hoje)
  const [confirmando, setConfirmando] = useState(false)
  const [sucesso, setSucesso] = useState<string | null>(null)
  const [urlPrevia, setUrlPrevia] = useState<string | null>(null)
  const org = useOrganizacao()
  const pedir = usePedirEmissao(etapa.slug)
  const previa = usePreviaBoletim(etapa.slug)

  // A URL da prévia (blob) é liberada ao trocar de prévia e ao sair da página.
  useEffect(() => () => {
    if (urlPrevia) URL.revokeObjectURL(urlPrevia)
  }, [urlPrevia])

  const dataValida = /^\d{4}-\d{2}-\d{2}$/.test(data) && data <= hoje
  const doDia = boletins.filter((b) => b.data === data)
  const revisao = doDia.length === 0 ? 0 : Math.max(...doDia.map((b) => b.revisao)) + 1
  const emAndamento = pedidos.some((p) => p.data === data && (p.estado === 'pendente' || p.estado === 'gerando'))
  const numero =
    etapa.sigla && dataValida
      ? numeroBoletim(etapa.sigla, data, org.data?.nome ?? '') + (revisao > 0 ? `-R${revisao}` : '')
      : null
  const rotuloEmitir = revisao > 0 ? 'Emitir retificação' : 'Emitir agora'

  function mudarData(v: string) {
    setData(v)
    setConfirmando(false)
    setSucesso(null)
    pedir.reset()
    previa.reset()
  }

  function gerarPrevia() {
    setSucesso(null)
    previa.mutate(data, {
      onSuccess: (pdf) => {
        const url = URL.createObjectURL(pdf)
        setUrlPrevia(url)
        abrir(url)
      },
    })
  }

  if (!etapa.sigla) {
    return <p className="adm-alerta adm-alerta-aviso">Defina a sigla da etapa para emitir boletins.</p>
  }

  return (
    <div className="adm-boletim-acoes">
      <div className="adm-campo-form">
        <label htmlFor="data-boletim">Data do boletim</label>
        <input id="data-boletim" type="date" value={data} max={hoje} onChange={(e) => mudarData(e.target.value)} />
      </div>
      <div className="adm-acoes">
        <button type="button" className="adm-botao" disabled={!dataValida || previa.isPending} onClick={gerarPrevia}>
          {previa.isPending ? 'Gerando a prévia…' : 'Pré-visualizar'}
        </button>
        {!confirmando && (
          <button
            type="button"
            className="adm-botao adm-botao-principal"
            disabled={!dataValida || emAndamento}
            onClick={() => {
              setSucesso(null)
              setConfirmando(true)
            }}
          >
            {rotuloEmitir}
          </button>
        )}
      </div>
      {!dataValida && <p className="adm-dica">Escolha uma data até hoje ({dataBr(hoje)}).</p>}
      {emAndamento && <p className="adm-dica">Já há um pedido de emissão em andamento para {dataBr(data)}.</p>}
      {urlPrevia && previa.isSuccess && (
        <p className="adm-dica">
          Prévia pronta (sem número, nada foi gravado):{' '}
          <a href={urlPrevia} target="_blank" rel="noreferrer">
            abrir a prévia
          </a>
          .
        </p>
      )}
      {confirmando && numero && (
        <div className="adm-alerta adm-alerta-aviso" role="alertdialog" aria-label={`Confirmar ${rotuloEmitir.toLowerCase()}`}>
          <p>
            {revisao > 0 ? (
              <>
                Será emitida a retificação <strong>{numero}</strong> do boletim de {dataBr(data)}, com os lançamentos
                atuais do dia. O boletim anterior continua no histórico.
              </>
            ) : (
              <>
                Será emitido o boletim <strong>{numero}</strong>, com os lançamentos de {dataBr(data)}. Depois de
                emitido, o dia fica travado: correções só por retificação.
              </>
            )}{' '}
            {telegramVinculado
              ? 'O PDF será enviado ao grupo do Telegram da etapa.'
              : 'A etapa não tem grupo do Telegram: o envio espera o vínculo do grupo.'}
          </p>
          <div className="adm-acoes">
            <button
              type="button"
              className="adm-botao adm-botao-principal"
              disabled={pedir.isPending}
              onClick={() =>
                pedir.mutate(data, {
                  onSuccess: () => {
                    setConfirmando(false)
                    setSucesso(`Pedido de emissão de ${numero} enviado. O boletim aparece na lista assim que for gerado.`)
                  },
                })
              }
            >
              Confirmar: {rotuloEmitir.toLowerCase()} ({numero})
            </button>
            <button type="button" className="adm-botao" onClick={() => setConfirmando(false)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
      {sucesso && (
        <p className="adm-alerta adm-alerta-ok" role="status">
          {sucesso}
        </p>
      )}
      {(pedir.isError || previa.isError) && (
        <p className="adm-alerta adm-alerta-erro" role="alert">
          {mensagemDe(pedir.error ?? previa.error)}
        </p>
      )}
    </div>
  )
}

// --- Pedidos não emitidos --------------------------------------------------------------------

function Pedidos({ pedidos }: { pedidos: PedidoEmissao[] }) {
  if (pedidos.length === 0) return null
  return (
    <div className="adm-rolagem">
      <table className="adm-tabela" aria-label="Pedidos de emissão">
        <thead>
          <tr>
            <th scope="col">Data</th>
            <th scope="col">Revisão</th>
            <th scope="col">Situação</th>
            <th scope="col" className="adm-num">
              Tentativas
            </th>
            <th scope="col">Atualizado em</th>
            <th scope="col">Erro</th>
          </tr>
        </thead>
        <tbody>
          {pedidos.map((p) => (
            <tr key={p.id}>
              <td>{dataBr(p.data)}</td>
              <td>{p.revisao > 0 ? `R${p.revisao}` : 'original'}</td>
              <td>
                <span className={`adm-selo${p.estado === 'falhou' ? ' adm-selo-erro' : ''}`}>{ROTULO_ESTADO[p.estado]}</span>
              </td>
              <td className="adm-num">{p.tentativas}</td>
              <td>{dataHoraBr(p.atualizado_em)}</td>
              <td>{p.erro ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// --- Emitidos --------------------------------------------------------------------------------

function Emitidos({ boletins }: { boletins: BoletimEmitido[] }) {
  const url = useUrlPdfBoletim()
  const [bloqueado, setBloqueado] = useState<string | null>(null)
  if (boletins.length === 0) return <p className="adm-dica">Nenhum boletim emitido.</p>
  return (
    <>
      <div className="adm-rolagem">
        <table className="adm-tabela" aria-label="Boletins emitidos">
          <thead>
            <tr>
              <th scope="col">Número</th>
              <th scope="col">Data</th>
              <th scope="col">Emitido em</th>
              <th scope="col">Por</th>
              <th scope="col">Telegram</th>
              <th scope="col">
                <span className="adm-oculto">PDF</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {boletins.map((b) => (
              <tr key={b.id}>
                <td>{b.numero}</td>
                <td>{dataBr(b.data)}</td>
                <td>{dataHoraBr(b.emitido_em)}</td>
                <td>{b.emitido_por_nome ?? 'automático'}</td>
                <td>{rotuloPublicacao(b)}</td>
                <td className="adm-acoes">
                  <button
                    type="button"
                    className="adm-botao"
                    aria-label={`Abrir PDF de ${b.numero}`}
                    disabled={!b.pdf_path || url.isPending}
                    onClick={() =>
                      url.mutate(b.pdf_path!, {
                        onSuccess: (u) => setBloqueado(abrir(u) ? null : u),
                      })
                    }
                  >
                    Abrir PDF
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {bloqueado && (
        <p className="adm-dica">
          O navegador bloqueou a aba nova:{' '}
          <a href={bloqueado} target="_blank" rel="noreferrer">
            abrir o PDF
          </a>
          .
        </p>
      )}
      {url.isError && (
        <p className="adm-alerta adm-alerta-erro" role="alert">
          {mensagemDe(url.error)}
        </p>
      )}
    </>
  )
}
