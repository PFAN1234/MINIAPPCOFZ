/**
 * Modelos 3D da obra (`/admin/obras/<slug>/modelos`): os `.frag` publicados por disciplina, o
 * envio de um modelo novo e o histórico. O IFC é convertido neste navegador, num Web Worker
 * (`modelo/conversor.ts`); um `.frag` já convertido (script `npm run modelos`) vai direto.
 * Nada é gravado até "Publicar".
 */
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ComDados, mensagemDe } from '../../componentes.tsx'
import { useRepositorioAdmin } from '../../dados/contexto.tsx'
import { useModelosAdmin, useObraAdmin, useRetirarModelo } from '../../dados/hooks.ts'
import type { DadosModelos, EventoModelo, ModeloAdmin, ObraAdmin } from '../../dados/tipos.ts'
import { useConversor, type ProgressoConversao } from '../../modelo/conversor.ts'
import {
  AVISO_IFC,
  LIMITE_FRAG,
  mb,
  problemaFrag,
  problemaRevisaoModelo,
  problemaSigla,
  publicarModelo,
  siglaERevisao,
  tipoDoArquivo,
  type TipoArquivo,
} from '../../modelo/modelos.ts'

export default function ModelosObra() {
  const { slug = '' } = useParams()
  const obra = useObraAdmin(slug)
  return <ComDados consulta={obra}>{(o) => <Pagina obra={o} />}</ComDados>
}

function Pagina({ obra }: { obra: ObraAdmin }) {
  const slug = obra.obra.slug
  const consulta = useModelosAdmin(slug)
  return (
    <article aria-labelledby="titulo-modelos">
      <p>
        <Link to={`/obras/${slug}`}>← {obra.obra.nome}</Link>
      </p>
      <h1 id="titulo-modelos">Modelos 3D · {obra.obra.nome}</h1>
      <p className="adm-dica">
        Um modelo por disciplina (sigla: ARQ, EST, HID…), mostrado no visualizador do Mini App. Envie o IFC (convertido
        aqui, neste navegador) ou o .frag já convertido no computador.
      </p>
      <ComDados consulta={consulta}>
        {(d: DadosModelos) => (
          <>
            <Publicados slug={slug} modelos={d.modelos} />
            <Envio obra={obra} publicados={d.modelos} />
            <Historico eventos={d.historico} />
          </>
        )}
      </ComDados>
    </article>
  )
}

const data = (iso: string) => new Date(iso).toLocaleString('pt-BR')

function Publicados({ slug, modelos }: { slug: string; modelos: ModeloAdmin[] }) {
  const retirar = useRetirarModelo(slug)
  const [confirmando, setConfirmando] = useState<string | null>(null)
  return (
    <section className="adm-secao" aria-labelledby="titulo-publicados">
      <h2 id="titulo-publicados">Publicados</h2>
      {modelos.length === 0 ? (
        <p className="adm-dica">Nenhum modelo publicado: o visualizador do Mini App fica vazio nesta obra.</p>
      ) : (
        <table className="adm-tabela">
          <thead>
            <tr>
              <th scope="col">Disciplina</th>
              <th scope="col">Revisão</th>
              <th scope="col" className="adm-num">
                Tamanho
              </th>
              <th scope="col">Atualizado em</th>
              <th scope="col">
                <span className="adm-oculto">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {modelos.map((m) => (
              <tr key={m.sigla} data-testid={`modelo-${m.sigla}`}>
                <td>
                  <strong>{m.sigla}</strong>
                </td>
                <td>{m.revisao ?? '—'}</td>
                <td className="adm-num">{mb(m.bytes)}</td>
                <td>{data(m.atualizado_em)}</td>
                <td>
                  {confirmando === m.sigla ? (
                    <span className="adm-acoes">
                      <button
                        type="button"
                        className="adm-botao adm-botao-perigo"
                        disabled={retirar.isPending}
                        onClick={() =>
                          retirar.mutate(m.sigla, {
                            onSuccess: () => setConfirmando(null),
                          })
                        }
                      >
                        Confirmar: retirar {m.sigla}
                      </button>
                      <button type="button" className="adm-botao" onClick={() => setConfirmando(null)}>
                        Cancelar
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="adm-botao adm-botao-discreto"
                      onClick={() => setConfirmando(m.sigla)}
                    >
                      Retirar {m.sigla}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {retirar.isError && (
        <p className="adm-alerta adm-alerta-erro" role="alert">
          {mensagemDe(retirar.error)}
        </p>
      )}
      <p className="adm-dica">
        Retirar tira a disciplina do visualizador; o arquivo fica guardado e pode ser publicado de novo.
      </p>
    </section>
  )
}

interface Escolhido {
  arquivo: File
  tipo: TipoArquivo
}

type Fase =
  | { tipo: 'parado' }
  | { tipo: 'convertendo'; progresso: ProgressoConversao }
  | { tipo: 'convertido'; frag: Uint8Array }
  | { tipo: 'publicando'; texto: string; frag: Uint8Array }
  | { tipo: 'publicado'; modelo: ModeloAdmin }

function Envio({ obra, publicados }: { obra: ObraAdmin; publicados: ModeloAdmin[] }) {
  const repo = useRepositorioAdmin()
  const conversor = useConversor()
  const qc = useQueryClient()
  const [escolhido, setEscolhido] = useState<Escolhido | null>(null)
  const [sigla, setSigla] = useState('')
  const [revisao, setRevisao] = useState('')
  const [fase, setFase] = useState<Fase>({ tipo: 'parado' })
  const [erro, setErro] = useState<string | null>(null)
  const cancelar = useRef<AbortController | null>(null)

  useEffect(() => () => cancelar.current?.abort(), [])

  const problema = escolhido ? (problemaSigla(sigla) ?? problemaRevisaoModelo(revisao)) : null
  const existente = publicados.find((m) => m.sigla === sigla)
  const ocupado = fase.tipo === 'convertendo' || fase.tipo === 'publicando'

  function escolher(f: File) {
    cancelar.current?.abort()
    setErro(null)
    setFase({ tipo: 'parado' })
    const tipo = tipoDoArquivo(f.name)
    if (!tipo) {
      setEscolhido(null)
      setErro('Escolha um arquivo .ifc ou .frag.')
      return
    }
    setEscolhido({ arquivo: f, tipo })
    const doNome = siglaERevisao(f.name)
    setSigla(doNome.sigla ?? '')
    setRevisao(doNome.revisao ?? '')
  }

  async function converter() {
    if (!escolhido) return
    setErro(null)
    const ac = new AbortController()
    cancelar.current = ac
    setFase({
      tipo: 'convertendo',
      progresso: { fracao: 0, texto: 'Preparando o conversor…' },
    })
    try {
      const frag = await conversor.converter(
        escolhido.arquivo,
        (p) => setFase({ tipo: 'convertendo', progresso: p }),
        ac.signal,
      )
      const p = problemaFrag(frag)
      if (p) throw new Error(`Conversão concluída, mas ${p.charAt(0).toLowerCase()}${p.slice(1)}`)
      setFase({ tipo: 'convertido', frag })
    } catch (e) {
      if (ac.signal.aborted) setFase({ tipo: 'parado' })
      else {
        setErro(mensagemDe(e))
        setFase({ tipo: 'parado' })
      }
    } finally {
      cancelar.current = null
    }
  }

  async function publicar() {
    if (!escolhido) return
    setErro(null)
    // IFC: o .frag convertido fica na tela se a publicação falhar (tentar de novo sem reconverter).
    const convertido = fase.tipo === 'convertido' ? fase.frag : null
    try {
      let frag: Uint8Array
      if (escolhido.tipo === 'frag') {
        frag = new Uint8Array(await escolhido.arquivo.arrayBuffer())
        const p = problemaFrag(frag)
        if (p) throw new Error(p)
      } else if (convertido) {
        frag = convertido
      } else return
      setFase({
        tipo: 'publicando',
        texto: `Enviando ${mb(frag.byteLength)}…`,
        frag,
      })
      const modelo = await publicarModelo({
        deps: {
          enviarArquivo: repo.enviarArquivo.bind(repo),
          registrarModelo: async (s, r) => {
            setFase({
              tipo: 'publicando',
              texto: 'Registrando o modelo…',
              frag,
            })
            return repo.registrarModelo(s, r)
          },
        },
        obra: { id: obra.obra.id, slug: obra.obra.slug },
        sigla,
        revisao: revisao || null,
        frag,
        origem: escolhido.tipo,
        arquivoNome: escolhido.arquivo.name,
        ifcBytes: escolhido.tipo === 'ifc' ? escolhido.arquivo.size : null,
      })
      setFase({ tipo: 'publicado', modelo })
      setEscolhido(null)
      void qc.invalidateQueries({
        queryKey: ['admin', 'modelos', obra.obra.slug],
      })
    } catch (e) {
      setErro(mensagemDe(e))
      setFase(convertido ? { tipo: 'convertido', frag: convertido } : { tipo: 'parado' })
    }
  }

  function baixarFrag(frag: Uint8Array) {
    const url = URL.createObjectURL(new Blob([frag as BlobPart], { type: 'application/octet-stream' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${sigla || 'modelo'}.frag`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  const frag = fase.tipo === 'convertido' || fase.tipo === 'publicando' ? fase.frag : null
  const podePublicar = !!escolhido && !problema && !ocupado && (escolhido.tipo === 'frag' || fase.tipo === 'convertido')

  return (
    <section className="adm-secao" aria-labelledby="titulo-envio">
      <h2 id="titulo-envio">Enviar modelo</h2>
      <div className="adm-form">
        <label>
          Arquivo do modelo (.ifc ou .frag)
          <input
            type="file"
            accept=".ifc,.frag"
            disabled={ocupado}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) escolher(f)
              e.target.value = ''
            }}
          />
          <span className="adm-dica">
            IFC: convertido aqui (pode levar alguns minutos; a aba precisa ficar aberta). O .frag resultante tem de
            ficar em até {mb(LIMITE_FRAG)}. Nome no padrão {'<obra>-<projeto>-<SIGLA>-<REV>'}, como
            CE01-14PE01-ARQ-R06.ifc, preenche a sigla e a revisão.
          </span>
        </label>
        {fase.tipo === 'publicado' && (
          <p className="adm-alerta adm-alerta-ok" role="status">
            Publicado: {fase.modelo.sigla}
            {fase.modelo.revisao ? `, revisão ${fase.modelo.revisao}` : ''} ({mb(fase.modelo.bytes)}). O Mini App baixa
            a versão nova na próxima abertura do modelo.
          </p>
        )}
        {escolhido && (
          <>
            <p>
              <strong>{escolhido.arquivo.name}</strong> · {mb(escolhido.arquivo.size)} ·{' '}
              {escolhido.tipo === 'ifc' ? 'IFC (será convertido)' : '.frag pronto'}
            </p>
            {escolhido.tipo === 'ifc' && escolhido.arquivo.size > AVISO_IFC && (
              <p className="adm-alerta adm-alerta-aviso">
                IFC grande ({mb(escolhido.arquivo.size)}): a conversão pode ficar sem memória neste navegador. Se
                falhar, converta no computador com <code>npm run modelos</code> e envie o .frag.
              </p>
            )}
            <label>
              Sigla da disciplina
              <input
                value={sigla}
                maxLength={4}
                disabled={ocupado}
                onChange={(e) => setSigla(e.target.value.toUpperCase().trim())}
                placeholder="ex.: ARQ"
              />
            </label>
            <label>
              Revisão
              <input
                value={revisao}
                disabled={ocupado}
                onChange={(e) => setRevisao(e.target.value.trim())}
                placeholder="ex.: R06"
              />
            </label>
            {problema && (
              <p className="adm-alerta adm-alerta-erro" role="alert">
                {problema}
              </p>
            )}
            {existente && !problema && (
              <p className="adm-alerta adm-alerta-info">
                Já há {existente.sigla} publicado ({existente.revisao ? `revisão ${existente.revisao}, ` : ''}
                {mb(existente.bytes)}): publicar substitui no visualizador.
              </p>
            )}
            {fase.tipo === 'convertendo' && (
              <div className="adm-progresso">
                <progress max={1} value={fase.progresso.fracao} aria-label="Progresso da conversão" />
                <span role="status">
                  {fase.progresso.texto}… {Math.round(fase.progresso.fracao * 100)}%
                </span>
                <button type="button" className="adm-botao" onClick={() => cancelar.current?.abort()}>
                  Cancelar conversão
                </button>
              </div>
            )}
            {frag && (
              <p role="status">
                Convertido: .frag com {mb(frag.byteLength)}.{' '}
                <button
                  type="button"
                  className="adm-botao adm-botao-discreto adm-botao-mini"
                  onClick={() => baixarFrag(frag)}
                >
                  Baixar o .frag
                </button>
              </p>
            )}
            {fase.tipo === 'publicando' && (
              <p className="adm-estado" role="status">
                {fase.texto}
              </p>
            )}
            <div className="adm-acoes">
              {escolhido.tipo === 'ifc' && fase.tipo !== 'convertido' && fase.tipo !== 'publicando' && (
                <button
                  type="button"
                  className="adm-botao adm-botao-principal"
                  disabled={!!problema || ocupado}
                  onClick={() => void converter()}
                >
                  Converter
                </button>
              )}
              {(escolhido.tipo === 'frag' || fase.tipo === 'convertido' || fase.tipo === 'publicando') && (
                <button
                  type="button"
                  className="adm-botao adm-botao-principal"
                  disabled={!podePublicar}
                  onClick={() => void publicar()}
                >
                  Publicar {sigla || 'modelo'}
                </button>
              )}
            </div>
          </>
        )}
        {erro && (
          <p className="adm-alerta adm-alerta-erro" role="alert">
            {erro}
          </p>
        )}
      </div>
    </section>
  )
}

function Historico({ eventos }: { eventos: EventoModelo[] }) {
  return (
    <section className="adm-secao" aria-labelledby="titulo-historico-modelos">
      <h2 id="titulo-historico-modelos">Histórico</h2>
      {eventos.length === 0 ? (
        <p className="adm-dica">Nenhum envio pelo site ainda.</p>
      ) : (
        <table className="adm-tabela">
          <thead>
            <tr>
              <th scope="col">Quando</th>
              <th scope="col">O quê</th>
              <th scope="col">Revisão</th>
              <th scope="col">Por</th>
              <th scope="col">Arquivo</th>
              <th scope="col" className="adm-num">
                .frag
              </th>
            </tr>
          </thead>
          <tbody>
            {eventos.map((h) => (
              <tr key={h.id}>
                <td>{data(h.publicado_em)}</td>
                <td>
                  {h.acao === 'publicado' ? 'Publicado' : 'Retirado'} {h.sigla}
                </td>
                <td>{h.revisao ?? '—'}</td>
                <td>{h.publicado_por_nome ?? '—'}</td>
                <td>
                  {h.arquivo_nome ?? '—'}
                  {h.origem === 'ifc' && h.ifc_bytes ? ` (IFC de ${mb(h.ifc_bytes)}, convertido no site)` : ''}
                </td>
                <td className="adm-num">{h.bytes ? mb(h.bytes) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
