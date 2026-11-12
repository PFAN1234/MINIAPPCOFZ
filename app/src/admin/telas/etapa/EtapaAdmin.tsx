/**
 * Página de uma etapa (`/etapas/:slug`): nome e ordem, grupo do Telegram, obras da etapa e
 * arquivar ou excluir. E a criação (`/nova-etapa`).
 */
import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ComDados, mensagemDe, Resultado } from '../../componentes.tsx'
import { useDesvincularEtapa, useEtapas, useObrasAdmin, useSalvarEtapa } from '../../dados/hooks.ts'
import type { EtapaLista } from '../../dados/tipos.ts'
import { TabelaObras } from '../ObrasAdmin.tsx'
import { data } from '../obra/ArquivarExcluir.tsx'
import ArquivarExcluirEtapa from './ArquivarExcluirEtapa.tsx'

const SLUG = /^[a-z0-9-]+$/

function inteiro(texto: string): number | null {
  return /^-?\d{1,9}$/.test(texto.trim()) ? Number(texto) : null
}

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
  const [salvo, setSalvo] = useState<string | null>(null)
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
            <DadosDaEtapa
              key={`${etapa.nome}|${etapa.ordem}`}
              etapa={etapa}
              sucesso={salvo}
              onSalvo={() => setSalvo('Etapa salva.')}
            />
            <GrupoTelegram etapa={etapa} />
            <ObrasDaEtapa etapa={etapa} />
            <ArquivarExcluirEtapa etapa={etapa} />
          </article>
        )
      }}
    </ComDados>
  )
}

// --- Nova etapa ------------------------------------------------------------------------------

export function NovaEtapa() {
  const salvar = useSalvarEtapa()
  const navegar = useNavigate()
  const [slug, setSlug] = useState('')
  const [nome, setNome] = useState('')
  const [ordem, setOrdem] = useState('0')
  const [aviso, setAviso] = useState<string | null>(null)

  function enviar(e: FormEvent) {
    e.preventDefault()
    const n = inteiro(ordem)
    if (!SLUG.test(slug) || slug.length > 40) {
      return setAviso('Slug inválido: use letras minúsculas, dígitos e hífen (até 40 caracteres).')
    }
    if (!nome.trim()) return setAviso('Informe o nome da etapa.')
    if (n === null) return setAviso('A ordem precisa ser um número inteiro.')
    setAviso(null)
    salvar.mutate({ slug, nome: nome.trim(), ordem: n }, { onSuccess: (et) => navegar(`/etapas/${et.slug}`) })
  }

  return (
    <section aria-labelledby="titulo-nova-etapa">
      <p>
        <Link to="/">← Etapas</Link>
      </p>
      <h1 id="titulo-nova-etapa">Nova etapa</h1>
      <form className="adm-form" onSubmit={enviar}>
        <label>
          Slug
          <input value={slug} onChange={(e) => setSlug(e.target.value.trim())} placeholder="ex.: 3a-etapa" required />
          <span className="adm-dica">
            Letras minúsculas, dígitos e hífen. Vai no comando <code>/vincular_etapa</code> e não muda depois de criado.
          </span>
        </label>
        <label>
          Nome
          <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} placeholder="ex.: 3ª ETAPA" required />
        </label>
        <label>
          Ordem
          <input value={ordem} onChange={(e) => setOrdem(e.target.value)} inputMode="numeric" />
          <span className="adm-dica">Posição na lista de etapas do site e no seletor do Mini App.</span>
        </label>
        <Resultado sucesso={null} erro={aviso ? new Error(aviso) : salvar.error} />
        <div>
          <button type="submit" className="adm-botao adm-botao-principal" disabled={salvar.isPending}>
            Criar etapa
          </button>
        </div>
      </form>
    </section>
  )
}

// --- Dados da etapa --------------------------------------------------------------------------

function DadosDaEtapa({ etapa, sucesso, onSalvo }: { etapa: EtapaLista; sucesso: string | null; onSalvo: () => void }) {
  const salvar = useSalvarEtapa()
  const [nome, setNome] = useState(etapa.nome)
  const [ordem, setOrdem] = useState(String(etapa.ordem))
  const [aviso, setAviso] = useState<string | null>(null)

  function enviar(e: FormEvent) {
    e.preventDefault()
    const n = inteiro(ordem)
    if (!nome.trim()) return setAviso('Informe o nome da etapa.')
    if (n === null) return setAviso('A ordem precisa ser um número inteiro.')
    setAviso(null)
    salvar.mutate({ id: etapa.id, nome: nome.trim(), ordem: n }, { onSuccess: onSalvo })
  }

  return (
    <section className="adm-secao" aria-labelledby="titulo-dados-etapa">
      <h2 id="titulo-dados-etapa">Dados da etapa</h2>
      <form className="adm-form" onSubmit={enviar}>
        <label>
          Slug
          <input value={etapa.slug} readOnly disabled />
        </label>
        <label>
          Nome
          <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} required />
        </label>
        <label>
          Ordem
          <input value={ordem} onChange={(e) => setOrdem(e.target.value)} inputMode="numeric" />
        </label>
        <Resultado sucesso={sucesso} erro={aviso ? new Error(aviso) : salvar.error} />
        <div>
          <button type="submit" className="adm-botao adm-botao-principal" disabled={salvar.isPending}>
            Salvar etapa
          </button>
        </div>
      </form>
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
