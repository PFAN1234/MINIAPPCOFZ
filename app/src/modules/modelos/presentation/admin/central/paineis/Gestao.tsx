/**
 * Painel Gestão da central: os `.frag` publicados por disciplina, o envio de um modelo novo e o
 * histórico, em colunas únicas para o painel estreito. O IFC é convertido neste navegador, num Web
 * Worker (`modules/modelos/infra/conversor.ts`); um `.frag` já convertido vai direto. Nada é gravado
 * até "Publicar". Depois de publicar ou retirar, `aoMudar(sigla)` avisa a central para atualizar a cena.
 */
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { ComDados, mensagemDe } from '../../../../../../admin/componentes.tsx'
import { useRepositorioAdmin } from '../../../../../../admin/dados/contexto.tsx'
import { useModelosAdmin, useRetirarModelo } from '../../../../../../admin/dados/hooks.ts'
import type { ProgressoConversao } from '../../../../application/ports/ConversorIfcPort.port.ts'
import { publicarModelo } from '../../../../application/use-cases/publicarModelo.ts'
import type { DadosModelos, EventoModelo, ModeloAdmin, ObraCentral } from '../../../../domain/tipos.ts'
import {
  AVISO_IFC,
  LIMITE_FRAG,
  mb,
  problemaFrag,
  problemaRevisaoModelo,
  problemaSigla,
  siglaERevisao,
  tipoDoArquivo,
  type TipoArquivo,
} from '../../../../domain/modelos.ts'
import { useConversor } from '../../../../infra/conversor.ts'
import { hashModelo } from '../../../../infra/modelosLocais.ts'

interface Props {
  obra: ObraCentral
  /** Chamado depois que publicar ou retirar der certo, com a sigla afetada. */
  aoMudar(sigla: string): void
}

export default function Gestao({ obra, aoMudar }: Props) {
  const consulta = useModelosAdmin(obra.slug)
  return (
    <div className="central-gestao">
      <ComDados consulta={consulta}>
        {(d: DadosModelos) => (
          <>
            <Publicados slug={obra.slug} modelos={d.modelos} aoMudar={aoMudar} />
            <Envio obra={obra} publicados={d.modelos} aoMudar={aoMudar} />
            <Historico eventos={d.historico} />
          </>
        )}
      </ComDados>
    </div>
  )
}

const data = (iso: string) => new Date(iso).toLocaleString('pt-BR')

function Publicados({ slug, modelos, aoMudar }: { slug: string; modelos: ModeloAdmin[]; aoMudar(sigla: string): void }) {
  const retirar = useRetirarModelo(slug)
  const [confirmando, setConfirmando] = useState<string | null>(null)
  return (
    <section aria-labelledby="titulo-publicados">
      <h3 id="titulo-publicados">Publicados</h3>
      {modelos.length === 0 ? (
        <p className="central-sec">Nenhum modelo publicado: o visualizador do Mini App fica vazio nesta obra.</p>
      ) : (
        <ul className="central-gestao-lista" aria-label="Modelos publicados">
          {modelos.map((m) => (
            <li key={m.sigla} data-testid={`modelo-${m.sigla}`}>
              <span>
                <strong className="central-gestao-sigla">{m.sigla}</strong> · {m.revisao ?? '—'} · {mb(m.bytes)}
              </span>
              <span className="central-sec">{data(m.atualizado_em)}</span>
              {confirmando === m.sigla ? (
                <span className="central-gestao-acoes">
                  <button
                    type="button"
                    className="central-botao central-botao-perigo"
                    disabled={retirar.isPending}
                    onClick={() =>
                      retirar.mutate(m.sigla, {
                        onSuccess: () => {
                          setConfirmando(null)
                          aoMudar(m.sigla)
                        },
                      })
                    }
                  >
                    Confirmar: retirar {m.sigla}
                  </button>
                  <button type="button" className="central-botao" onClick={() => setConfirmando(null)}>
                    Cancelar
                  </button>
                </span>
              ) : (
                <span className="central-gestao-acoes">
                  <button type="button" className="central-botao" onClick={() => setConfirmando(m.sigla)}>
                    Retirar {m.sigla}
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {retirar.isError && (
        <p className="central-gestao-alerta" role="alert">
          {mensagemDe(retirar.error)}
        </p>
      )}
      <p className="central-sec">
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

function Envio({
  obra,
  publicados,
  aoMudar,
}: {
  obra: ObraCentral
  publicados: ModeloAdmin[]
  aoMudar(sigla: string): void
}) {
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
          hash: hashModelo,
          registrarModelo: async (s, r) => {
            setFase({
              tipo: 'publicando',
              texto: 'Registrando o modelo…',
              frag,
            })
            return repo.registrarModelo(s, r)
          },
        },
        obra: { id: obra.obra_id, slug: obra.slug },
        sigla,
        revisao: revisao || null,
        frag,
        origem: escolhido.tipo,
        arquivoNome: escolhido.arquivo.name,
        ifcBytes: escolhido.tipo === 'ifc' ? escolhido.arquivo.size : null,
      })
      setFase({ tipo: 'publicado', modelo })
      setEscolhido(null)
      void qc.invalidateQueries({ queryKey: ['admin', 'modelos', obra.slug] })
      aoMudar(modelo.sigla)
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
    <section aria-labelledby="titulo-envio">
      <h3 id="titulo-envio">Enviar modelo</h3>
      <div className="central-gestao-form">
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
          <span className="central-sec">
            IFC: convertido aqui (pode levar alguns minutos; a aba precisa ficar aberta). O .frag resultante tem de
            ficar em até {mb(LIMITE_FRAG)}. Nome no padrão {'<obra>-<projeto>-<SIGLA>-<REV>'}, como
            CE01-14PE01-ARQ-R06.ifc, preenche a sigla e a revisão.
          </span>
        </label>
        {fase.tipo === 'publicado' && (
          <p className="central-gestao-alerta central-gestao-ok" role="status">
            Publicado: {fase.modelo.sigla}
            {fase.modelo.revisao ? `, revisão ${fase.modelo.revisao}` : ''} ({mb(fase.modelo.bytes)}). O Mini App baixa
            a versão nova na próxima abertura do modelo; a cena desta página já foi atualizada.
          </p>
        )}
        {escolhido && (
          <>
            <p>
              <strong>{escolhido.arquivo.name}</strong> · {mb(escolhido.arquivo.size)} ·{' '}
              {escolhido.tipo === 'ifc' ? 'IFC (será convertido)' : '.frag pronto'}
            </p>
            {escolhido.tipo === 'ifc' && escolhido.arquivo.size > AVISO_IFC && (
              <p className="central-gestao-alerta">
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
              <p className="central-gestao-alerta" role="alert">
                {problema}
              </p>
            )}
            {existente && !problema && (
              <p className="central-gestao-alerta central-gestao-ok">
                Já há {existente.sigla} publicado ({existente.revisao ? `revisão ${existente.revisao}, ` : ''}
                {mb(existente.bytes)}): publicar substitui no visualizador.
              </p>
            )}
            {fase.tipo === 'convertendo' && (
              <div className="central-gestao-form">
                <progress max={1} value={fase.progresso.fracao} aria-label="Progresso da conversão" />
                <span role="status">
                  {fase.progresso.texto}… {Math.round(fase.progresso.fracao * 100)}%
                </span>
                <button type="button" className="central-botao" onClick={() => cancelar.current?.abort()}>
                  Cancelar conversão
                </button>
              </div>
            )}
            {frag && (
              <p role="status">
                Convertido: .frag com {mb(frag.byteLength)}.{' '}
                <button type="button" className="central-botao" onClick={() => baixarFrag(frag)}>
                  Baixar o .frag
                </button>
              </p>
            )}
            {fase.tipo === 'publicando' && (
              <p className="central-sec" role="status">
                {fase.texto}
              </p>
            )}
            <div className="central-gestao-acoes">
              {escolhido.tipo === 'ifc' && fase.tipo !== 'convertido' && fase.tipo !== 'publicando' && (
                <button
                  type="button"
                  className="central-botao central-botao-principal"
                  disabled={!!problema || ocupado}
                  onClick={() => void converter()}
                >
                  Converter
                </button>
              )}
              {(escolhido.tipo === 'frag' || fase.tipo === 'convertido' || fase.tipo === 'publicando') && (
                <button
                  type="button"
                  className="central-botao central-botao-principal"
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
          <p className="central-gestao-alerta" role="alert">
            {erro}
          </p>
        )}
      </div>
    </section>
  )
}

function Historico({ eventos }: { eventos: EventoModelo[] }) {
  return (
    <section aria-labelledby="titulo-historico-modelos">
      <h3 id="titulo-historico-modelos">Histórico</h3>
      {eventos.length === 0 ? (
        <p className="central-sec">Nenhum envio pelo site ainda.</p>
      ) : (
        <ul className="central-gestao-lista">
          {eventos.map((h) => (
            <li key={h.id}>
              <strong>
                {h.acao === 'publicado' ? 'Publicado' : 'Retirado'} {h.sigla}
              </strong>
              <span className="central-sec">
                {data(h.publicado_em)}
                {h.revisao ? ` · ${h.revisao}` : ''}
                {h.publicado_por_nome ? ` · ${h.publicado_por_nome}` : ''}
                {h.bytes ? ` · ${mb(h.bytes)}` : ''}
              </span>
              {(h.arquivo_nome || (h.origem === 'ifc' && h.ifc_bytes)) && (
                <span className="central-sec">
                  {h.arquivo_nome ?? ''}
                  {h.origem === 'ifc' && h.ifc_bytes ? ` (IFC de ${mb(h.ifc_bytes)}, convertido no site)` : ''}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
