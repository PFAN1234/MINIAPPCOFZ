import { useState } from 'react'
import { useCheckin, useCheckout, useEquipeServico } from '../dados/hooks.ts'
import type { EquipeServico as Equipe, MembroServico } from '../dados/tipos.ts'
import { ErroLocalizacao, obterPosicao } from '../util/localizacao.ts'
import { dataNoFuso, FUSO_PADRAO, horaNoFuso } from '../util/fuso.ts'
import { useOnline } from '../util/online.ts'
import { EstadoConsulta } from './Estado.tsx'

/** "14:32" se for hoje; senão "dd/mm 14:32". */
function quando(iso: string): string {
  const hora = horaNoFuso(iso, FUSO_PADRAO)
  const dia = dataNoFuso(new Date(iso), FUSO_PADRAO)
  if (dia === dataNoFuso(new Date(), FUSO_PADRAO)) return hora
  const [, m, d] = dia.split('-')
  return `${d}/${m} ${hora}`
}

function textoPeriodo(m: MembroServico): string {
  if (m.saida_em === null) return `Em serviço desde ${quando(m.entrada_em)}`
  if (m.saida_automatica) return `${quando(m.entrada_em)} – saída não registrada`
  return `${quando(m.entrada_em)} – ${quando(m.saida_em)}`
}

/** Seção "Equipe de serviço" da etapa escolhida: quem está de serviço e o check-in/check-out. */
export function EquipeServico({ etapaId }: { etapaId: string }) {
  const equipe = useEquipeServico(etapaId)
  return (
    <section aria-labelledby="titulo-equipe">
      <h2 id="titulo-equipe">Equipe de serviço</h2>
      <EstadoConsulta consulta={equipe}>{(dados) => <Conteudo etapaId={etapaId} dados={dados} />}</EstadoConsulta>
    </section>
  )
}

function Conteudo({ etapaId, dados }: { etapaId: string; dados: Equipe }) {
  const online = useOnline()
  const checkin = useCheckin(etapaId)
  const checkout = useCheckout()
  const [obtendo, setObtendo] = useState(false)
  const [erroLocal, setErroLocal] = useState<ErroLocalizacao | null>(null)
  const [confirmando, setConfirmando] = useState(false)

  const meu = dados.meu_servico
  const aqui = meu !== null && meu.etapa_id === etapaId
  const ocupado = obtendo || checkin.isPending || checkout.isPending
  const erro = erroLocal?.message ?? (checkin.error ?? checkout.error)?.message ?? null

  async function fazerCheckin() {
    setErroLocal(null)
    checkin.reset()
    checkout.reset()
    setObtendo(true)
    try {
      const posicao = await obterPosicao()
      setObtendo(false)
      checkin.mutate(posicao)
    } catch (e) {
      setObtendo(false)
      setErroLocal(
        e instanceof ErroLocalizacao ? e : new ErroLocalizacao('indisponivel', 'Não foi possível obter a localização.'),
      )
    }
  }

  function fazerCheckout() {
    setConfirmando(false)
    setErroLocal(null)
    checkin.reset()
    checkout.mutate()
  }

  return (
    <>
      {dados.equipe.length === 0 ? (
        <p className="lista-sub">Ninguém de serviço agora.</p>
      ) : (
        <ul className="lista">
          {dados.equipe.map((m) => (
            <li key={m.id} className="lista-item">
              <span className="lista-titulo">
                {m.nome}
                {m.eu && ' (você)'}
              </span>
              <span className="lista-sub">{textoPeriodo(m)}</span>
            </li>
          ))}
        </ul>
      )}

      {meu && !aqui && <p className="lista-sub">Você está de serviço na {meu.etapa_nome}</p>}
      {meu && !confirmando && (
        <button type="button" className="botao" disabled={ocupado || !online} onClick={() => setConfirmando(true)}>
          {checkout.isPending ? 'Registrando saída…' : 'Fazer check-out'}
        </button>
      )}
      {meu && confirmando && (
        <div className="equipe-confirmar" role="group" aria-label="Confirmar check-out">
          <p className="lista-sub">Registrar a sua saída do serviço?</p>
          <button type="button" className="botao" disabled={ocupado || !online} onClick={fazerCheckout}>
            Confirmar check-out
          </button>
          <button type="button" className="botao botao-secundario" onClick={() => setConfirmando(false)}>
            Cancelar
          </button>
        </div>
      )}
      {!meu && dados.participa && (
        <>
          {!dados.tem_localizacao && (
            <p className="lista-sub">A localização da etapa não está cadastrada; o check-in fica indisponível.</p>
          )}
          <button
            type="button"
            className="botao"
            disabled={ocupado || !online || !dados.tem_localizacao}
            onClick={() => void fazerCheckin()}
          >
            {obtendo ? 'Obtendo localização…' : checkin.isPending ? 'Registrando entrada…' : 'Fazer check-in'}
          </button>
        </>
      )}
      {!online && (dados.participa || meu) && <p className="lista-sub">Sem conexão</p>}
      {erro && (
        <p className="erro-texto" role="alert">
          {erro}
        </p>
      )}
      {erroLocal?.abrirAjustes && (
        <button type="button" className="botao botao-secundario" onClick={erroLocal.abrirAjustes}>
          Abrir ajustes de localização
        </button>
      )}
    </>
  )
}
