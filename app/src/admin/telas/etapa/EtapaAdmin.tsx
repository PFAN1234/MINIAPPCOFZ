/**
 * Página de uma etapa (`/etapas/:slug`): cadastro (identificação, localização e contrato), o que
 * falta para o boletim, responsáveis, aditivos, boletins (emitidos, prévia e emissão), grupo do
 * Telegram, obras da etapa e arquivar ou excluir. E a criação (`/nova-etapa`).
 */
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ComDados, mensagemDe } from '../../componentes.tsx'
import { useDesvincularEtapa, useEtapa, useEtapas, useObrasAdmin } from '../../dados/hooks.ts'
import { ROTULO_FALTANDO, type EtapaLista } from '../../dados/tipos.ts'
import { TabelaObras } from '../ObrasAdmin.tsx'
import { data } from '../obra/ArquivarExcluir.tsx'
import Aditivos from './Aditivos.tsx'
import ArquivarExcluirEtapa from './ArquivarExcluirEtapa.tsx'
import Boletins from './Boletins.tsx'
import FormularioEtapa, { chaveDoCadastro } from './FormularioEtapa.tsx'
import Responsaveis from './Responsaveis.tsx'

export function AvisoEtapaArquivada({ arquivadaEm }: { arquivadaEm: string }) {
  return (
    <p className="adm-alerta adm-alerta-aviso" role="status">
      Etapa arquivada em {data(arquivadaEm)}: as obras dela não aparecem no Mini App, ninguém registra nada nelas e nada
      é publicado no Telegram. Ao desarquivar, cada obra volta ao estado que tinha.
    </p>
  )
}

export default function EtapaAdmin() {
  const { slug = '' } = useParams()
  const etapas = useEtapas()
  const detalhe = useEtapa(slug)
  const [salvo, setSalvo] = useState<string | null>(null)
  // A lista traz arquivamento, grupo e contagens; o detalhe, o cadastro do boletim.
  return (
    <ComDados consulta={etapas}>
      {(lista) => {
        const etapa = lista.find((e) => e.slug === slug)
        if (!etapa) {
          return (
            <>
              <p>
                <Link to="/">← Etapas</Link>
              </p>
              <p className="adm-alerta adm-alerta-erro" role="alert">
                Etapa não encontrada.
              </p>
            </>
          )
        }
        return (
          <article aria-labelledby="titulo-etapa">
            <p>
              <Link to="/">← Etapas</Link>
            </p>
            <h1 id="titulo-etapa">{etapa.nome}</h1>
            {etapa.arquivada_em && <AvisoEtapaArquivada arquivadaEm={etapa.arquivada_em} />}
            <ComDados consulta={detalhe}>
              {(d) => (
                <>
                  <FaltamParaOBoletim faltando={d.faltando} />
                  <FormularioEtapa
                    key={chaveDoCadastro(d)}
                    etapa={d}
                    sucesso={salvo}
                    onSalvo={() => setSalvo('Etapa salva.')}
                  />
                  <Responsaveis etapaId={d.id} atuais={d.responsaveis} />
                  <Aditivos etapa={d} />
                  <Boletins etapa={d} telegramVinculado={etapa.telegram_vinculado} />
                </>
              )}
            </ComDados>
            <GrupoTelegram etapa={etapa} />
            <ObrasDaEtapa etapa={etapa} />
            <ArquivarExcluirEtapa etapa={etapa} />
          </article>
        )
      }}
    </ComDados>
  )
}

/** Aviso com os campos do cadastro que ainda estão vazios (não aparece com o cadastro completo). */
export function FaltamParaOBoletim({ faltando }: { faltando: string[] }) {
  if (faltando.length === 0) return null
  return (
    <p className="adm-alerta adm-alerta-aviso" role="status">
      Faltam para o boletim: {faltando.map((f) => ROTULO_FALTANDO[f] ?? f).join(', ')}.
    </p>
  )
}

// --- Nova etapa ------------------------------------------------------------------------------

export function NovaEtapa() {
  const navegar = useNavigate()
  return (
    <section aria-labelledby="titulo-nova-etapa">
      <p>
        <Link to="/">← Etapas</Link>
      </p>
      <h1 id="titulo-nova-etapa">Nova etapa</h1>
      <FormularioEtapa etapa={null} onSalvo={(et) => navegar(`/etapas/${et.slug}`)} />
    </section>
  )
}

// --- Grupo do Telegram -----------------------------------------------------------------------

function GrupoTelegram({ etapa }: { etapa: EtapaLista }) {
  const desvincular = useDesvincularEtapa(etapa.slug)
  const [confirmando, setConfirmando] = useState(false)
  return (
    <section className="adm-secao" aria-labelledby="titulo-grupo">
      <h2 id="titulo-grupo">Grupo do Telegram</h2>
      {etapa.telegram_vinculado ? (
        <>
          <p>
            Vinculado ao grupo{' '}
            {etapa.telegram_chat_titulo ? <strong>{etapa.telegram_chat_titulo}</strong> : '(título não registrado)'}. Cada
            obra da etapa publica no tópico dela, ligado com <code>/vincular_obra &lt;slug da obra&gt;</code> dentro do
            tópico.
          </p>
          <p className="adm-dica">
            Desvincular solta o grupo desta etapa e os tópicos de todas as obras dela; as publicações param até vincular
            de novo. As mensagens já publicadas continuam no grupo.
          </p>
          {confirmando ? (
            <div className="adm-acoes">
              <button
                type="button"
                className="adm-botao adm-botao-perigo"
                disabled={desvincular.isPending}
                onClick={() => desvincular.mutate(undefined, { onSuccess: () => setConfirmando(false) })}
              >
                Confirmar: desvincular o grupo de {etapa.nome}
              </button>
              <button type="button" className="adm-botao" onClick={() => setConfirmando(false)}>
                Cancelar
              </button>
            </div>
          ) : (
            <button type="button" className="adm-botao" onClick={() => setConfirmando(true)}>
              Desvincular grupo
            </button>
          )}
        </>
      ) : (
        <>
          <p>Nenhum grupo vinculado.</p>
          <ol className="adm-passos">
            <li>No Telegram, crie um supergrupo com tópicos para a etapa e inclua o bot como admin.</li>
            <li>
              Um admin do grupo envia, em qualquer tópico: <code className="adm-comando">/vincular_etapa {etapa.slug}</code>
            </li>
            <li>
              Depois, em cada tópico, <code>/vincular_obra &lt;slug da obra&gt;</code> liga a obra ao tópico.
            </li>
          </ol>
        </>
      )}
      {desvincular.isError && (
        <p className="adm-alerta adm-alerta-erro" role="alert">
          {mensagemDe(desvincular.error)}
        </p>
      )}
    </section>
  )
}

// --- Obras da etapa --------------------------------------------------------------------------

function ObrasDaEtapa({ etapa }: { etapa: EtapaLista }) {
  const obras = useObrasAdmin()
  return (
    <section className="adm-secao" aria-labelledby="titulo-obras-etapa">
      <div className="adm-titulo-linha">
        <h2 id="titulo-obras-etapa">Obras da etapa</h2>
        <Link className="adm-botao adm-botao-principal" to={`/nova-obra?etapa=${encodeURIComponent(etapa.slug)}`}>
          Nova obra
        </Link>
      </div>
      <ComDados consulta={obras}>
        {(lista) => {
          const daEtapa = lista.filter((o) => o.etapa_id === etapa.id)
          return daEtapa.length === 0 ? (
            <p className="adm-dica">Nenhuma obra nesta etapa.</p>
          ) : (
            <TabelaObras obras={daEtapa} rotulo={`Obras de ${etapa.nome}`} />
          )
        }}
      </ComDados>
    </section>
  )
}
