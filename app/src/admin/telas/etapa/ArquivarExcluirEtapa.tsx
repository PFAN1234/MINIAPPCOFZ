/**
 * Fim da página da etapa, no mesmo desenho do da obra (`obra/ArquivarExcluir.tsx`): arquivar
 * (vale como arquivar todas as obras dela, sem mexer no arquivamento de cada uma; reversível) e
 * excluir de vez (apaga a etapa e todas as obras, com os arquivos; confirmação digitando o nome).
 * A exclusão roda na Edge Function `admin-excluir-obra`, ação `excluir_etapa`.
 */
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { mensagemDe } from '../../componentes.tsx'
import { useArquivarEtapa, useExcluirEtapa, useResumoEtapa } from '../../dados/hooks.ts'
import type { EtapaLista } from '../../dados/tipos.ts'
import { linhasResumo, type AvisoObras } from '../obra/ArquivarExcluir.tsx'

export default function ArquivarExcluirEtapa({ etapa }: { etapa: EtapaLista }) {
  return (
    <section className="adm-secao adm-secao-perigo" aria-labelledby="titulo-arquivar-excluir-etapa">
      <h2 id="titulo-arquivar-excluir-etapa">Arquivar ou excluir</h2>
      <Arquivar etapa={etapa} />
      <Excluir etapa={etapa} />
    </section>
  )
}

function Arquivar({ etapa }: { etapa: EtapaLista }) {
  const arquivar = useArquivarEtapa(etapa.slug)
  const [confirmando, setConfirmando] = useState(false)
  const arquivada = !!etapa.arquivada_em
  return (
    <div className="adm-bloco">
      <h3>{arquivada ? 'Desarquivar' : 'Arquivar'}</h3>
      <p className="adm-dica">
        {arquivada
          ? 'As obras da etapa voltam ao estado que tinham: as ativas voltam ao Mini App e as publicações no Telegram voltam a sair (inclusive as que ficaram na fila). Obras arquivadas uma a uma continuam arquivadas.'
          : 'Para etapa concluída: todas as obras dela somem do Mini App, ninguém registra nada nelas e nada é publicado no Telegram. Nada é apagado e o arquivamento de cada obra não muda; dá para desarquivar aqui depois.'}
      </p>
      {arquivada ? (
        <button type="button" className="adm-botao" disabled={arquivar.isPending} onClick={() => arquivar.mutate(false)}>
          Desarquivar etapa
        </button>
      ) : confirmando ? (
        <div className="adm-acoes">
          <button
            type="button"
            className="adm-botao adm-botao-principal"
            disabled={arquivar.isPending}
            onClick={() => arquivar.mutate(true, { onSuccess: () => setConfirmando(false) })}
          >
            Confirmar: arquivar {etapa.nome}
          </button>
          <button type="button" className="adm-botao" onClick={() => setConfirmando(false)}>
            Cancelar
          </button>
        </div>
      ) : (
        <button type="button" className="adm-botao" onClick={() => setConfirmando(true)}>
          Arquivar etapa
        </button>
      )}
      {arquivar.isError && (
        <p className="adm-alerta adm-alerta-erro" role="alert">
          {mensagemDe(arquivar.error)}
        </p>
      )}
    </div>
  )
}

function Excluir({ etapa }: { etapa: EtapaLista }) {
  const [aberto, setAberto] = useState(false)
  const [texto, setTexto] = useState('')
  const resumo = useResumoEtapa(etapa.slug, aberto)
  const excluir = useExcluirEtapa(etapa.slug)
  const qc = useQueryClient()
  const navegar = useNavigate()
  const confere = texto.trim() === etapa.nome

  function confirmar() {
    excluir.mutate(texto, {
      onSuccess: (r) => {
        qc.removeQueries({ queryKey: ['admin', 'resumo-etapa', etapa.slug] })
        void qc.invalidateQueries({ queryKey: ['admin'], predicate: (q) => q.queryKey[1] !== 'sessao' })
        const n = r.exclusoes.length
        const obras = n === 0 ? 'sem obras' : n === 1 ? 'com 1 obra' : `com ${n} obras`
        const estado: AvisoObras = r.pendente
          ? {
              tipo: 'aviso',
              aviso: `Etapa ${etapa.nome} excluída (${obras}), mas parte dos arquivos ficou no Storage (${r.erro ?? 'erro ao remover'}). Use "Tentar de novo" em Obras excluídas.`,
            }
          : { tipo: 'ok', aviso: `Etapa ${etapa.nome} excluída ${obras}, com todos os dados e arquivos.` }
        void navegar('/', { state: estado })
      },
    })
  }

  return (
    <div className="adm-bloco">
      <h3>Excluir de vez</h3>
      <p className="adm-dica">
        Apaga a etapa e <strong>todas as obras dela</strong>, com tudo de cada obra: registros, fotos, pendências,
        ambientes, plantas, PDFs, modelos 3D, participantes e histórico, inclusive os arquivos no Storage.{' '}
        <strong>Não dá para desfazer.</strong> As mensagens já publicadas no Telegram continuam no grupo. Para etapa
        concluída, prefira arquivar.
      </p>
      {!aberto ? (
        <button type="button" className="adm-botao adm-botao-perigo" onClick={() => setAberto(true)}>
          Excluir etapa…
        </button>
      ) : (
        <div className="adm-form">
          {resumo.isPending && <p className="adm-estado">Contando o que será apagado…</p>}
          {resumo.isError && (
            <p className="adm-alerta adm-alerta-erro" role="alert">
              {mensagemDe(resumo.error)}
            </p>
          )}
          {resumo.data && (
            <div className="adm-alerta adm-alerta-erro">
              {resumo.data.obras.length === 0 ? (
                <p>A etapa não tem obras: só a etapa será apagada.</p>
              ) : (
                <>
                  <p>
                    {resumo.data.obras.length === 1 ? 'A obra abaixo será apagada' : `As ${resumo.data.obras.length} obras abaixo serão apagadas`}{' '}
                    de vez:
                  </p>
                  <ul aria-label="Obras que serão apagadas">
                    {resumo.data.obras.map((o) => (
                      <li key={o.slug}>
                        {o.nome} <code>{o.slug}</code>
                      </li>
                    ))}
                  </ul>
                  <p className="adm-alerta-subtitulo">Somando todas as obras:</p>
                  <ul aria-label="O que será apagado">
                    {linhasResumo(resumo.data.total).map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
          <label>
            Para confirmar, digite o nome da etapa: <strong>{etapa.nome}</strong>
            <input value={texto} autoComplete="off" onChange={(e) => setTexto(e.target.value)} disabled={excluir.isPending} />
          </label>
          <div className="adm-acoes">
            <button
              type="button"
              className="adm-botao adm-botao-perigo"
              disabled={!confere || excluir.isPending || !resumo.data}
              onClick={confirmar}
            >
              {excluir.isPending ? 'Excluindo…' : `Excluir ${etapa.nome} definitivamente`}
            </button>
            <button
              type="button"
              className="adm-botao"
              disabled={excluir.isPending}
              onClick={() => {
                setAberto(false)
                setTexto('')
                excluir.reset()
              }}
            >
              Cancelar
            </button>
          </div>
          {excluir.isError && (
            <p className="adm-alerta adm-alerta-erro" role="alert">
              {mensagemDe(excluir.error)}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
