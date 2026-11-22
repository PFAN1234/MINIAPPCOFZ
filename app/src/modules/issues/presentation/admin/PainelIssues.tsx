/**
 * Painel Issues da central: lista das issues da obra (filtro por status e busca), criação a partir da
 * vista atual do 3D (com captura da imagem), detalhe editável com vistas restauráveis e comentários.
 * Em coluna única, para o painel estreito. Importar e exportar BCF: `BcfIssues.tsx`.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ComDados, mensagemDe } from '../../../../admin/componentes.tsx'
import {
  useAdicionarVistaIssue,
  useAdmins,
  useComentarIssue,
  useCriarIssueComVista,
  useIssues,
  useSalvarIssue,
  useUrlImagemVista,
} from '../../../../admin/dados/hooks.ts'
import type { Vista } from '../../../modelos/domain/central.ts'
import type { MotorVisualizador } from '../../../modelos/application/ports/MotorVisualizador.port.ts'
import type { ObraCentral } from '../../../modelos/domain/tipos.ts'
import { ErroImagemVista } from '../../application/use-cases/criarIssueComVista.ts'
import { useBcfIssues } from './BcfIssues.tsx'
import {
  contarPorStatus,
  ehAberta,
  filtrarPorStatus,
  ordenarIssues,
  PRIORIDADES_ISSUE,
  problemaComentario,
  problemaIssue,
  ROTULO_PRIORIDADE,
  ROTULO_STATUS,
  ROTULO_TIPO,
  STATUS_ISSUE,
  TIPOS_ISSUE,
  type DadosIssue,
  type FiltroStatus,
  type Issue,
  type IssueVista,
  type PrioridadeIssue,
  type StatusIssue,
  type TipoIssue,
} from '../../domain/issues.ts'

interface Props {
  obra: ObraCentral
  /** Motor 3D (null enquanto não montou); `pronto` indica modelos carregados. */
  motor: MotorVisualizador | null
  pronto: boolean
  /** Número da issue aberta no detalhe (`?issue=`), ou null para a lista. */
  numeroAberto: number | null
  /** Abre o detalhe da issue (número) ou volta à lista (null). */
  aoAbrir(numero: number | null): void
}

const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR')
const dataCurta = (aaaaMmDd: string) => aaaaMmDd.split('-').reverse().join('/')

function hojeIso(): string {
  const d = new Date()
  const dois = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`
}

/** Prazo passado de uma issue ainda aberta. */
function vencida(i: Pick<Issue, 'prazo' | 'status'>): boolean {
  return i.prazo !== null && ehAberta(i) && i.prazo < hojeIso()
}

function Selo({ status }: { status: StatusIssue }) {
  return <span className={`central-selo central-selo-${status}`}>{ROTULO_STATUS[status]}</span>
}

export default function PainelIssues({ obra, motor, pronto, numeroAberto, aoAbrir }: Props) {
  const consulta = useIssues(obra.obra_id)
  return (
    <div className="central-issues">
      <ComDados consulta={consulta}>
        {(issues: Issue[]) =>
          numeroAberto !== null ? (
            <DetalheOuAusente
              obra={obra}
              issue={issues.find((i) => i.numero === numeroAberto)}
              numero={numeroAberto}
              motor={motor}
              pronto={pronto}
              aoAbrir={aoAbrir}
            />
          ) : (
            <Lista obra={obra} issues={issues} motor={motor} pronto={pronto} aoAbrir={aoAbrir} />
          )
        }
      </ComDados>
    </div>
  )
}

function Lista({
  obra,
  issues,
  motor,
  pronto,
  aoAbrir,
}: {
  obra: ObraCentral
  issues: Issue[]
  motor: MotorVisualizador | null
  pronto: boolean
  aoAbrir(numero: number | null): void
}) {
  const [filtro, setFiltro] = useState<FiltroStatus>('abertas')
  const [busca, setBusca] = useState('')
  const [criando, setCriando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [pendente, setPendente] = useState<{ id: string; numero: number } | null>(null)

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return ordenarIssues(filtrarPorStatus(issues, filtro), 'numero').filter(
      (i) => !q || `#${i.numero} ${i.titulo} ${i.descricao ?? ''}`.toLowerCase().includes(q),
    )
  }, [issues, filtro, busca])
  const bcf = useBcfIssues({ obra, motor, pronto, issues, visiveis })
  const abertas = issues.filter(ehAberta).length
  const contagem = contarPorStatus(issues)

  return (
    <>
      <p className="central-issues-contagem" role="status">
        {abertas} {abertas === 1 ? 'aberta' : 'abertas'} de {issues.length}
        <span className="central-sec">
          {' '}
          · {contagem.em_andamento} em andamento · {contagem.resolvida} {contagem.resolvida === 1 ? 'resolvida' : 'resolvidas'} ·{' '}
          {contagem.fechada} {contagem.fechada === 1 ? 'fechada' : 'fechadas'}
        </span>
      </p>
      <div className="central-gestao-acoes">
        <button
          type="button"
          className="central-botao central-botao-principal"
          onClick={() => {
            setAviso(null)
            setPendente(null)
            setCriando(true)
          }}
        >
          Nova issue
        </button>
        {bcf.botoes}
      </div>
      {bcf.painel}
      {aviso && (
        <div className="central-gestao-alerta" role="alert">
          <p>{aviso}</p>
          {pendente && motor && pronto && (
            <AdicionarVistaAtual
              obra={obra}
              issue={pendente}
              motor={motor}
              aoConcluir={() => {
                setAviso(null)
                setPendente(null)
              }}
            />
          )}
        </div>
      )}
      {criando && (
        <FormularioNova
          obra={obra}
          motor={pronto ? motor : null}
          aoCancelar={() => setCriando(false)}
          aoCriar={(i) => {
            setCriando(false)
            aoAbrir(i.numero)
          }}
          aoFalharImagem={(e) => {
            setCriando(false)
            setAviso(e.message)
            setPendente(e.issue)
          }}
        />
      )}
      <div className="central-gestao-form">
        <label>
          Status
          <select value={filtro} onChange={(e) => setFiltro(e.target.value as FiltroStatus)}>
            <option value="abertas">Abertas</option>
            <option value="todas">Todas</option>
            {STATUS_ISSUE.map((s) => (
              <option key={s} value={s}>
                {ROTULO_STATUS[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Buscar
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Número, título ou descrição"
          />
        </label>
      </div>
      {issues.length === 0 ? (
        <p className="central-sec">Nenhuma issue nesta obra ainda.</p>
      ) : visiveis.length === 0 ? (
        <p className="central-sec">Nenhuma issue encontrada com esse filtro.</p>
      ) : (
        <ul className="central-gestao-lista central-issues-lista" aria-label="Issues">
          {visiveis.map((i) => (
            <li key={i.id} data-testid={`issue-${i.numero}`}>
              <button type="button" className="central-issue-item" onClick={() => aoAbrir(i.numero)}>
                <span className="central-issue-topo">
                  <strong>#{i.numero}</strong>
                  <Selo status={i.status} />
                </span>
                <span className="central-issue-titulo">{i.titulo}</span>
                <span className="central-sec central-issue-meta">
                  <span>{ROTULO_PRIORIDADE[i.prioridade]}</span>
                  <span>{i.responsavelNome ?? 'Sem responsável'}</span>
                  {i.prazo && (
                    <span className={vencida(i) ? 'central-issue-vencido' : undefined}>
                      Prazo {dataCurta(i.prazo)}
                      {vencida(i) ? ' (vencido)' : ''}
                    </span>
                  )}
                  <span>
                    {i.comentarios.length} {i.comentarios.length === 1 ? 'comentário' : 'comentários'}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/** Captura a vista atual do motor (ao montar; `recapturar` refaz). */
function useCaptura(motor: MotorVisualizador | null) {
  const [captura, setCaptura] = useState<{ vista: Vista; imagem: Blob; url: string | null } | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!motor) return
    let ativo = true
    let url: string | null = null
    const vista = motor.vistaAtual()
    motor.capturar().then(
      (imagem) => {
        if (!ativo) return
        url = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(imagem) : null
        setErro(null)
        setCaptura({ vista, imagem, url })
      },
      (e) => ativo && setErro(mensagemDe(e, 'Não foi possível capturar a vista.')),
    )
    return () => {
      ativo = false
      if (url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url)
    }
  }, [motor, n])
  return { captura, erro, recapturar: () => setN((x) => x + 1) }
}

function FormularioNova({
  obra,
  motor,
  aoCancelar,
  aoCriar,
  aoFalharImagem,
}: {
  obra: ObraCentral
  motor: MotorVisualizador | null
  aoCancelar(): void
  aoCriar(i: { id: string; numero: number }): void
  aoFalharImagem(e: ErroImagemVista): void
}) {
  const criar = useCriarIssueComVista(obra.obra_id)
  const admins = useAdmins()
  const { captura, erro: erroCaptura, recapturar } = useCaptura(motor)
  const [titulo, setTitulo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [tipo, setTipo] = useState<TipoIssue>('problema')
  const [prioridade, setPrioridade] = useState<PrioridadeIssue>('normal')
  const [responsavel, setResponsavel] = useState('')
  const [prazo, setPrazo] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  const dados: DadosIssue & { titulo: string } = {
    titulo: titulo.trim(),
    descricao: descricao.trim() || null,
    tipo,
    prioridade,
    responsavelId: responsavel || null,
    prazo: prazo || null,
  }
  const problema = problemaIssue(dados)
  const aguardando = motor !== null && !captura && !erroCaptura

  async function salvar() {
    setErro(null)
    try {
      const r = await criar.mutateAsync({ dados, vista: captura?.vista ?? null, imagem: captura?.imagem ?? null })
      aoCriar(r)
    } catch (e) {
      if (e instanceof ErroImagemVista) aoFalharImagem(e)
      else setErro(mensagemDe(e))
    }
  }

  return (
    <form
      className="central-gestao-form central-docs-form"
      aria-label="Nova issue"
      onSubmit={(e) => {
        e.preventDefault()
        if (!problema && !criar.isPending && !aguardando) void salvar()
      }}
    >
      <div className="central-issue-captura">
        {captura?.url ? (
          <img src={captura.url} alt="Miniatura da vista atual" />
        ) : captura ? (
          <p className="central-sec">Vista capturada.</p>
        ) : aguardando ? (
          <p className="central-sec" role="status">
            Capturando a vista…
          </p>
        ) : (
          <p className="central-sec">
            {erroCaptura ?? 'Sem vista: o modelo ainda não carregou. A issue será criada sem vista.'}
          </p>
        )}
        {motor && (
          <button type="button" className="central-botao" onClick={recapturar} disabled={criar.isPending}>
            Recapturar vista
          </button>
        )}
      </div>
      <label>
        Título
        <input value={titulo} maxLength={200} disabled={criar.isPending} onChange={(e) => setTitulo(e.target.value)} />
      </label>
      <label>
        Descrição
        <textarea value={descricao} rows={3} disabled={criar.isPending} onChange={(e) => setDescricao(e.target.value)} />
      </label>
      <label>
        Tipo
        <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoIssue)}>
          {TIPOS_ISSUE.map((t) => (
            <option key={t} value={t}>
              {ROTULO_TIPO[t]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Prioridade
        <select value={prioridade} onChange={(e) => setPrioridade(e.target.value as PrioridadeIssue)}>
          {PRIORIDADES_ISSUE.map((p) => (
            <option key={p} value={p}>
              {ROTULO_PRIORIDADE[p]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Responsável
        <select value={responsavel} onChange={(e) => setResponsavel(e.target.value)}>
          <option value="">Sem responsável</option>
          {(admins.data ?? []).map((a) => (
            <option key={a.usuario_id} value={a.usuario_id}>
              {a.nome}
            </option>
          ))}
        </select>
      </label>
      <label>
        Prazo
        <input type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
      </label>
      {titulo !== '' && problema && (
        <p className="central-gestao-alerta" role="alert">
          {problema}
        </p>
      )}
      {erro && (
        <p className="central-gestao-alerta" role="alert">
          {erro}
        </p>
      )}
      <div className="central-gestao-acoes">
        <button
          type="submit"
          className="central-botao central-botao-principal"
          disabled={!!problema || criar.isPending || aguardando}
        >
          {criar.isPending ? 'Salvando…' : 'Salvar'}
        </button>
        <button type="button" className="central-botao" disabled={criar.isPending} onClick={aoCancelar}>
          Cancelar
        </button>
      </div>
    </form>
  )
}

/** Botão que captura a vista atual e a junta a uma issue existente. */
function AdicionarVistaAtual({
  obra,
  issue,
  motor,
  aoConcluir,
}: {
  obra: ObraCentral
  issue: { id: string; numero: number }
  motor: MotorVisualizador
  aoConcluir?(): void
}) {
  const adicionar = useAdicionarVistaIssue(obra.obra_id)
  const [capturando, setCapturando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  async function acao() {
    setErro(null)
    setCapturando(true)
    try {
      const vista = motor.vistaAtual()
      const imagem = await motor.capturar()
      await adicionar.mutateAsync({ issue, vista, imagem })
      aoConcluir?.()
    } catch (e) {
      setErro(mensagemDe(e))
    } finally {
      setCapturando(false)
    }
  }
  return (
    <>
      <button type="button" className="central-botao" disabled={capturando || adicionar.isPending} onClick={() => void acao()}>
        Adicionar vista atual
      </button>
      {erro && (
        <p className="central-gestao-alerta" role="alert">
          {erro}
        </p>
      )}
    </>
  )
}

function DetalheOuAusente({
  obra,
  issue,
  numero,
  motor,
  pronto,
  aoAbrir,
}: {
  obra: ObraCentral
  issue: Issue | undefined
  numero: number
  motor: MotorVisualizador | null
  pronto: boolean
  aoAbrir(numero: number | null): void
}) {
  if (!issue) {
    return (
      <>
        <p className="central-sec" role="status">
          Issue #{numero} não encontrada nesta obra.
        </p>
        <button type="button" className="central-botao" onClick={() => aoAbrir(null)}>
          Voltar à lista
        </button>
      </>
    )
  }
  // Remonta por issue: a vista inicial é aplicada uma vez por abertura.
  return <Detalhe key={issue.id} obra={obra} issue={issue} motor={motor} pronto={pronto} aoVoltar={() => aoAbrir(null)} />
}

function Detalhe({
  obra,
  issue,
  motor,
  pronto,
  aoVoltar,
}: {
  obra: ObraCentral
  issue: Issue
  motor: MotorVisualizador | null
  pronto: boolean
  aoVoltar(): void
}) {
  const salvar = useSalvarIssue(obra.obra_id)
  const admins = useAdmins()
  const [erro, setErro] = useState<string | null>(null)
  const aplicou = useRef(false)

  // Primeira vista: aplicada quando o motor fica pronto, uma vez por abertura.
  useEffect(() => {
    if (!motor || !pronto || aplicou.current) return
    aplicou.current = true
    const primeira = issue.vistas[0]
    if (primeira) void motor.aplicarVista(primeira.vista).catch(() => {})
  }, [motor, pronto, issue.vistas])

  function gravar(dados: DadosIssue) {
    const p = problemaIssue(dados)
    if (p) {
      setErro(p)
      return
    }
    setErro(null)
    salvar.mutate({ id: issue.id, dados }, { onError: (e) => setErro(mensagemDe(e)) })
  }

  const responsaveis = (admins.data ?? []).map((a) => ({ id: a.usuario_id, nome: a.nome }))
  if (issue.responsavelId && !responsaveis.some((r) => r.id === issue.responsavelId)) {
    responsaveis.push({ id: issue.responsavelId, nome: issue.responsavelNome ?? 'Responsável' })
  }

  return (
    <article className="central-issue-detalhe" aria-label={`Issue #${issue.numero}`}>
      <div className="central-gestao-acoes">
        <button type="button" className="central-botao" onClick={aoVoltar}>
          Voltar à lista
        </button>
      </div>
      <h3>
        #{issue.numero} <Selo status={issue.status} />
      </h3>
      <p className="central-sec central-issue-criada">
        Criada em {dataHora(issue.criadoEm)}
        {issue.criadoPorNome ? ` por ${issue.criadoPorNome}` : ''}
      </p>
      <div className="central-gestao-form">
        <label>
          Título
          <input
            defaultValue={issue.titulo}
            maxLength={200}
            onBlur={(e) => e.target.value.trim() !== issue.titulo && gravar({ titulo: e.target.value.trim() })}
          />
        </label>
        <label>
          Descrição
          <textarea
            defaultValue={issue.descricao ?? ''}
            rows={3}
            onBlur={(e) =>
              e.target.value.trim() !== (issue.descricao ?? '') && gravar({ descricao: e.target.value.trim() || null })
            }
          />
        </label>
        <label>
          Status
          <select value={issue.status} onChange={(e) => gravar({ status: e.target.value as StatusIssue })}>
            {STATUS_ISSUE.map((s) => (
              <option key={s} value={s}>
                {ROTULO_STATUS[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tipo
          <select value={issue.tipo} onChange={(e) => gravar({ tipo: e.target.value as TipoIssue })}>
            {TIPOS_ISSUE.map((t) => (
              <option key={t} value={t}>
                {ROTULO_TIPO[t]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Prioridade
          <select value={issue.prioridade} onChange={(e) => gravar({ prioridade: e.target.value as PrioridadeIssue })}>
            {PRIORIDADES_ISSUE.map((p) => (
              <option key={p} value={p}>
                {ROTULO_PRIORIDADE[p]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Responsável
          <select value={issue.responsavelId ?? ''} onChange={(e) => gravar({ responsavelId: e.target.value || null })}>
            <option value="">Sem responsável</option>
            {responsaveis.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nome}
              </option>
            ))}
          </select>
        </label>
        <label>
          Prazo
          <input
            type="date"
            value={issue.prazo ?? ''}
            className={vencida(issue) ? 'central-issue-vencido' : undefined}
            onChange={(e) => gravar({ prazo: e.target.value || null })}
          />
          {vencida(issue) && <span className="central-issue-vencido">Prazo vencido</span>}
        </label>
      </div>
      {erro && (
        <p className="central-gestao-alerta" role="alert">
          {erro}
        </p>
      )}

      <section aria-label="Vistas">
        <h3 className="central-docs-grupo">
          Vistas <span className="central-sec">({issue.vistas.length})</span>
        </h3>
        {issue.vistas.length === 0 ? (
          <p className="central-sec">Sem vistas.</p>
        ) : (
          <ul className="central-gestao-lista">
            {issue.vistas.map((v, i) => (
              <ItemVista key={v.id} vista={v} n={i + 1} motor={pronto ? motor : null} />
            ))}
          </ul>
        )}
        {motor && pronto && (
          <div className="central-gestao-acoes">
            <AdicionarVistaAtual obra={obra} issue={issue} motor={motor} />
          </div>
        )}
      </section>

      <Comentarios obra={obra} issue={issue} />
    </article>
  )
}

function ItemVista({ vista, n, motor }: { vista: IssueVista; n: number; motor: MotorVisualizador | null }) {
  const url = useUrlImagemVista(vista.imagemPath)
  return (
    <li>
      <strong>Vista {n}</strong>
      {url.data ? (
        <img className="central-issue-miniatura" src={url.data} alt={`Miniatura da vista ${n}`} />
      ) : (
        <span className="central-sec">Sem imagem</span>
      )}
      <span className="central-gestao-acoes">
        <button type="button" className="central-botao" disabled={!motor} onClick={() => void motor?.aplicarVista(vista.vista)}>
          Restaurar vista
        </button>
      </span>
    </li>
  )
}

function Comentarios({ obra, issue }: { obra: ObraCentral; issue: Issue }) {
  const comentar = useComentarIssue(obra.obra_id)
  const [texto, setTexto] = useState('')
  const problema = problemaComentario(texto)
  return (
    <section aria-label="Comentários">
      <h3 className="central-docs-grupo">
        Comentários <span className="central-sec">({issue.comentarios.length})</span>
      </h3>
      {issue.comentarios.length === 0 ? (
        <p className="central-sec">Sem comentários.</p>
      ) : (
        <ul className="central-gestao-lista">
          {issue.comentarios.map((c) => (
            <li key={c.id}>
              <span className="central-sec">
                <strong>{c.autorNome ?? 'Autor desconhecido'}</strong> · {dataHora(c.criadoEm)}
              </span>
              <span className="central-issue-texto">{c.texto}</span>
            </li>
          ))}
        </ul>
      )}
      <form
        className="central-gestao-form"
        aria-label="Novo comentário"
        onSubmit={(e) => {
          e.preventDefault()
          if (problema || comentar.isPending) return
          comentar.mutate({ issueId: issue.id, texto: texto.trim() }, { onSuccess: () => setTexto('') })
        }}
      >
        <label>
          Comentário
          <textarea value={texto} rows={2} onChange={(e) => setTexto(e.target.value)} />
        </label>
        {comentar.isError && (
          <p className="central-gestao-alerta" role="alert">
            {mensagemDe(comentar.error)}
          </p>
        )}
        <div className="central-gestao-acoes">
          <button type="submit" className="central-botao" disabled={!!problema || comentar.isPending}>
            Comentar
          </button>
        </div>
      </form>
    </section>
  )
}
