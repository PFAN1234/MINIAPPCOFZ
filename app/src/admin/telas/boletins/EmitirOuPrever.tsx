/**
 * Bloco "Pré-visualizar / Emitir agora" da aba Boletins (com uma etapa escolhida): a prévia de uma
 * data e a emissão manual (ou retificação). Contrato: docs/contrato-boletim.md, partes 3 e 4.
 */
import { useEffect, useState } from 'react'
import { ComDados, mensagemDe } from '../../componentes.tsx'
import { useBoletins, useOrganizacao, usePedirEmissao, usePreviaBoletim } from '../../dados/hooks.ts'
import type { BoletimEmitido, EtapaDetalhe, PedidoEmissao } from '../../dados/tipos.ts'
import { dataBr, hojeNoFuso, numeroBoletim } from '../../formato.ts'
import { abrir } from './util.ts'

/** Lê os boletins e pedidos da etapa (a revisão e o "em andamento" dependem de todos) e mostra o bloco. */
export default function EmitirOuPreverDaEtapa({ etapa, telegramVinculado }: { etapa: EtapaDetalhe; telegramVinculado: boolean }) {
  const consulta = useBoletins(etapa.slug)
  return (
    <ComDados consulta={consulta}>
      {(d) => <EmitirOuPrever etapa={etapa} boletins={d.boletins} pedidos={d.pedidos} telegramVinculado={telegramVinculado} />}
    </ComDados>
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
