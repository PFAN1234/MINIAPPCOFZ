/** Tabelas da aba Boletins: pedidos ainda não emitidos e boletins emitidos (todas as etapas ou uma). */
import { useState } from 'react'
import { Link } from 'react-router'
import { mensagemDe } from '../../componentes.tsx'
import { useReenviarBoletim, useUrlPdfBoletim } from '../../dados/hooks.ts'
import type { BoletimDaLista, PedidoDaLista } from '../../dados/tipos.ts'
import { dataBr, dataHoraBr } from '../../formato.ts'
import { abrir, ROTULO_ESTADO, rotuloPublicacao } from './util.ts'

export function Pedidos({ pedidos }: { pedidos: PedidoDaLista[] }) {
  if (pedidos.length === 0) return null
  return (
    <div className="adm-rolagem">
      <table className="adm-tabela" aria-label="Pedidos de emissão">
        <thead>
          <tr>
            <th scope="col">Etapa</th>
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
              <td>{p.etapa_nome}</td>
              <td>{dataBr(p.data)}</td>
              <td>
                {p.revisao > 0 ? `R${p.revisao}` : 'original'}
                {p.editado && <span className="adm-selo"> editado</span>}
              </td>
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

const AVISO_INCERTO =
  'O envio pode ter chegado ao grupo. Confira no Telegram antes: reenviar pode duplicar a mensagem. Reenviar mesmo assim?'

export function Emitidos({ boletins }: { boletins: BoletimDaLista[] }) {
  const url = useUrlPdfBoletim()
  const [bloqueado, setBloqueado] = useState<string | null>(null)
  if (boletins.length === 0) return <p className="adm-dica">Nenhum boletim emitido no período.</p>
  return (
    <>
      <div className="adm-rolagem">
        <table className="adm-tabela" aria-label="Boletins emitidos">
          <thead>
            <tr>
              <th scope="col">Número</th>
              <th scope="col">Etapa</th>
              <th scope="col">Data</th>
              <th scope="col">Emitido em</th>
              <th scope="col">Por</th>
              <th scope="col">Telegram</th>
              <th scope="col">
                <span className="adm-oculto">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {boletins.map((b) => (
              <LinhaEmitido key={b.id} b={b} onAbrirPdf={() => url.mutate(b.pdf_path!, { onSuccess: (u) => setBloqueado(abrir(u) ? null : u) })} abrindo={url.isPending} />
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

function LinhaEmitido({ b, onAbrirPdf, abrindo }: { b: BoletimDaLista; onAbrirPdf: () => void; abrindo: boolean }) {
  const reenviar = useReenviarBoletim(b.etapa_slug)

  function pedirReenvio() {
    if (b.publicacao_estado === 'incerto' && !window.confirm(AVISO_INCERTO)) return
    reenviar.mutate(b.id)
  }

  return (
    <tr>
      <td>
        {b.numero}
        {b.editado && (
          <>
            {' '}
            <span className="adm-selo">editado</span>
            {b.base_numero && <span className="adm-dica"> a partir de {b.base_numero}</span>}
          </>
        )}
        {b.tem_rascunho && (
          <>
            {' '}
            <span className="adm-selo">rascunho</span>
          </>
        )}
      </td>
      <td>{b.etapa_nome}</td>
      <td>{dataBr(b.data)}</td>
      <td>{dataHoraBr(b.emitido_em)}</td>
      <td>{b.emitido_por_nome ?? 'automático'}</td>
      <td>
        {rotuloPublicacao(b)}
        {b.publicacao_erro && <p className="adm-dica">{b.publicacao_erro}</p>}
        {reenviar.isError && (
          <p className="adm-alerta adm-alerta-erro" role="alert">
            {mensagemDe(reenviar.error)}
          </p>
        )}
      </td>
      <td className="adm-acoes">
        {(b.publicacao_estado === 'falhou' || b.publicacao_estado === 'incerto') && (
          <button
            type="button"
            className="adm-botao"
            aria-label={`Reenviar ${b.numero} ao Telegram`}
            disabled={reenviar.isPending}
            onClick={pedirReenvio}
          >
            Reenviar ao Telegram
          </button>
        )}
        <button
          type="button"
          className="adm-botao"
          aria-label={`Abrir PDF de ${b.numero}`}
          disabled={!b.pdf_path || abrindo}
          onClick={onAbrirPdf}
        >
          Abrir PDF
        </button>
        <Link className="adm-botao" to={`/boletins/${b.id}`} aria-label={`Editar ${b.numero}`}>
          Editar
        </Link>
      </td>
    </tr>
  )
}
