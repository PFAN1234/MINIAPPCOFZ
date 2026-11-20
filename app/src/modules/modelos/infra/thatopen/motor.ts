/**
 * Adaptador That Open do motor da Central de modelos. É a única pasta da central que importa
 * `@thatopen/*`, `three` e `camera-controls`; a tela só conhece a porta `MotorVisualizador`.
 * Carregado por `import()` dinâmico no composition root do admin (chunk próprio).
 *
 * Etapas 2a e 2b: montar, tema, grade, carregar/descarregar, árvore, categorias (só elementos com
 * geometria), seleção (+ evento), enquadrar, projeção, contorno de arestas, eixos no canto,
 * ocultar/isolar/fantasma, cores por categoria/disciplina, busca, hover e contorno da seleção.
 * O resto lança "não implementado (etapa N)" até a etapa do contrato.
 */
import * as OBC from '@thatopen/components'
import * as OBF from '@thatopen/components-front'
import { RenderedFaces, type FragmentsModel, type ItemsQueryParams } from '@thatopen/fragments'
import workerUrl from '@thatopen/fragments/worker?url'
import * as THREE from 'three'
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
  type NoArvore,
  type NoEstrutura,
  type RefElemento,
} from '../../domain/central.ts'

type Mundo = OBC.World & {
  scene: OBC.SimpleScene
  camera: OBC.OrthoPerspectiveCamera
  renderer: OBF.PostproductionRenderer
}

const PALETA: Record<TemaCentral, { fundo: string; grade: string }> = {
  escuro: { fundo: '#16161a', grade: '#2c2c34' },
  claro: { fundo: '#f4f4f6', grade: '#d2d2da' },
}

const COR_SELECAO = '#7c4dff'
const COR_HOVER = '#b39dff'
const OPACIDADE_FANTASMA = 0.1
/** Acima disso a classe vem do mapa completo do modelo; abaixo, item a item. */
const LIMITE_CLASSE_POR_ITEM = 300

const TAMANHO_EIXOS = 84
const LOTE_NOMES = 4000

const naoImplementado = (etapa: number): never => {
  throw new Error(`não implementado (etapa ${etapa})`)
}

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

  async function aplicarCores() {
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
      limpezas.push(() => w.camera.projection.onChanged.remove(usarCamera))
      const aoAdicionar = ({ value: m }: { value: FragmentsModel }) => {
        m.useCamera(w.camera.three)
        w.scene.three.add(m.object)
        void f.core.update(true)
      }
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
            if (!liberado) emitir('selecao', refs)
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

      this.tema(tema)
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
      w.renderer.needsUpdate = true
    },

    async carregar(modelos, progresso) {
      const { mundo: w, fragments: f } = pronto()
      const falhas: string[] = []
      let detalhe: string | undefined
      for (const [i, m] of modelos.entries()) {
        try {
          if (f.list.has(m.sigla)) this.descarregar(m.sigla)
          // O worker transfere o buffer: cópia para não esvaziar o que veio do cache.
          await f.core.load(m.dados.slice().buffer, { modelId: m.sigla, camera: w.camera.three })
        } catch (e) {
          falhas.push(m.sigla)
          detalhe ??= e instanceof Error ? e.message : undefined
        }
        progresso((i + 1) / modelos.length)
      }
      await f.core.update(true)
      if (modoCor !== 'nenhum') await aplicarCores()
      if (fantasmaLigado) await aplicarFantasma()
      if (falhas.length) throw new ErroCarregamento(falhas, detalhe)
    },

    descarregar(sigla) {
      const { mundo: w, fragments: f } = pronto()
      const m = modelo(sigla)
      if (!m) return
      w.scene.three.remove(m.object)
      classes.delete(sigla)
      contagens.delete(sigla)
      guidsCache.delete(sigla)
      void f.core.disposeModel(sigla)
    },

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
      ouvintes.clear()
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
      void mapaDeRefs(refs).then((mapa) => {
        if (!liberado && Object.keys(mapa).length) void c.get(OBC.Hider).set(false, mapa)
      })
    },

    mostrar(refs) {
      const { components: c } = pronto()
      void mapaDeRefs(refs).then((mapa) => {
        if (!liberado && Object.keys(mapa).length) void c.get(OBC.Hider).set(true, mapa)
      })
    },

    isolar(refs) {
      const { components: c } = pronto()
      void mapaDeRefs(refs).then((mapa) => {
        if (!liberado && Object.keys(mapa).length) void c.get(OBC.Hider).isolate(mapa)
      })
    },

    mostrarTudo() {
      const { components: c } = pronto()
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
      if (filtro.operador !== 'existe' || filtro.atributo) {
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
      if (!consulta.categories && !consulta.attributes) return []
      const mapa = await c.get(OBC.ItemsFinder).getItems([consulta])
      return refsDe(mapa)
    },
    // --- Etapa 3
    propriedades: () => naoImplementado(3),
    // --- Etapa 4
    vistaPlanta: () => naoImplementado(4),
    vistaElevacao: () => naoImplementado(4),
    vista3d: () => naoImplementado(4),
    caminhar: () => naoImplementado(4),
    cortes: {
      criar: () => naoImplementado(4),
      apagar: () => naoImplementado(4),
      listar: () => naoImplementado(4),
    },
    medir: {
      modo: () => naoImplementado(4),
      listar: () => naoImplementado(4),
      apagar: () => naoImplementado(4),
    },
    // --- Etapa 7
    vistaAtual: () => naoImplementado(7),
    aplicarVista: () => naoImplementado(7),
    capturar: () => naoImplementado(7),
    marcadores: () => naoImplementado(7),
  }
}
