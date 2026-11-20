import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { Carregando, Erro } from '../../../../../admin/componentes.tsx'
import BarraSuperior from './barras/BarraSuperior.tsx'
import BarraVisibilidade from './barras/BarraVisibilidade.tsx'
import type { ObraCentral } from '../../../domain/tipos.ts'
import { useObrasCentral } from './CentralModelos.tsx'
import Itens from './paineis/Itens.tsx'
import Cortes from './paineis/Cortes.tsx'
import Medicoes from './paineis/Medicoes.tsx'
import Propriedades from './paineis/Propriedades.tsx'
import { useMotorCentral, type EstadoCentral } from './useMotorCentral.ts'
import type { Corte, Medida, ModoCor, TipoMedida, NoArvore, RefElemento, Vista3dUi } from '../../../domain/central.ts'
import { gravarTema, lerTema, type Tema } from './tema.ts'
import {
  IconeDocumentos,
  IconeGestao,
  IconeInspecionar,
  IconeIssues,
  IconeItens,
  IconeLua,
  IconeMedir,
  IconePainel,
  IconeRealce,
  IconeSol,
  IconeVer,
} from './icones.tsx'
import './central.css'

const ICONES_PAINEL: Record<string, ReactNode> = {
  itens: <IconeItens />,
  documentos: <IconeDocumentos />,
  issues: <IconeIssues />,
  medicoes: <IconeMedir />,
  gestao: <IconeGestao />,
}

const PAINEIS = [
  { id: 'itens', nome: 'Itens', etapa: 2 },
  { id: 'documentos', nome: 'Documentos', etapa: 6 },
  { id: 'issues', nome: 'Issues', etapa: 7 },
  { id: 'medicoes', nome: 'Medições', etapa: 4 },
  { id: 'gestao', nome: 'Gestão', etapa: 5 },
] as const

/**
 * Nomes dos pavimentos (sem repetir) da árvore espacial. O motor real devolve um nó agrupador
 * `IFCBUILDINGSTOREY` (sem id) e, abaixo dele, um nó por pavimento já com o nome; nos dublês o
 * próprio nó `pavimento` traz o nome.
 */
function pavimentosDe(nos: NoArvore[]): string[] {
  const nomes = new Set<string>()
  const visitar = (n: NoArvore) => {
    if (n.nivel === 'pavimento') {
      nomes.add(n.rotulo)
      return
    }
    if (n.classe?.toUpperCase() === 'IFCBUILDINGSTOREY') {
      for (const f of n.filhos) if (f.nivel === 'elemento') nomes.add(f.rotulo)
      return
    }
    n.filhos.forEach(visitar)
  }
  nos.forEach(visitar)
  return [...nomes]
}

const LARGURA_MIN = 240
const LARGURA_MAX = 520
const limitar = (n: number) => Math.min(LARGURA_MAX, Math.max(LARGURA_MIN, n))

/** Visualizador de uma obra: resolve a obra e abre a central (remontada a cada troca de obra). */
export default function CentralObra() {
  const { slug = '' } = useParams()
  const obras = useObrasCentral()

  if (obras.isPending) return <Carregando texto="Carregando a obra…" />
  if (obras.isError) return <Erro erro={obras.error} onTentar={() => void obras.refetch()} />
  const obra = obras.data.find((o) => o.slug === slug)
  if (!obra) {
    return (
      <section className="central-lista">
        <p>Obra não encontrada.</p>
        <Link to="/modelos">Todas as obras</Link>
      </section>
    )
  }
  return <CentralAberta key={obra.slug} obra={obra} />
}

function ehCampoDeTexto(alvo: EventTarget | null): boolean {
  const el = alvo as HTMLElement | null
  return Boolean(el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)))
}

/** Casca com trilho, painéis, canvas do motor 3D e barras. O motor é liberado ao desmontar. */
function CentralAberta({ obra }: { obra: ObraCentral }) {
  const [params, setParams] = useSearchParams()
  const [tema, setTema] = useState<Tema>(lerTema)
  const [aberto, setAberto] = useState(true)
  const [largura, setLargura] = useState(320)
  const [ortografica, setOrtografica] = useState(false)
  const [cor, setCor] = useState<ModoCor>('nenhum')
  const [grade, setGrade] = useState(true)
  const [hover, setHover] = useState(true)
  const [isolado, setIsolado] = useState(false)
  const [fantasma, setFantasma] = useState(false)
  const [vista, setVista] = useState<Vista3dUi>({ tipo: '3d' })
  const [caminhando, setCaminhando] = useState(false)
  const [minimapa, setMinimapa] = useState(false)
  const [pavimentos, setPavimentos] = useState<string[]>([])
  const [cortes, setCortes] = useState<Corte[]>([])
  const [corteMarcado, setCorteMarcado] = useState<string | null>(null)
  const [medidas, setMedidas] = useState<Medida[]>([])
  const [medidaMarcada, setMedidaMarcada] = useState<string | null>(null)
  const [medicao, setMedicao] = useState<TipoMedida | null>(null)
  const [modo, setModo] = useState<'ver' | 'inspecionar'>('ver')
  const [categoriasOcultas, setCategoriasOcultas] = useState<ReadonlySet<string>>(new Set())
  const arrasto = useRef<{ x: number; largura: number } | null>(null)
  const tela = useRef<HTMLDivElement>(null)
  const estado = useMotorCentral(obra.slug, tema, tela)
  const { motor, selecao, selecionar } = estado
  const pronto = estado.fase === 'pronto' && motor !== null

  // Pavimentos para o seletor de planta: refeitos a cada carga/descarga de modelo.
  useEffect(() => {
    if (!motor || !pronto) return
    let ativo = true
    motor.arvore().then(
      (nos) => ativo && setPavimentos(pavimentosDe(nos)),
      () => ativo && setPavimentos([]),
    )
    return () => {
      ativo = false
    }
  }, [motor, pronto, estado.versao])
  // Lista de cortes: o motor avisa quando muda (a criação é assíncrona).
  useEffect(() => {
    if (!motor) return
    return motor.ao('cortes', (dados) => setCortes(dados as Corte[]))
  }, [motor])
  // Lista de medições: o motor avisa a cada criação ou remoção.
  useEffect(() => {
    if (!motor) return
    return motor.ao('medicao', (dados) => setMedidas(dados as Medida[]))
  }, [motor])
  const medidaSelecionada = medidas.some((m) => m.id === medidaMarcada) ? medidaMarcada : null
  const corteSelecionado = cortes.some((c) => c.id === corteMarcado) ? corteMarcado : null

  const pedido = params.get('painel')
  const painel = PAINEIS.find((p) => p.id === pedido) ?? PAINEIS[0]

  function enquadrar() {
    motor?.enquadrar(selecao.length > 0 ? selecao : undefined)
  }
  function alternarProjecao() {
    const nova = !ortografica
    setOrtografica(nova)
    motor?.projecao(nova ? 'ortografica' : 'perspectiva')
  }
  function ocultar() {
    if (!motor || selecao.length === 0) return
    motor.ocultar(selecao)
    selecionar([])
  }
  /** Isola refs pelo mesmo caminho da barra (o filtro também usa), marcando o estado "isolado". */
  function isolarRefs(refs: RefElemento[]) {
    if (!motor || refs.length === 0) return
    motor.isolar(refs)
    setIsolado(true)
  }
  function isolar() {
    if (!motor) return
    if (isolado) {
      motor.mostrarTudo()
      setIsolado(false)
    } else if (selecao.length > 0) {
      motor.isolar(selecao)
      setIsolado(true)
    }
  }
  function irParaVista3d() {
    motor?.vista3d()
    setVista({ tipo: '3d' })
  }
  function irParaPlanta(pavimento: string) {
    if (!motor || !pavimento) return
    motor.vistaPlanta(pavimento)
    setCaminhando(false)
    setVista({ tipo: 'planta', pavimento })
  }
  function irParaElevacao(lado: 'N' | 'S' | 'L' | 'O') {
    if (!motor) return
    motor.vistaElevacao(lado)
    setCaminhando(false)
    setVista({ tipo: 'elevacao', lado })
  }
  function alternarCaminhar() {
    const novo = !caminhando
    setCaminhando(novo)
    if (novo) setVista({ tipo: '3d' })
    motor?.caminhar(novo)
  }
  function alternarMinimapa() {
    const novo = !minimapa
    setMinimapa(novo)
    motor?.minimapa?.(novo)
  }
  function mudarMedicao(m: TipoMedida | null) {
    setMedicao(m)
    motor?.medir.modo(m)
  }
  function apagarMedida(id?: string) {
    motor?.medir.apagar(id)
  }
  function apagarCorte(id?: string) {
    motor?.cortes.apagar(id)
  }
  function alternarFantasma() {
    const novo = !fantasma
    setFantasma(novo)
    motor?.fantasma(novo)
  }
  function mostrarTudo() {
    motor?.mostrarTudo()
    setIsolado(false)
    setCategoriasOcultas(new Set())
  }
  function trocarCor(modo: ModoCor) {
    setCor(modo)
    motor?.colorirPor(modo)
  }
  function alternarGrade() {
    const nova = !grade
    setGrade(nova)
    motor?.grade(nova)
  }
  function alternarHover() {
    const novo = !hover
    setHover(novo)
    motor?.hover(novo)
  }
  async function alternarCategoria(classe: string) {
    if (!motor) return
    const refs = await motor.buscar({ classe, operador: 'existe' })
    const oculta = categoriasOcultas.has(classe)
    if (oculta) motor.mostrar(refs)
    else motor.ocultar(refs)
    setCategoriasOcultas((atual) => {
      const novo = new Set(atual)
      if (oculta) novo.delete(classe)
      else novo.add(classe)
      return novo
    })
  }
  // F enquadra (a seleção, se houver); H oculta; I isola; Esc limpa a seleção.
  const atalhos = useRef({
    ocultar,
    isolar,
    enquadrar,
    apagarCorte: () => {},
    apagarMedida: () => {},
    sairMedicao: () => {},
  })
  useEffect(() => {
    atalhos.current = {
      ocultar,
      isolar,
      enquadrar,
      apagarCorte: () => corteSelecionado && apagarCorte(corteSelecionado),
      apagarMedida: () => medidaSelecionada && apagarMedida(medidaSelecionada),
      sairMedicao: () => medicao && mudarMedicao(null),
    }
  })
  useEffect(() => {
    if (!pronto) return
    function tecla(e: globalThis.KeyboardEvent) {
      if (ehCampoDeTexto(e.target) || e.ctrlKey || e.metaKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === 'f') atalhos.current.enquadrar()
      else if (k === 'h') atalhos.current.ocultar()
      else if (k === 'i') atalhos.current.isolar()
      else if (e.key === 'Delete') {
        atalhos.current.apagarCorte()
        atalhos.current.apagarMedida()
      } else if (e.key === 'Escape') {
        atalhos.current.sairMedicao()
        selecionar([])
      }
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [pronto, selecionar])

  function escolher(id: string) {
    const novo = new URLSearchParams(params)
    novo.set('painel', id)
    setParams(novo, { replace: true })
    setAberto(true)
  }
  function alternarTema() {
    const novo: Tema = tema === 'escuro' ? 'claro' : 'escuro'
    setTema(novo)
    gravarTema(novo)
  }
  function iniciarArrasto(e: PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture?.(e.pointerId)
    arrasto.current = { x: e.clientX, largura }
  }
  function arrastar(e: PointerEvent<HTMLDivElement>) {
    if (arrasto.current) setLargura(limitar(arrasto.current.largura + e.clientX - arrasto.current.x))
  }
  function teclaBorda(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowLeft') setLargura((l) => limitar(l - 16))
    if (e.key === 'ArrowRight') setLargura((l) => limitar(l + 16))
  }
  const ordem: string[] = PAINEIS.map((p) => p.id)
  function teclaAba(e: KeyboardEvent<HTMLButtonElement>) {
    const i = ordem.indexOf(painel.id)
    const d = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
    if (d) {
      e.preventDefault()
      escolher(ordem[(i + d + ordem.length) % ordem.length])
    }
  }

  return (
    <div className="central" data-tema={tema} data-painel-aberto={aberto}>
      <nav className="central-trilho" aria-label="Painéis da central">
        <div role="tablist" aria-orientation="vertical" className="central-abas">
          {PAINEIS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              id={`aba-${p.id}`}
              aria-selected={p.id === painel.id}
              aria-controls="painel-central"
              tabIndex={p.id === painel.id ? 0 : -1}
              className="central-aba central-item-trilho"
              onClick={() => escolher(p.id)}
              onKeyDown={teclaAba}
            >
              {ICONES_PAINEL[p.id]}
              <span>{p.nome}</span>
            </button>
          ))}
        </div>
        <div className="central-trilho-base">
          <button
            type="button"
            className="central-botao central-item-trilho"
            aria-label={`Configurações: mudar para o tema ${tema === 'escuro' ? 'claro' : 'escuro'}`}
            title="Configurações"
            onClick={alternarTema}
          >
            {tema === 'escuro' ? <IconeLua /> : <IconeSol />}
            <span>{tema === 'escuro' ? 'Escuro' : 'Claro'}</span>
          </button>
          <button
            type="button"
            className="central-botao central-item-trilho"
            aria-label="Realce ao passar"
            title="Realçar o item sob o cursor"
            aria-pressed={hover}
            disabled={!pronto}
            onClick={alternarHover}
          >
            <IconeRealce />
            <span>Realce</span>
          </button>
        </div>
      </nav>

      {aberto && (
        <aside className="central-lateral" style={{ width: largura }}>
          <section id="painel-central" role="tabpanel" aria-labelledby={`aba-${painel.id}`} className="central-painel">
            <h2>{painel.nome}</h2>
            {painel.id === 'itens' ? (
              <Itens
                motor={estado.motor}
                versao={estado.versao}
                modelos={estado.modelos}
                ativos={estado.ativos}
                falhas={estado.falhas}
                selecionados={selecao}
                onSelecionar={selecionar}
                onIsolar={isolarRefs}
                categoriasOcultas={categoriasOcultas}
                onAlternarCategoria={(classe) => void alternarCategoria(classe)}
                onAlternarModelo={(sigla, ligado) => void estado.alternarModelo(sigla, ligado)}
              />
            ) : painel.id === 'medicoes' ? (
              <Medicoes
                medidas={medidas}
                selecionada={medidaSelecionada}
                modo={medicao}
                onSelecionar={setMedidaMarcada}
                onApagar={apagarMedida}
                onApagarTodas={() => apagarMedida()}
              />
            ) : (
              <p className="central-sec">Disponível na etapa {painel.etapa}</p>
            )}
          </section>
          <section className="central-contexto" aria-label="Contexto">
            <h3>{obra.nome}</h3>
            <Link to="/modelos">Todas as obras</Link>
            <Cortes
              cortes={cortes}
              selecionado={corteSelecionado}
              onSelecionar={setCorteMarcado}
              onApagar={apagarCorte}
              onApagarTodos={() => apagarCorte()}
            />
            {modo === 'inspecionar' ? <Propriedades motor={motor} selecao={selecao} /> : <Selecao refs={selecao} />}
          </section>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Redimensionar painel"
            aria-valuemin={LARGURA_MIN}
            aria-valuemax={LARGURA_MAX}
            aria-valuenow={largura}
            tabIndex={0}
            className="central-borda"
            onPointerDown={iniciarArrasto}
            onPointerMove={arrastar}
            onPointerUp={() => (arrasto.current = null)}
            onKeyDown={teclaBorda}
          />
        </aside>
      )}

      <div className="central-direita">
        <button
          type="button"
          className="central-botao central-botao-icone central-recolher"
          aria-label={aberto ? 'Recolher painel' : 'Abrir painel'}
          aria-expanded={aberto}
          onClick={() => setAberto((a) => !a)}
        >
          <IconePainel aberto={aberto} />
        </button>
        <BarraSuperior
          ativo={pronto}
          ortografica={ortografica}
          cor={cor}
          grade={grade}
          onEnquadrar={enquadrar}
          onProjecao={alternarProjecao}
          onCor={trocarCor}
          onGrade={alternarGrade}
          pavimentos={pavimentos}
          vista={vista}
          onVista3d={irParaVista3d}
          onPlanta={irParaPlanta}
          onElevacao={irParaElevacao}
          onCortar={() => motor?.cortes.criar()}
          cortes={cortes.length}
          minimapa={minimapa}
          onMinimapa={alternarMinimapa}
          medicao={medicao}
          onMedir={mudarMedicao}
        />
        <div className="central-canvas" data-testid="canvas-central">
          <div ref={tela} className="central-tela" />
          <Estados estado={estado} />
          <div className="central-modo central-segmentado" role="group" aria-label="Modo">
            <button
              type="button"
              className="central-botao"
              aria-label="Ver"
              aria-pressed={modo === 'ver'}
              onClick={() => setModo('ver')}
            >
              <IconeVer />
              Ver
            </button>
            <button
              type="button"
              className="central-botao"
              aria-label="Inspecionar"
              aria-pressed={modo === 'inspecionar'}
              disabled={!pronto}
              onClick={() => {
                setModo('inspecionar')
                setAberto(true)
              }}
            >
              <IconeInspecionar />
              Inspecionar
            </button>
          </div>
          <BarraVisibilidade
            selecionados={selecao.length}
            ativo={pronto}
            isolado={isolado}
            fantasma={fantasma}
            caminhando={caminhando}
            onOcultar={ocultar}
            onIsolar={isolar}
            onFantasma={alternarFantasma}
            onCaminhar={alternarCaminhar}
            onMostrarTudo={mostrarTudo}
            onLimpar={() => selecionar([])}
          />
        </div>
      </div>
    </div>
  )
}

/** Seleção atual (último evento `selecao` do motor). */
function Selecao({ refs }: { refs: RefElemento[] }) {
  if (refs.length === 0) return <p className="central-sec">Nenhuma seleção.</p>
  const [r] = refs
  return (
    <div className="central-selecao" aria-live="polite">
      <strong>{refs.length > 1 ? `${refs.length} elementos selecionados` : (r.nome ?? r.classe ?? 'Elemento')}</strong>
      <dl>
        <div>
          <dt>Classe</dt>
          <dd>{r.classe ?? '—'}</dd>
        </div>
        <div>
          <dt>Nome</dt>
          <dd>{r.nome ?? '—'}</dd>
        </div>
        <div>
          <dt>Disciplina</dt>
          <dd>{r.sigla}</dd>
        </div>
        <div>
          <dt>GlobalId</dt>
          <dd className="central-guid">{r.globalId}</dd>
        </div>
      </dl>
    </div>
  )
}

/** Avisos sobre o canvas: sem WebGL, sem modelos, carregando, erro e falhas por disciplina. */
function Estados({ estado }: { estado: EstadoCentral }) {
  const { fase, progresso, falhas, erro } = estado
  return (
    <>
      {fase === 'sem-webgl' && (
        <p className="central-aviso" role="alert">
          Este navegador não permite exibir o modelo 3D (WebGL indisponível).
        </p>
      )}
      {fase === 'vazio' && (
        <p className="central-aviso" role="status">
          Sem modelos publicados — envie pela aba Gestão
        </p>
      )}
      {(fase === 'preparando' || fase === 'carregando') && (
        <p className="central-aviso central-pilula" role="status">
          Carregando modelos… {Math.round(progresso * 100)}%
        </p>
      )}
      {fase === 'erro' && (
        <p className="central-aviso" role="alert">
          {erro ?? 'Não foi possível abrir os modelos.'}
        </p>
      )}
      {fase === 'pronto' && falhas.length > 0 && (
        <p className="central-aviso central-pilula" role="alert">
          Não carregaram: {falhas.join(', ')}
        </p>
      )}
    </>
  )
}
