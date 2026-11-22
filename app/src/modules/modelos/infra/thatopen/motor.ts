/**
 * Adaptador That Open do motor da Central de modelos. É a única pasta da central que importa
 * `@thatopen/*`, `three` e `camera-controls`; a tela só conhece a porta `MotorVisualizador`.
 * Carregado por `import()` dinâmico no composition root do admin (chunk próprio).
 *
 * Etapas 2a e 2b: montar, tema, grade, carregar/descarregar, árvore, categorias (só elementos com
 * geometria), seleção (+ evento), enquadrar, projeção, contorno de arestas, eixos no canto,
 * ocultar/isolar/fantasma, cores por categoria/disciplina, busca, hover e contorno da seleção.
 * Etapa 4A: vistas de planta/elevação (Views), cortes (Clipper), caminhar (FirstPerson) e minimapa.
 * O resto lança "não implementado (etapa N)" até a etapa do contrato.
 */
import * as OBC from '@thatopen/components'
import * as OBF from '@thatopen/components-front'
import { RenderedFaces, type FragmentsModel, type ItemsQueryParams } from '@thatopen/fragments'
import workerUrl from '@thatopen/fragments/worker?url'
import * as THREE from 'three'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { criarMinimapa, type Minimapa } from './minimapa.ts'
import { gruposDeDados, RELACOES_PROPRIEDADES, type DadosBrutos } from './propriedades.ts'
import { alturaCortePlanta, ehToqueRepetido, profundidadePlanta, projetarParaTela, semSigla, somarRefs, tamanhoCaptura, tirarRefs, type ToqueMedicao } from './vista.ts'
import type { EventoMotor, MotorVisualizador, TemaCentral } from '../../application/ports/MotorVisualizador.port.ts'
import {
  ErroCarregamento,
  agregarCategorias,
  corCategorica,
  ehClasseDeElemento,
  expressaoDoFiltro,
  montarArvore,
  type FiltroAtributo,
  type ModoCor,
  type CategoriaTotal,
  type Corte,
  type Medida,
  type Ponto3,
  type Vista,
  type NoArvore,
  type NoEstrutura,
  type RefElemento,
} from '../../domain/central.ts'

type Mundo = OBC.World & {
  scene: OBC.SimpleScene
  camera: OBC.OrthoPerspectiveCamera
  renderer: OBF.PostproductionRenderer
}

const PALETA: Record<TemaCentral, { fundo: string; grade: string; corte: string; contorno: string }> = {
  escuro: { fundo: '#0B1625', grade: '#263A55', corte: '#3A4C66', contorno: '#C9D4E3' },
  claro: { fundo: '#ECEFF3', grade: '#CBD3DD', corte: '#9AA6B6', contorno: '#2B3544' },
}

const ESTILO_CORTE = 'corte'
const COR_SELECAO = '#F5B700'
const COR_HOVER = '#FFD966'
const OPACIDADE_FANTASMA = 0.1
/** Acima disso a classe vem do mapa completo do modelo; abaixo, item a item. */
const LIMITE_CLASSE_POR_ITEM = 300

const TAMANHO_EIXOS = 84
const LOTE_NOMES = 4000

/** Cor de alerta da Central (tokens do tema): pinos de issue sobre o 3D. */
const COR_MARCADOR = '#ff8a3d'

type JanelaTeste = Window & { __motorCentral?: MotorVisualizador }

/** Cria o motor That Open (nada é montado até `montar`). */
export function criarMotorThatOpen(): MotorVisualizador {
  let components: OBC.Components | null = null
  let mundo: Mundo | null = null
  let fragments: OBC.FragmentsManager | null = null
  let highlighter: OBF.Highlighter | null = null
  let grade: OBC.SimpleGrid | null = null
  let hoverer: OBF.Hoverer | null = null
  let modoCor: ModoCor = 'nenhum'
  let fantasmaLigado = false
  let selecaoAtual: OBC.ModelIdMap = {}
  /** Estado de visibilidade acompanhado pelos comandos da porta (o Hider não guarda refs por GlobalId). */
  let selecaoRefs: RefElemento[] = []
  let ocultosRefs: RefElemento[] = []
  let isoladosRefs: RefElemento[] | null = null
  let liberado = false
  const ouvintes = new Map<EventoMotor, Set<(d: unknown) => void>>()
  const limpezas: (() => void)[] = []
  /** localId → classe, por modelo (montado sob demanda). */
  const classes = new Map<string, Map<number, string>>()
  const contagens = new Map<string, CategoriaTotal[]>()
  const guidsCache = new Map<string, Map<number, string>>()

  const emitir = (evento: EventoMotor, dados: unknown) => {
    for (const cb of ouvintes.get(evento) ?? []) cb(dados)
  }
  const pronto = () => {
    if (!components || !mundo || !fragments || liberado) throw new Error('motor não montado')
    return { components, mundo, fragments }
  }
  /**
   * Coordenadas do modelo-base (primeiro da lista, como o `FragmentsManager.baseCoordinationModel`).
   * `getCoordinates()` devolve [x, y, z, ...] em metros, Y-up; a cena é deslocada por esse vetor.
   */
  let origem: Ponto3 = [0, 0, 0]
  async function atualizarOrigemCena(f: OBC.FragmentsManager) {
    const base = [...f.list.values()][0]
    if (!base) {
      origem = [0, 0, 0]
      return
    }
    try {
      const [x = 0, y = 0, z = 0] = await base.getCoordinates()
      origem = [x, y, z]
    } catch {
      origem = [0, 0, 0]
    }
  }

  const modelo = (sigla: string): FragmentsModel | undefined => fragments?.list.get(sigla)

  async function classesDe(m: FragmentsModel): Promise<Map<number, string>> {
    const feito = classes.get(m.modelId)
    if (feito) return feito
    const categorias = await m.getCategories()
    const [por, comGeometria] = await Promise.all([
      m.getItemsOfCategories(categorias.map((c) => new RegExp(`^${c}$`))),
      m.getItemsIdsWithGeometry(),
    ])
    const geo = new Set(comGeometria)
    const mapa = new Map<number, string>()
    const totais: CategoriaTotal[] = []
    for (const [classe, ids] of Object.entries(por)) {
      let n = 0
      for (const id of ids) {
        mapa.set(id, classe)
        if (geo.has(id)) n++
      }
      // Só elementos com geometria entram na contagem (tipos, propriedades e unidades ficam de fora).
      if (n) totais.push({ classe, total: n })
    }
    classes.set(m.modelId, mapa)
    contagens.set(m.modelId, totais)
    return mapa
  }

  async function guidsDe(m: FragmentsModel, ids: number[]): Promise<Map<number, string>> {
    const cache = guidsCache.get(m.modelId) ?? new Map<number, string>()
    guidsCache.set(m.modelId, cache)
    const faltam = ids.filter((i) => !cache.has(i))
    for (let i = 0; i < faltam.length; i += LOTE_NOMES) {
      const lote = faltam.slice(i, i + LOTE_NOMES)
      const guids = await m.getGuidsByLocalIds(lote)
      lote.forEach((id, k) => {
        const g = guids[k]
        if (g) cache.set(id, g)
      })
    }
    return cache
  }

  /** Classe dos itens pedidos: poucos itens são lidos um a um (rápido); muitos usam o mapa do modelo. */
  async function classesPara(m: FragmentsModel, ids: number[]): Promise<Map<number, string>> {
    if (ids.length > LIMITE_CLASSE_POR_ITEM || classes.has(m.modelId)) return classesDe(m)
    const mapa = new Map<number, string>()
    const lidas = await Promise.all(ids.map((id) => m.getItem(id).getCategory()))
    ids.forEach((id, k) => {
      const c = lidas[k]
      if (c) mapa.set(id, c)
    })
    return mapa
  }

  async function nomesDe(m: FragmentsModel, ids: number[]): Promise<Map<number, string>> {
    const nomes = new Map<number, string>()
    for (let i = 0; i < ids.length; i += LOTE_NOMES) {
      const lote = ids.slice(i, i + LOTE_NOMES)
      const dados = await m.getItemsData(lote, {
        attributes: ['Name'],
        attributesDefault: false,
        relationsDefault: { attributes: false, relations: false },
      })
      lote.forEach((id, k) => {
        const attr = dados[k]?.Name
        const v = attr && !Array.isArray(attr) ? attr.value : undefined
        if (typeof v === 'string' && v) nomes.set(id, v)
      })
    }
    return nomes
  }

  function idsDoNo(no: NoEstrutura, saida: number[] = []): number[] {
    if (no.localId !== null) saida.push(no.localId)
    for (const f of no.children ?? []) idsDoNo(f, saida)
    return saida
  }

  async function refsDe(mapa: OBC.ModelIdMap): Promise<RefElemento[]> {
    const refs: RefElemento[] = []
    for (const [sigla, conjunto] of Object.entries(mapa)) {
      const m = modelo(sigla)
      if (!m || conjunto.size === 0) continue
      const ids = [...conjunto]
      const [guids, nomes, cls] = await Promise.all([guidsDe(m, ids), nomesDe(m, ids), classesPara(m, ids)])
      for (const id of ids) {
        const globalId = guids.get(id)
        if (!globalId) continue
        const classe = cls.get(id)
        const nome = nomes.get(id)
        refs.push({ sigla, globalId, ...(classe ? { classe } : {}), ...(nome ? { nome } : {}) })
      }
    }
    return refs
  }

  async function mapaDeRefs(refs: RefElemento[]): Promise<OBC.ModelIdMap> {
    const mapa: OBC.ModelIdMap = {}
    const porSigla = new Map<string, string[]>()
    for (const r of refs) porSigla.set(r.sigla, [...(porSigla.get(r.sigla) ?? []), r.globalId])
    for (const [sigla, guids] of porSigla) {
      const m = modelo(sigla)
      if (!m) continue
      const ids = await m.getLocalIdsByGuids(guids)
      const set = new Set(ids.filter((i): i is number => i !== null))
      if (set.size) mapa[sigla] = set
    }
    return mapa
  }

  const cor = (hex: string) => new THREE.Color(hex)

  async function aplicarFantasma() {
    if (!fragments || liberado) return
    const temSelecao = Object.values(selecaoAtual).some((c) => c.size > 0)
    for (const [sigla, m] of fragments.list) {
      await m.resetOpacity(undefined)
      // Sem seleção não há o que destacar: nada fica fantasma.
      if (!fantasmaLigado || !temSelecao) continue
      const sel = selecaoAtual[sigla]
      const resto = (await m.getItemsIdsWithGeometry()).filter((id) => !sel?.has(id))
      if (resto.length) await m.setOpacity(resto, OPACIDADE_FANTASMA)
    }
    void fragments.core.update(true)
  }

  async function aplicarCores(explicitas?: Vista['cores']) {
    if (!fragments || liberado) return
    for (const [sigla, m] of fragments.list) {
      await m.resetColor(undefined)
      if (modoCor === 'disciplina') {
        await m.setColor(undefined, cor(corCategorica(sigla)))
      } else if (modoCor === 'categoria') {
        const cls = await classesDe(m)
        const porClasse = new Map<string, number[]>()
        for (const [id, classe] of cls) {
          if (ehClasseDeElemento(classe)) porClasse.set(classe, [...(porClasse.get(classe) ?? []), id])
        }
        for (const [classe, ids] of porClasse) await m.setColor(ids, cor(corCategorica(classe)))
      }
      // Cores explícitas da vista por cima do modo.
      for (const { refs, cor: hex } of explicitas ?? []) {
        const ids = (await mapaDeRefs(refs))[sigla]
        if (ids?.size) await m.setColor([...ids], cor(hex))
      }
    }
    void fragments.core.update(true)
  }

  function desenharEixos(m: Mundo, gizmo: { cena: THREE.Scene; camera: THREE.OrthographicCamera }) {
    const r = m.renderer.three
    const q = m.camera.three.quaternion
    gizmo.camera.position.set(0, 0, 3).applyQuaternion(q)
    gizmo.camera.quaternion.copy(q)
    const autoClear = r.autoClear
    const viewport = r.getViewport(new THREE.Vector4())
    r.autoClear = false
    // Canto inferior direito (o esquerdo é dos botões Ver/Inspecionar).
    const x = Math.max(0, r.getSize(new THREE.Vector2()).x - TAMANHO_EIXOS - 8)
    r.setViewport(x, 8, TAMANHO_EIXOS, TAMANHO_EIXOS)
    r.setScissor(x, 8, TAMANHO_EIXOS, TAMANHO_EIXOS)
    r.setScissorTest(true)
    r.clearDepth()
    r.render(gizmo.cena, gizmo.camera)
    r.setScissorTest(false)
    r.setViewport(viewport)
    r.autoClear = autoClear
  }

  // --- Etapa 4A: vistas, cortes, caminhar e minimapa
  const ID_ELEVACAO = { S: 'elev-S', N: 'elev-N', L: 'elev-L', O: 'elev-O' } as const
  let vistaAberta: string | null = null
  let caminhando = false
  let minimapa: Minimapa | null = null
  /** Ids de vistas criadas por nós (zeradas quando os modelos mudam). */
  const vistasCriadas = new Set<string>()
  const bordasVistas = new Map<string, OBF.ClipEdges>()

  const escaparRegex = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  /** Altura do corte da planta do pavimento (cena): usa o primeiro modelo carregado que tem o pavimento. */
  type AtribPav = { Name?: { value?: unknown }; Elevation?: { value?: unknown } }
  async function alturaPavimento(nome: string): Promise<number | null> {
    if (!fragments) return null
    const re = new RegExp(`^${escaparRegex(nome)}$`)
    for (const m of fragments.list.values()) {
      const cat = await m.getItemsOfCategories([/BUILDINGSTOREY/])
      const ids = Object.values(cat).flat()
      if (ids.length === 0) continue
      const dados = await m.getItemsData(ids, { attributesDefault: true })
      const achado = (dados as AtribPav[]).find((d) => re.test(String(d.Name?.value ?? '')))
      const elevacao = Number(achado?.Elevation?.value)
      if (!achado || !Number.isFinite(elevacao)) continue
      const [, deslocY = 0] = await m.getCoordinates()
      return alturaCortePlanta(elevacao, deslocY)
    }
    return null
  }

  function listarCortes(): Corte[] {
    if (!components || liberado) return []
    return [...components.get(OBC.Clipper).list].map(([id, p]) => ({
      id,
      origem: [p.origin.x, p.origin.y, p.origin.z],
      normal: [p.normal.x, p.normal.y, p.normal.z],
    }))
  }
  const emitirCortes = () => emitir('cortes', listarCortes())
  function habilitarCortes(ligado: boolean) {
    if (!components) return
    for (const [, p] of components.get(OBC.Clipper).list) p.enabled = ligado
  }

  // --- Etapa 4B: medições (distância, área, volume e ângulo)
  type TipoMedida = Medida['tipo']
  type Ferramenta = OBF.LengthMeasurement | OBF.AreaMeasurement | OBF.VolumeMeasurement | OBF.AngleMeasurement
  const TIPOS_MEDIDA: TipoMedida[] = ['distancia', 'area', 'volume', 'angulo']
  const ferramentas = new Map<TipoMedida, Ferramenta>()
  let modoMedicao: TipoMedida | null = null
  let hoverAntes = true
  /** Volumes são calculados de forma assíncrona: valor e centro ficam em cache por id. */
  const volumesCalculados = new Map<string, { valor: number; centro: Ponto3 }>()

  const ponto = (v: THREE.Vector3): Ponto3 => [v.x, v.y, v.z]

  function listarMedidas(): Medida[] {
    if (liberado) return []
    const medidas: Medida[] = []
    for (const l of (ferramentas.get('distancia') as OBF.LengthMeasurement | undefined)?.list ?? [])
      medidas.push({ id: l.id, tipo: 'distancia', valor: l.distance(), unidade: 'm', pontos: [ponto(l.start), ponto(l.end)] })
    for (const a of (ferramentas.get('area') as OBF.AreaMeasurement | undefined)?.list ?? [])
      medidas.push({ id: a.id, tipo: 'area', valor: a.rawValue, unidade: 'm²', pontos: [...a.points].map(ponto) })
    for (const v of (ferramentas.get('volume') as OBF.VolumeMeasurement | undefined)?.list ?? []) {
      const calc = volumesCalculados.get(v.id)
      medidas.push({ id: v.id, tipo: 'volume', valor: calc?.valor ?? 0, unidade: 'm³', pontos: calc ? [calc.centro] : [] })
    }
    for (const g of (ferramentas.get('angulo') as OBF.AngleMeasurement | undefined)?.list ?? [])
      medidas.push({
        id: g.id,
        tipo: 'angulo',
        valor: (g.rawValue * 180) / Math.PI,
        unidade: '°',
        pontos: [ponto(g.start), ponto(g.vertex), ponto(g.end)],
      })
    return medidas
  }
  const emitirMedicoes = () => {
    if (!liberado) emitir('medicao', listarMedidas())
  }

  function ferramentaDe(tipo: TipoMedida): Ferramenta {
    const existente = ferramentas.get(tipo)
    if (existente) return existente
    const { components: c, mundo: w } = pronto()
    let t: Ferramenta
    if (tipo === 'distancia') {
      const d = c.get(OBF.LengthMeasurement)
      d.units = 'm'
      t = d
    } else if (tipo === 'area') {
      const a = c.get(OBF.AreaMeasurement)
      a.units = 'm2'
      t = a
    } else if (tipo === 'volume') {
      const v = c.get(OBF.VolumeMeasurement)
      v.units = 'm3'
      v.list.onItemAdded.add((vol) => {
        void Promise.all([vol.getRawValue(), vol.getCenter()]).then(([valor, centro]) => {
          if (liberado) return
          volumesCalculados.set(vol.id, { valor, centro: ponto(centro) })
          emitirMedicoes()
        })
      })
      t = v
    } else {
      const g = c.get(OBF.AngleMeasurement)
      g.units = 'deg'
      t = g
    }
    t.world = w
    t.rounding = 2
    t.list.onItemAdded.add(emitirMedicoes)
    t.list.onItemDeleted.add(emitirMedicoes)
    t.list.onCleared.add(emitirMedicoes)
    ferramentas.set(tipo, t)
    return t
  }

  function apagarMedidas(id?: string) {
    for (const [, t] of ferramentas) {
      const lista = t.list as Set<{ id: string }>
      if (id === undefined) lista.clear()
      else {
        const item = [...lista].find((i) => i.id === id)
        if (item) lista.delete(item)
      }
    }
    if (id === undefined) volumesCalculados.clear()
    else volumesCalculados.delete(id)
  }

  /** Cliques sem arrasto no canvas alimentam a ferramenta ativa; Enter/duplo clique concluem área e volume. */
  function ligarEntradaMedicao(container: HTMLElement) {
    let inicio: { x: number; y: number } | null = null
    let ultimo: ToqueMedicao | null = null
    const ativa = () => (modoMedicao ? ferramentas.get(modoMedicao) : undefined)
    const aoBaixar = (e: PointerEvent) => {
      inicio = { x: e.clientX, y: e.clientY }
    }
    const aoSoltar = (e: PointerEvent) => {
      const f = ativa()
      const i = inicio
      inicio = null
      if (!f || !i || e.button !== 0) return
      if (Math.hypot(e.clientX - i.x, e.clientY - i.y) > 5) return
      // Duplo clique em área/volume: o segundo toque repetiria o último ponto; o dblclick só conclui.
      const toque = { x: e.clientX, y: e.clientY, t: e.timeStamp }
      if ((modoMedicao === 'area' || modoMedicao === 'volume') && ehToqueRepetido(ultimo, toque)) return
      ultimo = toque
      void f.create()
    }
    const aoDuploClique = () => {
      if (modoMedicao === 'area' || modoMedicao === 'volume') ativa()?.endCreation()
    }
    const aoTecla = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (modoMedicao === 'area' || modoMedicao === 'volume')) ativa()?.endCreation()
    }
    container.addEventListener('pointerdown', aoBaixar)
    container.addEventListener('pointerup', aoSoltar)
    container.addEventListener('dblclick', aoDuploClique)
    window.addEventListener('keydown', aoTecla)
    limpezas.push(() => {
      container.removeEventListener('pointerdown', aoBaixar)
      container.removeEventListener('pointerup', aoSoltar)
      container.removeEventListener('dblclick', aoDuploClique)
      window.removeEventListener('keydown', aoTecla)
    })
  }

  function definirModoMedicao(m: TipoMedida | null) {
    const { mundo: w } = pronto()
    if (m === modoMedicao) return
    const ligando = modoMedicao === null && m !== null
    const desligando = m === null && modoMedicao !== null
    for (const t of TIPOS_MEDIDA) {
      const f = ferramentas.get(t)
      if (!f) continue
      if (t !== m) {
        f.cancelCreation()
        f.enabled = false
      }
    }
    modoMedicao = m
    if (ligando) {
      hoverAntes = hoverer?.enabled ?? true
      if (hoverer) hoverer.enabled = false
      if (highlighter) {
        void highlighter.clear('select')
        highlighter.enabled = false
      }
    }
    if (m) ferramentaDe(m).enabled = true
    if (desligando) {
      if (hoverer) hoverer.enabled = hoverAntes
      if (highlighter) highlighter.enabled = true
    }
    w.renderer.needsUpdate = true
  }

  function caixaDosModelos(): THREE.Box3 {
    const caixa = new THREE.Box3()
    for (const [, m] of fragments?.list ?? []) caixa.union(m.box)
    return caixa
  }

  /**
   * Preenche a seção de cada corte do Clipper (ClipStyler: fill + contorno). O preenchimento é recalculado
   * ao criar e ao soltar o plano (`onDraggingEnded`), nunca durante o arraste, para não travar a interação
   * com o modelo inteiro. É descartado junto com o plano (`delete`/`deleteAll`).
   */
  function estilizarCortes(c: OBC.Components, w: Mundo) {
    const styler = c.get(OBF.ClipStyler)
    styler.world = w
    styler.styles.set(ESTILO_CORTE, {
      fillsMaterial: new THREE.MeshBasicMaterial({ color: cor(PALETA.escuro.corte), side: THREE.DoubleSide }),
      linesMaterial: new LineMaterial({ color: cor(PALETA.escuro.contorno).getHex(), linewidth: 2 }),
    })
    const clipper = c.get(OBC.Clipper)
    const aoCriar = (plano: OBC.SimplePlane) => {
      const entrada = [...clipper.list].find(([, p]) => p === plano)
      if (!entrada) return
      try {
        const bordas = styler.createFromClipping(entrada[0], { items: { corte: { style: ESTILO_CORTE } } })
        void bordas.update().then(() => {
          if (!liberado) w.renderer.needsUpdate = true
        })
      } catch {
        // sem preenchimento: o corte continua valendo
      }
    }
    clipper.onAfterCreate.add(aoCriar)
    limpezas.push(() => clipper.onAfterCreate.remove(aoCriar))
  }

  /** Preenche o corte horizontal de uma planta (acompanha abrir/fechar e atualização da vista). */
  function preencherVista(c: OBC.Components, v: OBC.View) {
    const bordas = c.get(OBF.ClipStyler).createFromView(v, { items: { corte: { style: ESTILO_CORTE } } })
    bordas.visible = v.open
    bordasVistas.set(v.id, bordas)
    void bordas.update()
  }

  /** Recalcula o preenchimento da planta ao abri-la (o cálculo feito ao criar, com a vista fechada, não basta). */
  function atualizarPreenchimentoVista(id: string) {
    const bordas = bordasVistas.get(id)
    if (!bordas) return
    bordas.visible = true
    void bordas.update().then(() => {
      if (!liberado && mundo) mundo.renderer.needsUpdate = true
    })
  }

  function descartarVistas() {
    if (!components) return
    const views = components.get(OBC.Views)
    views.close()
    vistaAberta = null
    habilitarCortes(true)
    for (const id of vistasCriadas) views.list.delete(id)
    bordasVistas.clear()
    vistasCriadas.clear()
  }

  function abrirVista(id: string) {
    const { components: c, mundo: w } = pronto()
    if (caminhando) void alternarCaminhar(false)
    habilitarCortes(false)
    c.get(OBC.Views).open(id)
    vistaAberta = id
    atualizarPreenchimentoVista(id)
    w.renderer.needsUpdate = true
  }

  function fecharVista() {
    const { components: c, mundo: w } = pronto()
    c.get(OBC.Views).close()
    vistaAberta = null
    habilitarCortes(true)
    w.renderer.needsUpdate = true
  }

  async function alternarCaminhar(ligado: boolean) {
    const { mundo: w } = pronto()
    if (ligado) {
      if (vistaAberta) fecharVista()
      // O modo FirstPerson só existe em perspectiva.
      await w.camera.projection.set('Perspective')
      if (liberado) return
      w.camera.set('FirstPerson')
      caminhando = true
    } else {
      caminhando = false
      w.camera.set('Orbit')
    }
  }

  async function criarCorte() {
    const { components: c, mundo: w } = pronto()
    let ponto: THREE.Vector3 | null = null
    const temSelecao = Object.values(selecaoAtual).some((s) => s.size > 0)
    try {
      if (temSelecao) {
        for (const [sigla, ids] of Object.entries(selecaoAtual)) {
          const m = modelo(sigla)
          if (!m || ids.size === 0) continue
          ponto = (await m.getMergedBox([...ids])).getCenter(new THREE.Vector3())
          break
        }
      } else {
        const acerto = await c.get(OBC.Raycasters).get(w).castRay()
        if (acerto) ponto = acerto.point.clone()
      }
    } catch {
      ponto = null
    }
    if (liberado) return
    if (!ponto) {
      const caixa = caixaDosModelos()
      ponto = caixa.isEmpty() ? new THREE.Vector3() : caixa.getCenter(new THREE.Vector3())
    }
    c.get(OBC.Clipper).createFromNormalAndCoplanarPoint(w, new THREE.Vector3(0, -1, 0), ponto)
    // Em planta/elevação os cortes do usuário ficam suspensos até voltar ao 3D.
    if (vistaAberta) habilitarCortes(false)
    emitirCortes()
  }

  // --- Etapa 7: vistas salvas, captura e marcadores de issue
  function vistaAtual(): Vista {
    const { mundo: w } = pronto()
    const ctrl = w.camera.controls
    const pos = ctrl.getPosition(new THREE.Vector3())
    const alvo = ctrl.getTarget(new THREE.Vector3())
    const cam = w.camera.three
    const ortografica = w.camera.projection.current === 'Orthographic'
    return {
      camera: {
        posicao: ponto(pos),
        alvo: ponto(alvo),
        projecao: ortografica ? 'ortografica' : 'perspectiva',
        // `campo`: fov em graus na perspectiva; na ortográfica, a altura visível em metros
        // (o ViewToWorldScale do BCF), para o zoom voltar igual.
        ...(cam instanceof THREE.PerspectiveCamera
          ? { campo: cam.fov }
          : cam instanceof THREE.OrthographicCamera
            ? { campo: (cam.top - cam.bottom) / cam.zoom }
            : {}),
      },
      cortes: listarCortes().map(({ origem, normal }) => ({ origem, normal })),
      selecionados: selecaoRefs,
      ocultos: ocultosRefs,
      isolados: isoladosRefs,
      // `cores` (lista explícita) só vem do BCF; o modo global (`colorirPor`) vai em `modoCor`.
      ...(modoCor !== 'nenhum' ? { modoCor } : {}),
    }
  }

  async function aplicarVista(v: Vista): Promise<void> {
    const { components: c, mundo: w } = pronto()
    if (caminhando) await alternarCaminhar(false)
    if (vistaAberta) fecharVista()
    // Projeção primeiro: ela troca a câmera ativa, e só depois a câmera é posicionada.
    await w.camera.projection.set(v.camera.projecao === 'ortografica' ? 'Orthographic' : 'Perspective')
    if (liberado) return
    if (v.camera.campo && w.camera.three instanceof THREE.PerspectiveCamera) {
      w.camera.three.fov = v.camera.campo
      w.camera.three.updateProjectionMatrix()
    }
    const [px, py, pz] = v.camera.posicao
    const [ax, ay, az] = v.camera.alvo
    // Direto, sem animação: o salto é imediato e o estado fica determinístico.
    await w.camera.controls.setLookAt(px, py, pz, ax, ay, az, false)
    const orto = w.camera.three
    if (v.camera.projecao === 'ortografica' && v.camera.campo && orto instanceof THREE.OrthographicCamera) {
      // Pelos controles, para o camera-controls não sobrescrever o zoom no próximo quadro.
      await w.camera.controls.zoomTo((orto.top - orto.bottom) / v.camera.campo, false)
    }

    // Cortes: substitui os atuais pelos da vista.
    const clipper = c.get(OBC.Clipper)
    clipper.deleteAll()
    for (const corte of v.cortes) {
      clipper.createFromNormalAndCoplanarPoint(
        w,
        new THREE.Vector3(...corte.normal),
        new THREE.Vector3(...corte.origem),
      )
    }
    emitirCortes()

    // Visibilidade: tudo visível, depois isolamento ou ocultos (refs ausentes são ignorados).
    const hider = c.get(OBC.Hider)
    await hider.set(true)
    ocultosRefs = []
    isoladosRefs = null
    if (v.isolados && v.isolados.length) {
      const mapa = await mapaDeRefs(v.isolados)
      if (Object.keys(mapa).length) {
        await hider.isolate(mapa)
        isoladosRefs = v.isolados
      }
    }
    if (v.ocultos.length) {
      const mapa = await mapaDeRefs(v.ocultos)
      if (Object.keys(mapa).length) await hider.set(false, mapa)
      ocultosRefs = v.ocultos
    }

    // Seleção: o Highlighter dispara o evento `selecao` sozinho.
    const h = highlighter!
    const mapaSel = await mapaDeRefs(v.selecionados)
    if (liberado) return
    if (Object.keys(mapaSel).length) await h.highlightByID('select', mapaSel, true, false)
    else await h.clear('select')
    // Cores: modo da vista (ausente = nenhum) e depois as explícitas; some o que havia antes.
    modoCor = v.modoCor ?? 'nenhum'
    emitir('cor', modoCor)
    await aplicarCores(v.cores)
    w.renderer.needsUpdate = true
  }

  /**
   * PNG do que está na tela. O contexto WebGL descarta o buffer depois de apresentado, então em vez
   * de ligar `preserveDrawingBuffer` (que custa desempenho o tempo todo) um quadro é renderizado e
   * copiado para um canvas 2D reduzido no mesmo ciclo síncrono; só depois o PNG é codificado.
   */
  async function capturar(): Promise<Blob> {
    const { mundo: w } = pronto()
    const origem = w.renderer.three.domElement
    w.renderer.needsUpdate = true
    w.renderer.update()
    const { largura, altura } = tamanhoCaptura(origem.width, origem.height)
    if (!largura) throw new Error('canvas sem tamanho para capturar')
    const destino = document.createElement('canvas')
    destino.width = largura
    destino.height = altura
    const ctx = destino.getContext('2d')
    if (!ctx) throw new Error('canvas 2D indisponível')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(origem, 0, 0, largura, altura)
    return new Promise<Blob>((resolve, reject) => {
      destino.toBlob((b) => (b ? resolve(b) : reject(new Error('falha ao gerar o PNG'))), 'image/png')
    })
  }

  /** Pinos HTML sobrepostos ao canvas, reposicionados a cada quadro. */
  let camadaMarcadores: HTMLDivElement | null = null
  let pinos: { posicao: Ponto3; el: HTMLButtonElement }[] = []
  let removerQuadroMarcadores: (() => void) | null = null

  function posicionarMarcadores() {
    if (!mundo || !camadaMarcadores) return
    const cv = mundo.renderer.three.domElement
    const largura = cv.clientWidth
    const altura = cv.clientHeight
    for (const pino of pinos) {
      const t = projetarParaTela(pino.posicao, mundo.camera.three, largura, altura)
      pino.el.style.display = t.visivel ? '' : 'none'
      if (t.visivel) pino.el.style.transform = `translate(${t.x}px, ${t.y}px) translate(-50%, -100%)`
    }
  }

  function limparMarcadores() {
    removerQuadroMarcadores?.()
    removerQuadroMarcadores = null
    camadaMarcadores?.remove()
    camadaMarcadores = null
    pinos = []
  }

  function marcadores(itens: { id: string; posicao: Ponto3; rotulo: string }[]) {
    const { mundo: w } = pronto()
    limparMarcadores()
    if (itens.length === 0) return
    const container = w.renderer.three.domElement.parentElement
    if (!container) return
    const camada = document.createElement('div')
    camada.dataset.testid = 'marcadores-3d'
    Object.assign(camada.style, { position: 'absolute', inset: '0', overflow: 'hidden', pointerEvents: 'none', zIndex: '5' })
    pinos = itens.map((item) => {
      const el = document.createElement('button')
      el.type = 'button'
      el.textContent = item.rotulo
      el.setAttribute('aria-label', `Marcador ${item.rotulo}`)
      el.dataset.marcador = item.id
      Object.assign(el.style, {
        position: 'absolute',
        left: '0',
        top: '0',
        pointerEvents: 'auto',
        cursor: 'pointer',
        background: COR_MARCADOR,
        color: '#1a1004',
        border: '2px solid #fff',
        borderRadius: '12px 12px 12px 2px',
        padding: '2px 8px',
        font: '700 12px/16px system-ui, sans-serif',
        boxShadow: '0 1px 4px rgba(0,0,0,.5)',
        display: 'none',
      })
      // Não deixa o clique no pino virar seleção, medição ou arrasto da câmera.
      for (const tipo of ['pointerdown', 'pointerup', 'dblclick'] as const) el.addEventListener(tipo, (e) => e.stopPropagation())
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        emitir('marcador', { id: item.id })
      })
      camada.append(el)
      return { posicao: item.posicao, el }
    })
    container.append(camada)
    camadaMarcadores = camada
    w.renderer.onAfterUpdate.add(posicionarMarcadores)
    removerQuadroMarcadores = () => w.renderer.onAfterUpdate.remove(posicionarMarcadores)
    posicionarMarcadores()
    w.renderer.needsUpdate = true
  }

  return {
    async montar(el, tema) {
      if (components) throw new Error('motor já montado')
      const c = new OBC.Components()
      components = c
      const w = c.get(OBC.Worlds).create<OBC.SimpleScene, OBC.OrthoPerspectiveCamera, OBF.PostproductionRenderer>()
      w.scene = new OBC.SimpleScene(c)
      w.scene.setup()
      w.renderer = new OBF.PostproductionRenderer(c, el)
      w.renderer.showLogo = false
      w.camera = new OBC.OrthoPerspectiveCamera(c)
      mundo = w as unknown as Mundo
      c.init()
      w.camera.set('Orbit')
      w.camera.three.position.set(30, 25, 30)
      void w.camera.controls.setLookAt(30, 25, 30, 0, 0, 0, false)

      // Contorno de arestas ligado (estilo cor + caneta).
      w.renderer.postproduction.enabled = true
      w.renderer.postproduction.outlinesEnabled = true
      w.renderer.postproduction.style = OBF.PostproductionAspect.COLOR_PEN

      // Grade discreta: células de 5 m e 25 m (1 m gera moiré à distância), esmaecendo com a distância e fora do contorno.
      grade = c.get(OBC.Grids).create(w)
      grade.config.primarySize = 5
      grade.config.secondarySize = 25
      grade.config.distance = 150
      grade.fade = true
      const pos = w.renderer.postproduction
      pos.excludedObjectsPass.addExcludedMaterial(grade.material)
      pos.excludedObjectsEnabled = true

      // Eixos no canto: cena própria desenhada depois de cada quadro.
      const cena = new THREE.Scene()
      const eixos = new THREE.AxesHelper(1)
      cena.add(eixos)
      const camEixos = new THREE.OrthographicCamera(-1.4, 1.4, 1.4, -1.4, 0.1, 10)
      const aoRenderizar = () => desenharEixos(mundo!, { cena, camera: camEixos })
      const renderer = w.renderer
      renderer.onAfterUpdate.add(aoRenderizar)
      limpezas.push(() => {
        renderer.onAfterUpdate.remove(aoRenderizar)
        eixos.geometry.dispose()
        ;(eixos.material as THREE.Material).dispose()
      })

      const f = c.get(OBC.FragmentsManager)
      f.init(workerUrl)
      fragments = f
      const atualizar = () => void f.core.update()
      w.camera.controls.addEventListener('update', atualizar)
      w.camera.controls.addEventListener('rest', atualizar)
      limpezas.push(() => {
        w.camera.controls.removeEventListener('update', atualizar)
        w.camera.controls.removeEventListener('rest', atualizar)
      })
      const usarCamera = (cam: THREE.PerspectiveCamera | THREE.OrthographicCamera) => {
        for (const [, m] of f.list) m.useCamera(cam)
        void f.core.update(true)
      }
      w.camera.projection.onChanged.add(usarCamera)
      // Vistas de planta/elevação trocam a câmera do mundo: os modelos passam a usar a nova.
      const aoTrocarCamera = (cam: OBC.BaseCamera) => usarCamera(cam.three as THREE.PerspectiveCamera | THREE.OrthographicCamera)
      w.onCameraChanged.add(aoTrocarCamera)
      limpezas.push(() => w.onCameraChanged.remove(aoTrocarCamera))
      limpezas.push(() => w.camera.projection.onChanged.remove(usarCamera))
      const aoAdicionar = ({ value: m }: { value: FragmentsModel }) => {
        m.useCamera(w.camera.three)
        w.scene.three.add(m.object)
        void f.core.update(true)
      }
      ligarEntradaMedicao(w.renderer.three.domElement.parentElement ?? w.renderer.three.domElement)
      f.list.onItemSet.add(aoAdicionar)
      limpezas.push(() => f.list.onItemSet.remove(aoAdicionar))

      // Seleção: clique e Ctrl+clique (vários).
      const h = c.get(OBF.Highlighter)
      h.setup({
        world: w,
        selectName: 'select',
        autoHighlightOnClick: true,
        selectEnabled: true,
        selectMaterialDefinition: {
          color: cor(COR_SELECAO),
          renderedFaces: RenderedFaces.ONE,
          opacity: 1,
          transparent: false,
          preserveOriginalMaterial: true,
          _explicitProps: ['color', 'opacity', 'transparent'],
        } as never,
      })
      h.multiple = 'ctrlKey'
      h.zoomToSelection = false
      highlighter = h
      let agendado = false
      const avisarSelecao = () => {
        if (agendado) return
        agendado = true
        queueMicrotask(() => {
          agendado = false
          if (liberado) return
          selecaoAtual = h.selection.select ?? {}
          if (fantasmaLigado) void aplicarFantasma()
          void refsDe(selecaoAtual).then((refs) => {
            if (liberado) return
            selecaoRefs = refs
            emitir('selecao', refs)
          })
        })
      }
      const eventos = h.events.select
      eventos.onHighlight.add(avisarSelecao)
      eventos.onClear.add(avisarSelecao)
      limpezas.push(() => {
        eventos.onHighlight.remove(avisarSelecao)
        eventos.onClear.remove(avisarSelecao)
      })

      // Realce ao passar o cursor (ligável pelas configurações).
      const hv = c.get(OBF.Hoverer)
      hv.world = w
      hv.material = new THREE.MeshBasicMaterial({
        color: cor(COR_HOVER),
        transparent: true,
        opacity: 0.6,
        depthTest: false,
      })
      hv.enabled = true
      hoverer = hv

      // Contorno da seleção.
      const o = c.get(OBF.Outliner)
      o.world = w
      o.color = cor(COR_SELECAO)
      o.thickness = 2
      o.styles.add('select')
      o.enabled = true

      estilizarCortes(c, w as unknown as Mundo)
      this.tema(tema)
      // Só no build de teste (fixture): os e2e inspecionam e comandam o motor por aqui.
      if (import.meta.env.VITE_DADOS === 'fixture') (window as JanelaTeste).__motorCentral = this as MotorVisualizador
    },

    grade(ligado) {
      const { mundo: w } = pronto()
      if (grade) grade.visible = ligado
      w.renderer.needsUpdate = true
    },

    hover(ligado) {
      pronto()
      if (hoverer) hoverer.enabled = ligado
    },

    tema(tema) {
      const { mundo: w } = pronto()
      const p = PALETA[tema]
      w.scene.three.background = new THREE.Color(p.fundo)
      if (grade) grade.config.color = cor(p.grade)
      if (components) {
        const styler = components.get(OBF.ClipStyler)
        const estilo = styler.styles.get(ESTILO_CORTE)
        if (estilo) {
          ;(estilo.fillsMaterial as THREE.MeshBasicMaterial).color.set(p.corte)
          estilo.linesMaterial?.color.set(p.contorno)
          styler.updateStyle(ESTILO_CORTE)
        }
      }
      w.renderer.needsUpdate = true
    },

    async carregar(modelos, progresso) {
      const { mundo: w, fragments: f } = pronto()
      const falhas: string[] = []
      let detalhe: string | undefined
      for (const [i, m] of modelos.entries()) {
        try {
          if (f.list.has(m.sigla)) this.descarregar(m.sigla)
          descartarVistas()
          apagarMedidas()
          // O worker transfere o buffer: cópia para não esvaziar o que veio do cache.
          await f.core.load(m.dados.slice().buffer, { modelId: m.sigla, camera: w.camera.three })
        } catch (e) {
          falhas.push(m.sigla)
          detalhe ??= e instanceof Error ? e.message : undefined
        }
        progresso((i + 1) / modelos.length)
      }
      await f.core.update(true)
      await atualizarOrigemCena(f)
      if (modoCor !== 'nenhum') await aplicarCores()
      if (fantasmaLigado) await aplicarFantasma()
      if (falhas.length) throw new ErroCarregamento(falhas, detalhe)
    },

    descarregar(sigla) {
      const { mundo: w, fragments: f } = pronto()
      const m = modelo(sigla)
      if (!m) return
      descartarVistas()
      apagarMedidas()
      w.scene.three.remove(m.object)
      classes.delete(sigla)
      contagens.delete(sigla)
      guidsCache.delete(sigla)
      ocultosRefs = semSigla(ocultosRefs, sigla)
      selecaoRefs = semSigla(selecaoRefs, sigla)
      if (isoladosRefs) isoladosRefs = semSigla(isoladosRefs, sigla)
      void f.core.disposeModel(sigla)
      void atualizarOrigemCena(f)
    },

    origemCena: () => origem,

    async arvore() {
      const { fragments: f } = pronto()
      const nos: NoArvore[] = []
      for (const [sigla, m] of f.list) {
        const estrutura = (await m.getSpatialStructure()) as NoEstrutura
        const ids = idsDoNo(estrutura)
        const [guids, nomes] = await Promise.all([guidsDe(m, ids), nomesDe(m, ids)])
        nos.push(montarArvore(sigla, estrutura, { nomes, guids }))
      }
      return nos
    },

    async categorias() {
      const { fragments: f } = pronto()
      const listas: CategoriaTotal[][] = []
      for (const [, m] of f.list) {
        await classesDe(m)
        listas.push(contagens.get(m.modelId) ?? [])
      }
      return agregarCategorias(listas)
    },

    selecionar(refs) {
      pronto()
      const h = highlighter!
      if (refs.length === 0) {
        void h.clear('select')
        return
      }
      void mapaDeRefs(refs).then((mapa) => {
        if (liberado) return
        if (Object.keys(mapa).length === 0) void h.clear('select')
        else void h.highlightByID('select', mapa, true, false)
      })
    },

    enquadrar(refs) {
      const { mundo: w } = pronto()
      if (!refs || refs.length === 0) {
        void w.camera.fitToItems()
        return
      }
      void mapaDeRefs(refs).then((mapa) => {
        if (!liberado) void w.camera.fitToItems(Object.keys(mapa).length ? mapa : undefined)
      })
    },

    projecao(p) {
      const { mundo: w } = pronto()
      void w.camera.projection.set(p === 'ortografica' ? 'Orthographic' : 'Perspective')
    },

    ao(evento, cb) {
      const set = ouvintes.get(evento) ?? new Set()
      set.add(cb)
      ouvintes.set(evento, set)
      return () => {
        set.delete(cb)
      }
    },

    liberar() {
      if (liberado) return
      liberado = true
      limparMarcadores()
      delete (window as JanelaTeste).__motorCentral
      ouvintes.clear()
      minimapa?.dispose()
      minimapa = null
      for (const [, t] of ferramentas) t.dispose()
      ferramentas.clear()
      volumesCalculados.clear()
      modoMedicao = null
      for (const l of limpezas.splice(0)) l()
      // `dispose` do Components encerra o worker, o renderer e os componentes.
      components?.dispose()
      components = null
      mundo = null
      fragments = null
      highlighter = null
      hoverer = null
      selecaoAtual = {}
      grade = null
      classes.clear()
      contagens.clear()
      guidsCache.clear()
    },

    // --- Etapa 2b
    ocultar(refs) {
      const { components: c } = pronto()
      ocultosRefs = somarRefs(ocultosRefs, refs)
      void mapaDeRefs(refs).then((mapa) => {
        if (!liberado && Object.keys(mapa).length) void c.get(OBC.Hider).set(false, mapa)
      })
    },

    mostrar(refs) {
      const { components: c } = pronto()
      ocultosRefs = tirarRefs(ocultosRefs, refs)
      if (isoladosRefs) isoladosRefs = somarRefs(isoladosRefs, refs)
      void mapaDeRefs(refs).then((mapa) => {
        if (!liberado && Object.keys(mapa).length) void c.get(OBC.Hider).set(true, mapa)
      })
    },

    isolar(refs) {
      const { components: c } = pronto()
      isoladosRefs = refs.length ? refs : null
      ocultosRefs = []
      void mapaDeRefs(refs).then((mapa) => {
        if (!liberado && Object.keys(mapa).length) void c.get(OBC.Hider).isolate(mapa)
      })
    },

    mostrarTudo() {
      const { components: c } = pronto()
      ocultosRefs = []
      isoladosRefs = null
      void c.get(OBC.Hider).set(true)
    },

    fantasma(ligado) {
      pronto()
      fantasmaLigado = ligado
      void aplicarFantasma()
    },

    colorirPor(modo) {
      pronto()
      modoCor = modo
      void aplicarCores()
    },

    async buscar(filtro: FiltroAtributo) {
      const { components: c } = pronto()
      const consulta: ItemsQueryParams = {}
      if (filtro.classe) consulta.categories = [new RegExp(`^${filtro.classe}$`, 'i')]
      if (filtro.grupo) {
        // Propriedade de pset: elemento -IsDefinedBy-> IFCPROPERTYSET (Name = pset) -HasProperties->
        // IFCPROPERTYSINGLEVALUE (Name = propriedade E NominalValue comparado), com agregação
        // `exclusive` (E) para nome e valor valerem na MESMA propriedade. Limitação: só psets de
        // valor simples (não quantidades `IFCELEMENTQUANTITY`).
        const valor = expressaoDoFiltro(filtro)
        const nomeProp = filtro.atributo ? new RegExp(`^${escaparRegex(filtro.atributo)}$`) : /^.*$/
        consulta.relation = {
          name: 'IsDefinedBy',
          query: {
            categories: [/^IFCPROPERTYSET$/i],
            attributes: { queries: [{ name: /^Name$/, value: new RegExp(`^${escaparRegex(filtro.grupo)}$`) }] },
            relation: {
              name: 'HasProperties',
              query: {
                attributes: {
                  aggregation: 'exclusive',
                  queries: [
                    { name: /^Name$/, value: nomeProp },
                    ...(valor
                      ? [{ name: /^NominalValue$/, value: valor, ...(filtro.operador === 'diferente' ? { negate: true } : {}) }]
                      : []),
                  ],
                },
              },
            },
          },
        }
      } else if (filtro.operador !== 'existe' || filtro.atributo) {
        const valor = expressaoDoFiltro(filtro)
        consulta.attributes = {
          queries: [
            {
              name: new RegExp(`^${filtro.atributo ?? 'Name'}$`),
              ...(valor ? { value: valor } : {}),
              ...(filtro.operador === 'diferente' ? { negate: true } : {}),
            },
          ],
        }
      }
      if (!consulta.categories && !consulta.attributes && !consulta.relation) return []
      const mapa = await c.get(OBC.ItemsFinder).getItems([consulta])
      return refsDe(mapa)
    },
    async existem(refs) {
      const resultado: (boolean | null)[] = refs.map(() => null)
      const porSigla = new Map<string, number[]>()
      refs.forEach((r, i) => porSigla.set(r.sigla, [...(porSigla.get(r.sigla) ?? []), i]))
      for (const [sigla, indices] of porSigla) {
        const m = modelo(sigla)
        if (!m) continue
        const ids = await m.getLocalIdsByGuids(indices.map((i) => refs[i].globalId))
        indices.forEach((i, k) => (resultado[i] = ids[k] !== null && ids[k] !== undefined))
      }
      return resultado
    },
    // --- Etapa 3
    async propriedades(ref: RefElemento) {
      const m = modelo(ref.sigla)
      if (!m) return []
      const [id] = await m.getLocalIdsByGuids([ref.globalId])
      if (id === null || id === undefined) return []
      const [dados] = await m.getItemsData([id], {
        attributesDefault: true,
        relations: RELACOES_PROPRIEDADES,
      })
      return dados ? gruposDeDados(dados as DadosBrutos) : []
    },
    // --- Etapa 4
    vistaPlanta(pavimento) {
      const { components: c, mundo: w } = pronto()
      void (async () => {
        const views = c.get(OBC.Views)
        views.world = w
        if (!views.list.has(pavimento)) {
          // Corte a 1,20 m do piso, em coordenadas de cena (createFromIfcStoreys corta a 0,25 m, na face da laje).
          const altura = await alturaPavimento(pavimento)
          if (altura !== null && !views.list.has(pavimento)) {
            const v = views.createFromPlane(new THREE.Plane(new THREE.Vector3(0, -1, 0), altura), { id: pavimento, world: w })
            v.range = profundidadePlanta()
            vistasCriadas.add(v.id)
            preencherVista(c, v)
          }
        }
        if (!liberado && views.list.has(pavimento)) abrirVista(pavimento)
      })()
    },
    vistaElevacao(lado) {
      const { components: c, mundo: w } = pronto()
      const views = c.get(OBC.Views)
      views.world = w
      const id = ID_ELEVACAO[lado]
      if (!views.list.has(id)) {
        const novas = views.createElevations({
          combine: true,
          world: w,
          // N/S/L/O são do norte do projeto (+Y do IFC), sem rotação de norte verdadeiro: o TrueNorth do ARQ da HTO é (-0,75; -0,66), não (0, 1), então o norte geográfico fica girado (~131°) em relação a elas; a frente (+Z) olha o sul e a esquerda (+X) olha o leste.
          namingCallback: () => ({
            front: ID_ELEVACAO.S,
            back: ID_ELEVACAO.N,
            left: ID_ELEVACAO.L,
            right: ID_ELEVACAO.O,
          }),
        })
        for (const v of novas) vistasCriadas.add(v.id)
      }
      if (views.list.has(id)) abrirVista(id)
    },
    vista3d() {
      pronto()
      fecharVista()
    },
    caminhar(ligado) {
      pronto()
      void alternarCaminhar(ligado)
    },
    minimapa(ligado) {
      const { mundo: w } = pronto()
      if (!ligado) {
        minimapa?.dispose()
        minimapa = null
        return
      }
      if (minimapa) return
      const container = w.renderer.three.domElement.parentElement
      if (!container) return
      const mm = criarMinimapa({
        container,
        renderer: w.renderer.three,
        cena: w.scene.three,
        cameraPrincipal: () => w.camera.three,
        caixa: caixaDosModelos,
      })
      minimapa = mm
      // Redesenho no máximo a cada 80 ms, depois de cada quadro da vista principal.
      let ultimo = 0
      const aoQuadro = () => {
        const agora = performance.now()
        if (agora - ultimo < 80) return
        ultimo = agora
        mm.desenhar()
      }
      w.renderer.onAfterUpdate.add(aoQuadro)
      const dispose = mm.dispose
      mm.dispose = () => {
        w.renderer.onAfterUpdate.remove(aoQuadro)
        dispose()
      }
      mm.desenhar()
    },
    cortes: {
      criar() {
        pronto()
        void criarCorte()
      },
      apagar(id) {
        const { components: c, mundo: w } = pronto()
        const clipper = c.get(OBC.Clipper)
        if (id) void clipper.delete(w, id).then(emitirCortes)
        else {
          clipper.deleteAll()
          emitirCortes()
        }
      },
      listar: listarCortes,
    },
    medir: {
      modo(m) {
        definirModoMedicao(m)
      },
      listar: listarMedidas,
      apagar(id) {
        pronto()
        apagarMedidas(id)
        if (id === undefined) emitirMedicoes()
      },
    },
    // --- Etapa 7
    vistaAtual,
    aplicarVista,
    capturar,
    marcadores,
  }
}
