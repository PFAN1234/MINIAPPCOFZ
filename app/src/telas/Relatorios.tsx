import { useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { EstadoConsulta } from '../components/Estado.tsx'
import { TopoTela } from '../components/TopoTela.tsx'
import { useRepositorio } from '../dados/contexto.tsx'
import { useEmitirBoletim, useExcluirBoletim, useRelatorios } from '../dados/hooks.ts'
import type { BoletimRelatorio, EtapaRelatorio, ResultadoExclusaoBoletim } from '../dados/tipos.ts'
import { abrirLink } from '../telegram.ts'
import { FUSO_PADRAO, formatarDia, horaNoFuso } from '../util/fuso.ts'

function mensagemDe(e: unknown, padrao: string): string {
  return e instanceof Error && e.message ? e.message : padrao
}

/** `AAAA-MM-DD` → `dd/mm`. */
function diaMes(data: string): string {
  return formatarDia(data).slice(0, 5)
}

function textoExclusao(r: ResultadoExclusaoBoletim): string {
  let t = `Boletim ${r.numero} excluído.`
  if (r.mensagens.falhas > 0) {
    t +=
      ' Não foi possível apagar a mensagem no grupo do Telegram (o Telegram só permite apagar até 48 h depois do envio): apague-a lá manualmente.'
  } else if (r.mensagens.apagadas > 0) {
    t += ' A mensagem foi apagada do grupo.'
  }
  if (r.arquivos_erro) t += ' Os PDFs não foram removidos do armazenamento.'
  return t
}

/** "Abrir PDF": pega a URL assinada e abre; o erro vira aviso na tela. */
function useAbrirPdf() {
  const repo = useRepositorio()
  const [erro, setErro] = useState<string | null>(null)
  async function abrir(caminho: string) {
    setErro(null)
    try {
      abrirLink(await repo.urlPdfBoletim(caminho))
    } catch (e) {
      setErro(mensagemDe(e, 'Não foi possível abrir o PDF. Tente de novo.'))
    }
  }
  return { abrir, erro }
}

function CartaoHoje({
  etapa,
  admin,
  pdfPath,
  onAbrirPdf,
}: {
  etapa: EtapaRelatorio
  admin: boolean
  pdfPath: string | null
  onAbrirPdf: (caminho: string) => void
}) {
  const emitir = useEmitirBoletim()
  const boletim = etapa.boletim_hoje
  const estado = etapa.pedido_hoje?.estado
  const emAndamento = estado === 'pendente' || estado === 'gerando'
  const falhou = estado === 'falhou'

  function pedirEmissao() {
    const dia = diaMes(etapa.hoje)
    const texto = boletim
      ? `Emitir agora o boletim de ${dia} da ${etapa.nome}? Será uma nova revisão, publicada no grupo do Telegram.`
      : `Emitir agora o boletim de ${dia} da ${etapa.nome}? Ele será publicado no grupo do Telegram.`
    if (!window.confirm(texto)) return
    emitir.mutate({ slug: etapa.slug, data: etapa.hoje })
  }

  let situacao: ReactNode
  if (emAndamento) situacao = 'Gerando o boletim…'
  else if (falhou) situacao = etapa.pedido_hoje?.erro ? `A emissão falhou: ${etapa.pedido_hoje.erro}` : 'A emissão falhou'
  else if (boletim) situacao = `Boletim ${boletim.numero} emitido às ${horaNoFuso(boletim.emitido_em, FUSO_PADRAO)}`
  else situacao = `Ainda não emitido · sai automaticamente às ${etapa.horario}`

  const n = etapa.registros_hoje
  const registros = n === 0 ? 'Nenhum registro hoje' : n === 1 ? '1 registro hoje' : `${n} registros hoje`

  return (
    <article className="cartao relatorio-cartao" aria-label={`Hoje, ${etapa.nome}`}>
      <h3 className="relatorio-titulo">
        {etapa.nome} <span className="relatorio-dica">{diaMes(etapa.hoje)}</span>
      </h3>
      <p>{situacao}</p>
      <p className="relatorio-dica">{registros}</p>
      <div className="relatorio-acoes">
        {boletim && (
          <button
            type="button"
            className="botao botao-secundario"
            disabled={!pdfPath}
            onClick={() => pdfPath && onAbrirPdf(pdfPath)}
          >
            Abrir PDF
          </button>
        )}
        {admin && (
          <button type="button" className="botao" disabled={emAndamento || emitir.isPending} onClick={pedirEmissao}>
            {boletim ? 'Emitir revisão' : 'Emitir agora'}
          </button>
        )}
      </div>
      {emitir.isError && (
        <p className="relatorio-erro" role="alert">
          {mensagemDe(emitir.error, 'Não foi possível pedir a emissão. Tente de novo.')}
        </p>
      )}
    </article>
  )
}

function LinhaBoletim({
  b,
  admin,
  onAbrirPdf,
  onExcluido,
}: {
  b: BoletimRelatorio
  admin: boolean
  onAbrirPdf: (caminho: string) => void
  onExcluido: (r: ResultadoExclusaoBoletim) => void
}) {
  const excluir = useExcluirBoletim()

  function pedirExclusao() {
    const msg = `Excluir o boletim ${b.numero}? Sai o dia ${formatarDia(b.data)} inteiro, com as revisões, os PDFs e a mensagem no grupo do Telegram. Não dá para desfazer.`
    if (!window.confirm(msg)) return
    excluir.mutate(b.id, { onSuccess: onExcluido })
  }

  return (
    <li className="cartao relatorio-linha">
      <div className="relatorio-linha-topo">
        <strong>{b.numero}</strong>
        {b.publicado && <span className="selo selo-resolvida">Publicado no grupo</span>}
      </div>
      <p>
        {b.etapa_nome} · {formatarDia(b.data)}
        {b.revisao > 0 ? ` · Revisão ${b.revisao}` : ''}
      </p>
      <div className="relatorio-acoes">
        <button
          type="button"
          className="botao botao-secundario"
          disabled={!b.pdf_path}
          aria-label={`Abrir PDF do boletim ${b.numero}`}
          onClick={() => b.pdf_path && onAbrirPdf(b.pdf_path)}
        >
          Abrir PDF
        </button>
        {admin && b.ultima_revisao && (
          <button
            type="button"
            className="botao botao-perigo"
            disabled={excluir.isPending}
            aria-label={`Excluir o boletim ${b.numero}`}
            onClick={pedirExclusao}
          >
            Excluir
          </button>
        )}
      </div>
      {excluir.isError && (
        <p className="relatorio-erro" role="alert">
          {mensagemDe(excluir.error, 'Não foi possível excluir. Tente de novo.')}
        </p>
      )}
    </li>
  )
}

/** Boletins diários de obra: situação de hoje por etapa e a lista dos emitidos (admin emite e exclui). */
export default function Relatorios() {
  const [params, setParams] = useSearchParams()
  const consulta = useRelatorios()
  const pdf = useAbrirPdf()
  const [aviso, setAviso] = useState<string | null>(null)
  const filtro = params.get('etapa') ?? ''

  function mudarEtapa(slug: string) {
    const prox = new URLSearchParams(params)
    if (slug) prox.set('etapa', slug)
    else prox.delete('etapa')
    setParams(prox, { replace: true })
  }

  return (
    <section aria-labelledby="titulo-relatorios">
      <TopoTela titulo="Relatórios" idTitulo="titulo-relatorios" />
      <EstadoConsulta consulta={consulta}>
        {({ admin, etapas, boletins }) => {
          const etapasVistas = filtro ? etapas.filter((e) => e.slug === filtro) : etapas
          const emitidos = filtro ? boletins.filter((b) => b.etapa_slug === filtro) : boletins
          return (
            <>
              {etapas.length > 1 && (
                <select
                  className="filtro-select"
                  aria-label="Filtrar por etapa"
                  value={filtro}
                  onChange={(e) => mudarEtapa(e.target.value)}
                >
                  <option value="">Todas as etapas</option>
                  {etapas.map((e) => (
                    <option key={e.id} value={e.slug}>
                      {e.nome}
                    </option>
                  ))}
                </select>
              )}
              {pdf.erro && (
                <p className="relatorio-erro" role="alert">
                  {pdf.erro}
                </p>
              )}
              {aviso && (
                <p className="relatorio-aviso" role="status">
                  {aviso}
                </p>
              )}
              <h2 className="relatorio-secao">Hoje</h2>
              {etapasVistas.map((e) => (
                <CartaoHoje
                  key={e.id}
                  etapa={e}
                  admin={admin}
                  pdfPath={boletins.find((b) => b.id === e.boletim_hoje?.id)?.pdf_path ?? null}
                  onAbrirPdf={pdf.abrir}
                />
              ))}
              <h2 className="relatorio-secao">Emitidos</h2>
              {emitidos.length === 0 ? (
                <p className="relatorio-dica">Nenhum boletim emitido ainda.</p>
              ) : (
                <ul className="lista-cartoes relatorio-lista">
                  {emitidos.map((b) => (
                    <LinhaBoletim
                      key={b.id}
                      b={b}
                      admin={admin}
                      onAbrirPdf={pdf.abrir}
                      onExcluido={(r) => setAviso(textoExclusao(r))}
                    />
                  ))}
                </ul>
              )}
            </>
          )
        }}
      </EstadoConsulta>
    </section>
  )
}
