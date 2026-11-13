/**
 * Editor do boletim emitido (rota `/boletins/:id`): mostra o snapshot em blocos parecidos com o PDF e
 * deixa trocar textos, ocultar itens e fotos. Salva rascunho, pré-visualiza e gera a retificação.
 * Contrato: docs/contrato-boletim.md, parte 4.
 */
import { useEffect, useRef, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ComDados, mensagemDe } from '../../componentes.tsx'
import {
  useBoletim,
  usePreviaBoletimEditado,
  useRetificarBoletim,
  useSalvarRascunhoBoletim,
  useUrlPdfBoletim,
  useUrlsFotos,
} from '../../dados/hooks.ts'
import type { BoletimDetalhe, EdicaoBoletim, FotoBoletim, SnapshotBoletim } from '../../dados/tipos.ts'
import { dataBr, dataHoraBr } from '../../formato.ts'
import { abrir, rotuloPublicacao } from './util.ts'

/** Remove o que está vazio, para comparar e enviar só o que importa. */
export function normalizar(e: EdicaoBoletim): EdicaoBoletim {
  const r: EdicaoBoletim = {}
  if (e.textos && Object.keys(e.textos).length > 0) r.textos = e.textos
  if (e.ocultos && e.ocultos.length > 0) r.ocultos = e.ocultos
  if (e.fotos_ocultas && e.fotos_ocultas.length > 0) r.fotos_ocultas = e.fotos_ocultas
  return r
}

function canonica(e: EdicaoBoletim): string {
  const n = normalizar(e)
  return JSON.stringify({
    t: Object.entries(n.textos ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    o: [...(n.ocultos ?? [])].sort(),
    f: [...(n.fotos_ocultas ?? [])].sort(),
  })
}

interface Ctx {
  edicao: EdicaoBoletim
  leitura: boolean
  urls: Record<string, string>
  texto: (chave: string, original: string) => string
  setTexto: (chave: string, valor: string, original: string) => void
  oculto: (chave: string) => boolean
  alternar: (chave: string) => void
  fotoOculta: (path: string) => boolean
  alternarFoto: (path: string) => void
}

function fotosDe(s: SnapshotBoletim): string[] {
  const r: string[] = []
  for (const o of s.obras) {
    for (const x of [...o.servicos, ...o.pendencias_abertas]) r.push(...x.fotos.map((f) => f.path))
    for (const p of o.pendencias_encerradas) r.push(...p.fotos_registro.map((f) => f.path), ...p.encerramento.fotos.map((f) => f.path))
  }
  return r
}

export default function EditorBoletim() {
  const { id = '' } = useParams()
  const consulta = useBoletim(id)
  return <ComDados consulta={consulta}>{(b) => <Editor key={b.id} b={b} />}</ComDados>
}

function Editor({ b }: { b: BoletimDetalhe }) {
  const navegar = useNavigate()
  const base = b.rascunho?.edicao ?? {}
  const [edicao, setEdicao] = useState<EdicaoBoletim>(() => structuredClone(base))
  const [salvo, setSalvo] = useState<string>(() => canonica(base))
  const urls = useUrlsFotos(fotosDe(b.snapshot)).data ?? {}
  const salvar = useSalvarRascunhoBoletim(b.id)
  const retificar = useRetificarBoletim(b.id)
  const previa = usePreviaBoletimEditado(b.id)
  const pdf = useUrlPdfBoletim()
  const [bloqueado, setBloqueado] = useState<string | null>(null)

  const leitura = !b.ultima_revisao || b.emissao_em_andamento
  const sujo = canonica(edicao) !== salvo
  const vazia = canonica(edicao) === canonica({})
  const ocupado = salvar.isPending || retificar.isPending || previa.isPending
  const voltar = `/boletins?etapa=${b.etapa_slug}`

  useEffect(() => {
    if (!sujo) return
    const f = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', f)
    return () => window.removeEventListener('beforeunload', f)
  }, [sujo])

  function mudar(f: (e: EdicaoBoletim) => EdicaoBoletim) {
    setEdicao((e) => normalizar(f(structuredClone(e))))
  }

  const ctx: Ctx = {
    edicao,
    leitura,
    urls,
    texto: (chave, original) => edicao.textos?.[chave] ?? original,
    setTexto: (chave, valor, original) =>
      mudar((e) => {
        const t = { ...(e.textos ?? {}) }
        if (valor === original) delete t[chave]
        else t[chave] = valor
        return { ...e, textos: t }
      }),
    oculto: (chave) => edicao.ocultos?.includes(chave) ?? false,
    alternar: (chave) =>
      mudar((e) => {
        const o = e.ocultos ?? []
        return { ...e, ocultos: o.includes(chave) ? o.filter((x) => x !== chave) : [...o, chave] }
      }),
    fotoOculta: (path) => edicao.fotos_ocultas?.includes(path) ?? false,
    alternarFoto: (path) =>
      mudar((e) => {
        const o = e.fotos_ocultas ?? []
        return { ...e, fotos_ocultas: o.includes(path) ? o.filter((x) => x !== path) : [...o, path] }
      }),
  }

  function confirmarSaida(ev: MouseEvent) {
    if (sujo && !window.confirm('Há alterações não salvas. Sair mesmo assim?')) ev.preventDefault()
  }

  function aoSalvar() {
    salvar.mutate(normalizar(edicao), { onSuccess: () => setSalvo(canonica(edicao)) })
  }

  function aoPrever() {
    previa.mutate(normalizar(edicao), {
      onSuccess: (blob) => {
        const url = URL.createObjectURL(blob)
        setBloqueado(abrir(url) ? null : url)
      },
    })
  }

  function aoReenviar() {
    const n = b.revisao + 1
    const ok = window.confirm(
      `Gera a retificação R${n} com as alterações e substitui a mensagem no grupo. Mensagens com mais de 48 h não podem ser apagadas e ficam no grupo.`,
    )
    if (!ok) return
    retificar.mutate(normalizar(edicao), {
      onSuccess: () => {
        setSalvo(canonica(edicao))
        navegar(voltar)
      },
    })
  }

  function aoDescartar() {
    if (b.rascunho) {
      if (!window.confirm('Descartar as alterações e apagar o rascunho salvo?')) return
      salvar.mutate(
        {},
        {
          onSuccess: () => {
            setEdicao({})
            setSalvo(canonica({}))
          },
        },
      )
    } else {
      setEdicao({})
    }
  }

  return (
    <section aria-labelledby="titulo-editor">
      <p>
        <Link to={voltar} onClick={confirmarSaida}>
          ← Boletins de {b.etapa_nome}
        </Link>
      </p>
      <h1 id="titulo-editor">Boletim {b.numero}</h1>
      <p className="adm-dica">
        {b.etapa_nome} · {dataBr(b.data)} · Telegram: {b.publicado ? 'publicado' : rotuloPublicacaoDe(b)}{' '}
        <button
          type="button"
          className="adm-botao"
          disabled={!b.pdf_path || pdf.isPending}
          onClick={() => pdf.mutate(b.pdf_path!, { onSuccess: (u) => setBloqueado(abrir(u) ? null : u) })}
        >
          Abrir PDF
        </button>
      </p>
      {bloqueado && (
        <p className="adm-dica">
          O navegador bloqueou a aba nova:{' '}
          <a href={bloqueado} target="_blank" rel="noreferrer">
            abrir o PDF
          </a>
          .
        </p>
      )}
      {b.base_numero && <p className="adm-alerta adm-alerta-info">Retificação editada a partir de {b.base_numero}</p>}
      {!b.ultima_revisao && (
        <p className="adm-alerta adm-alerta-aviso">
          Só leitura: existe uma revisão mais recente deste dia. Edite a última revisão na <Link to={voltar}>lista da etapa</Link>.
        </p>
      )}
      {b.ultima_revisao && b.emissao_em_andamento && (
        <p className="adm-alerta adm-alerta-aviso">Só leitura: há uma emissão em andamento para este dia.</p>
      )}
      {!leitura && b.rascunho && (
        <p className="adm-dica">
          Rascunho salvo em {dataHoraBr(b.rascunho.atualizado_em)}
          {b.rascunho.atualizado_por_nome ? ` por ${b.rascunho.atualizado_por_nome}` : ''}.
        </p>
      )}
      {!leitura && (
        <div className="adm-editor-barra">
          <button type="button" className="adm-botao adm-botao-principal" disabled={ocupado || !sujo} onClick={aoSalvar}>
            Salvar
          </button>
          <button type="button" className="adm-botao" disabled={ocupado} onClick={aoPrever}>
            Pré-visualizar
          </button>
          <button type="button" className="adm-botao adm-botao-principal" disabled={ocupado || vazia} onClick={aoReenviar}>
            Salvar e reenviar
          </button>
          <button type="button" className="adm-botao adm-botao-discreto" disabled={ocupado || (vazia && !b.rascunho)} onClick={aoDescartar}>
            Descartar alterações
          </button>
          {sujo && <span className="adm-selo">alterações não salvas</span>}
        </div>
      )}
      {[salvar, retificar, previa, pdf].map(
        (m, i) =>
          m.isError && (
            <p key={i} className="adm-alerta adm-alerta-erro" role="alert">
              {mensagemDe(m.error)}
            </p>
          ),
      )}
      {salvar.isSuccess && !sujo && (
        <p className="adm-alerta adm-alerta-ok" role="status">
          Rascunho salvo.
        </p>
      )}

      {b.snapshot.obras.map((o) => (
        <div key={o.id} className="adm-editor-obra">
          <h2>{o.nome}</h2>
          <h3>Serviços</h3>
          {o.servicos.length === 0 && <p className="adm-dica">Nenhum serviço.</p>}
          {o.servicos.map((s) => (
            <Item key={s.id} ctx={ctx} chave={`servico:${s.id}`} titulo={`${s.pavimento} · ${s.ambiente} · ${s.hora} · ${s.autor}`}>
              <Texto ctx={ctx} chave={`servico:${s.id}`} original={s.legenda ?? ''} rotulo="Legenda" vazio="sem texto" />
              <Fotos ctx={ctx} fotos={s.fotos} />
            </Item>
          ))}
          <h3>Pendências abertas</h3>
          {o.pendencias_abertas.length === 0 && <p className="adm-dica">Nenhuma pendência aberta.</p>}
          {o.pendencias_abertas.map((s) => (
            <Item key={s.id} ctx={ctx} chave={`aberta:${s.id}`} titulo={`${s.pavimento} · ${s.ambiente} · ${s.hora} · ${s.autor}`}>
              <Texto ctx={ctx} chave={`aberta:${s.id}`} original={s.legenda ?? ''} rotulo="Legenda" vazio="sem texto" />
              <Fotos ctx={ctx} fotos={s.fotos} />
            </Item>
          ))}
          <h3>Pendências encerradas</h3>
          {o.pendencias_encerradas.length === 0 && <p className="adm-dica">Nenhuma pendência encerrada.</p>}
          {o.pendencias_encerradas.map((p) => (
            <Item
              key={p.id}
              ctx={ctx}
              chave={`encerrada:${p.id}`}
              titulo={`${p.pavimento} · ${p.ambiente} · aberta em ${dataBr(p.aberta_em)} (${p.dias_aberta} d)`}
            >
              <Texto ctx={ctx} chave={`encerrada:${p.id}`} original={p.legenda ?? ''} rotulo="Legenda" vazio="sem texto" />
              <Fotos ctx={ctx} fotos={p.fotos_registro} />
              <div className="adm-editor-encerramento">
                <p className="adm-dica">
                  Encerramento · {p.encerramento.hora} · {p.encerramento.autor}
                </p>
                <Texto
                  ctx={ctx}
                  chave={`encerramento:${p.id}`}
                  original={p.encerramento.observacao ?? ''}
                  rotulo="Observação do encerramento"
                  vazio="sem texto"
                />
                <Fotos ctx={ctx} fotos={p.encerramento.fotos} />
              </div>
            </Item>
          ))}
          <h3>Observações</h3>
          {o.observacoes.length === 0 && <p className="adm-dica">Nenhuma observação.</p>}
          {o.observacoes.map((ob, i) => {
            const chave = `observacao:${o.id}:${i}`
            return (
              <Item key={chave} ctx={ctx} chave={chave} titulo={`${ob.hora} · ${ob.autor}`} vazioOculta={ctx.texto(chave, ob.texto) === ''}>
                <Texto ctx={ctx} chave={chave} original={ob.texto} rotulo="Observação" vazio="oculto (texto vazio)" />
              </Item>
            )
          })}
        </div>
      ))}

      <h2>Lançamentos tardios</h2>
      {b.snapshot.tardios.length === 0 && <p className="adm-dica">Nenhum lançamento tardio.</p>}
      {b.snapshot.tardios.map((t) => {
        const chave = `tardio:${t.id}`
        return (
          <Item
            key={t.id}
            ctx={ctx}
            chave={chave}
            titulo={`${t.obra}${t.ambiente ? ` · ${t.ambiente}` : ''} · ${t.tipo} · ${dataBr(t.data)}${t.hora ? ` ${t.hora}` : ''} · ${t.autor}`}
            vazioOculta={ctx.texto(chave, t.texto ?? '') === ''}
          >
            <Texto ctx={ctx} chave={chave} original={t.texto ?? ''} rotulo="Texto" vazio="oculto (texto vazio)" />
          </Item>
        )
      })}
    </section>
  )
}

function rotuloPublicacaoDe(b: BoletimDetalhe): string {
  return rotuloPublicacao({ publicado: b.publicado, publicacao_estado: b.publicacao_estado } as Parameters<typeof rotuloPublicacao>[0])
}

/** Cartão de um item: título, marcas "alterado"/"oculto" e botão Ocultar/Mostrar. */
function Item({
  ctx,
  chave,
  titulo,
  vazioOculta = false,
  children,
}: {
  ctx: Ctx
  chave: string
  titulo: string
  vazioOculta?: boolean
  children: ReactNode
}) {
  const oculto = ctx.oculto(chave) || vazioOculta
  const alterado = ctx.edicao.textos?.[chave] !== undefined || ctx.oculto(chave)
  return (
    <div className={`adm-editor-item${oculto ? ' adm-editor-oculto' : ''}`} data-chave={chave}>
      <div className="adm-editor-item-topo">
        <strong>{titulo}</strong>
        {alterado && <span className="adm-selo">alterado</span>}
        {oculto && <span className="adm-selo">oculto</span>}
        {!ctx.leitura && (
          <button
            type="button"
            className="adm-botao adm-botao-mini"
            aria-label={`${ctx.oculto(chave) ? 'Mostrar' : 'Ocultar'} ${titulo}`}
            onClick={() => ctx.alternar(chave)}
          >
            {ctx.oculto(chave) ? 'Mostrar' : 'Ocultar'}
          </button>
        )}
      </div>
      {children}
    </div>
  )
}

/** Texto editável no lugar: clique ou Enter abre; Esc cancela; sair do campo confirma. */
function Texto({ ctx, chave, original, rotulo, vazio }: { ctx: Ctx; chave: string; original: string; rotulo: string; vazio: string }) {
  const atual = ctx.texto(chave, original)
  const [editando, setEditando] = useState(false)
  const [rascunho, setRascunho] = useState(atual)
  const cancelou = useRef(false)
  const alterado = ctx.edicao.textos?.[chave] !== undefined

  function abrirEdicao() {
    cancelou.current = false
    setRascunho(atual)
    setEditando(true)
  }
  function confirmar() {
    if (!cancelou.current) ctx.setTexto(chave, rascunho, original)
    setEditando(false)
  }

  if (editando) {
    return (
      <textarea
        className="adm-editor-textarea"
        aria-label={rotulo}
        autoFocus
        value={rascunho}
        rows={3}
        onChange={(e) => setRascunho(e.target.value)}
        onBlur={confirmar}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            cancelou.current = true
            setEditando(false)
          }
        }}
      />
    )
  }
  const conteudo = atual === '' ? <em>{vazio}</em> : atual
  return (
    <p className="adm-editor-texto">
      <span className="adm-dica">{rotulo}: </span>
      {ctx.leitura ? (
        conteudo
      ) : (
        <button type="button" className="adm-editor-texto-botao" aria-label={`Editar ${rotulo.toLowerCase()}`} onClick={abrirEdicao}>
          {conteudo}
        </button>
      )}
      {alterado && <span className="adm-selo"> alterado</span>}
    </p>
  )
}

function Fotos({ ctx, fotos }: { ctx: Ctx; fotos: FotoBoletim[] }) {
  if (fotos.length === 0) return null
  return (
    <ul className="adm-editor-fotos">
      {fotos.map((f) => {
        const oculta = ctx.fotoOculta(f.path)
        const nome = f.path.split('/').pop()
        return (
          <li key={f.path} className={oculta ? 'adm-editor-oculto' : undefined}>
            {ctx.urls[f.path] ? <img src={ctx.urls[f.path]} alt={`Foto ${nome}`} width={96} /> : <span className="adm-dica">{nome}</span>}
            {oculta && <span className="adm-selo">oculta</span>}
            {!ctx.leitura && (
              <button
                type="button"
                className="adm-botao adm-botao-mini"
                aria-label={`${oculta ? 'Mostrar' : 'Ocultar'} foto ${nome}`}
                onClick={() => ctx.alternarFoto(f.path)}
              >
                {oculta ? 'Mostrar' : 'Ocultar'}
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
