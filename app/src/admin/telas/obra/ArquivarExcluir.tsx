/**
 * Fim da página da obra: arquivar (some do Mini App e para de publicar no Telegram; nada é
 * apagado e dá para desarquivar) e excluir de vez (apaga a obra, tudo dela e os arquivos no
 * Storage, com confirmação digitando o nome). A exclusão roda na Edge Function `admin-excluir-obra`.
 */
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { mensagemDe } from '../../componentes.tsx'
import { useArquivarObra, useExcluirObra, useResumoObra } from '../../dados/hooks.ts'
import type { ObraAdmin, ResumoObra } from '../../dados/tipos.ts'

export interface AvisoObras {
  aviso: string
  tipo: 'ok' | 'aviso'
}

const data = (iso: string) => new Date(iso).toLocaleString('pt-BR')

export function AvisoArquivada({ arquivadaEm }: { arquivadaEm: string }) {
  return (
    <p className="adm-alerta adm-alerta-aviso" role="status">
      Obra arquivada em {data(arquivadaEm)}: não aparece no Mini App, ninguém registra nada nela e nada é publicado no
      Telegram. Os dados continuam guardados; para voltar, use "Desarquivar obra" no fim da página.
    </p>
  )
}

export default function ArquivarExcluir({ obra }: { obra: ObraAdmin['obra'] }) {
  return (
    <section className="adm-secao adm-secao-perigo" aria-labelledby="titulo-arquivar-excluir">
      <h2 id="titulo-arquivar-excluir">Arquivar ou excluir</h2>
      <Arquivar obra={obra} />
      <Excluir obra={obra} />
    </section>
  )
}

function Arquivar({ obra }: { obra: ObraAdmin['obra'] }) {
  const arquivar = useArquivarObra(obra.slug)
  const [confirmando, setConfirmando] = useState(false)
  const arquivada = !!obra.arquivada_em
  return (
    <div className="adm-bloco">
      <h3>{arquivada ? 'Desarquivar' : 'Arquivar'}</h3>
      <p className="adm-dica">
        {arquivada
          ? 'A obra volta para o Mini App de quem participa dela, e as publicações no Telegram voltam a sair (inclusive as que ficaram na fila enquanto ela estava arquivada).'
          : 'Para obra concluída: some do Mini App de todos (inclusive dos gestores), ninguém registra nada nela e nada é publicado no Telegram. Nada é apagado; dá para desarquivar aqui depois.'}
      </p>
      {arquivada ? (
        <button
          type="button"
          className="adm-botao"
          disabled={arquivar.isPending}
          onClick={() => arquivar.mutate(false)}
        >
          Desarquivar obra
        </button>
      ) : confirmando ? (
        <div className="adm-acoes">
          <button
            type="button"
            className="adm-botao adm-botao-principal"
            disabled={arquivar.isPending}
            onClick={() => arquivar.mutate(true, { onSuccess: () => setConfirmando(false) })}
          >
            Confirmar: arquivar {obra.nome}
          </button>
          <button type="button" className="adm-botao" onClick={() => setConfirmando(false)}>
            Cancelar
          </button>
        </div>
      ) : (
        <button type="button" className="adm-botao" onClick={() => setConfirmando(true)}>
          Arquivar obra
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

function linhasResumo(r: ResumoObra): string[] {
  const n = (v: number, um: string, varios: string) => `${v.toLocaleString('pt-BR')} ${v === 1 ? um : varios}`
  const arquivos = Object.values(r.arquivos ?? {}).reduce((s, v) => s + (v ?? 0), 0)
  return [
    n(r.registros, 'registro', 'registros'),
    n(r.fotos, 'foto', 'fotos'),
    n(r.ambientes, 'ambiente', 'ambientes'),
    n(r.pavimentos, 'pavimento', 'pavimentos'),
    n(r.plantas, 'planta', 'plantas'),
    n(r.modelos, 'modelo 3D', 'modelos 3D'),
    n(r.participantes, 'participante', 'participantes'),
    n(r.publicacoes_telegram, 'publicação no Telegram', 'publicações no Telegram'),
    `${n(arquivos, 'arquivo', 'arquivos')} no Storage (fotos ${r.arquivos?.fotos ?? 0}, plantas ${r.arquivos?.plantas ?? 0}, PDFs ${r.arquivos?.originais ?? 0}, modelos ${r.arquivos?.modelos ?? 0})`,
  ]
}

function Excluir({ obra }: { obra: ObraAdmin['obra'] }) {
  const [aberto, setAberto] = useState(false)
  const [texto, setTexto] = useState('')
  const resumo = useResumoObra(obra.slug, aberto)
  const excluir = useExcluirObra(obra.slug)
  const qc = useQueryClient()
  const navegar = useNavigate()
  const confere = texto.trim() === obra.nome

  function confirmar() {
    excluir.mutate(texto, {
      onSuccess: (r) => {
        qc.removeQueries({ queryKey: ['admin', 'obra', obra.slug] })
        void qc.invalidateQueries({ queryKey: ['admin'], predicate: (q) => q.queryKey[1] !== 'sessao' })
        const estado: AvisoObras = r.pendente
          ? {
              tipo: 'aviso',
              aviso: `Obra ${obra.nome} excluída, mas parte dos arquivos ficou no Storage (${r.erro ?? 'erro ao remover'}). Use "Tentar de novo" em Exclusões.`,
            }
          : { tipo: 'ok', aviso: `Obra ${obra.nome} excluída, com todos os dados e arquivos.` }
        void navegar('/', { state: estado })
      },
    })
  }

  return (
    <div className="adm-bloco">
      <h3>Excluir de vez</h3>
      <p className="adm-dica">
        Apaga a obra e tudo dela: registros, fotos, pendências, ambientes, plantas, PDFs, modelos 3D, participantes e
        histórico, inclusive os arquivos no Storage. <strong>Não dá para desfazer.</strong> As mensagens já publicadas no
        Telegram continuam no grupo. Para obra concluída, prefira arquivar.
      </p>
      {!aberto ? (
        <button type="button" className="adm-botao adm-botao-perigo" onClick={() => setAberto(true)}>
          Excluir obra…
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
              <p>Será apagado de vez:</p>
              <ul aria-label="O que será apagado">
                {linhasResumo(resumo.data).map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </div>
          )}
          <label>
            Para confirmar, digite o nome da obra: <strong>{obra.nome}</strong>
            <input value={texto} autoComplete="off" onChange={(e) => setTexto(e.target.value)} disabled={excluir.isPending} />
          </label>
          <div className="adm-acoes">
            <button
              type="button"
              className="adm-botao adm-botao-perigo"
              disabled={!confere || excluir.isPending || !resumo.data}
              onClick={confirmar}
            >
              {excluir.isPending ? 'Excluindo…' : `Excluir ${obra.nome} definitivamente`}
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
