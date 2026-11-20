/**
 * Adaptador That Open do motor da Central de modelos. É a única pasta da central que importa
 * `@thatopen/*`, `three` e `camera-controls`; a tela só conhece a porta `MotorVisualizador`.
 * Carregado por `import()` dinâmico no composition root do admin (chunk próprio).
 *
 * Etapa 2a: montar, tema, carregar/descarregar, árvore, categorias, selecionar (+ evento),
 * enquadrar, projeção, contorno de arestas, eixos no canto e liberar. O resto lança
 * "não implementado (etapa N)" até a etapa do contrato.
 */
import * as OBC from '@thatopen/components'
import * as OBF from '@thatopen/components-front'
import type { FragmentsModel } from '@thatopen/fragments'
import workerUrl from '@thatopen/fragments/worker?url'
import * as THREE from 'three'
import type { EventoMotor, MotorVisualizador, TemaCentral } from '../../application/ports/MotorVisualizador.port.ts'
import {
  ErroCarregamento,
  agregarCategorias,
  montarArvore,
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
  escuro: { fundo: '#16161a', grade: '#3a3a44' },
  claro: { fundo: '#f4f4f6', grade: '#c4c4cc' },
}

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
    const por = await m.getItemsOfCategories(categorias.map((c) => new RegExp(`^${c}$`)))
    const mapa = new Map<number, string>()
    const totais: CategoriaTotal[] = []
    for (const [classe, ids] of Object.entries(por)) {
      for (const id of ids) mapa.set(id, classe)
      if (ids.length) totais.push({ classe, total: ids.length })
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
      const [guids, nomes, cls] = await Promise.all([guidsDe(m, ids), nomesDe(m, ids), classesDe(m)])
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

  function desenharEixos(m: Mundo, gizmo: { cena: THREE.Scene; camera: THREE.OrthographicCamera }) {
    const r = m.renderer.three
    const q = m.camera.three.quaternion
    gizmo.camera.position.set(0, 0, 3).applyQuaternion(q)
    gizmo.camera.quaternion.copy(q)
    const autoClear = r.autoClear
    const viewport = r.getViewport(new THREE.Vector4())
    r.autoClear = false
    r.setViewport(8, 8, TAMANHO_EIXOS, TAMANHO_EIXOS)
    r.setScissor(8, 8, TAMANHO_EIXOS, TAMANHO_EIXOS)
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

      grade = c.get(OBC.Grids).create(w)

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
      h.setup({ world: w, selectName: 'select', autoHighlightOnClick: true, selectEnabled: true })
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
          void refsDe(h.selection.select ?? {}).then((refs) => {
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

      this.tema(tema)
    },

    tema(tema) {
      const { mundo: w } = pronto()
      const p = PALETA[tema]
      w.scene.three.background = new THREE.Color(p.fundo)
      if (grade) grade.config.color = new THREE.Color(p.grade)
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
      grade = null
      classes.clear()
      contagens.clear()
      guidsCache.clear()
    },

    // --- Etapa 2b
    ocultar: () => naoImplementado(2),
    isolar: () => naoImplementado(2),
    mostrarTudo: () => naoImplementado(2),
    fantasma: () => naoImplementado(2),
    colorirPor: () => naoImplementado(2),
    buscar: () => naoImplementado(2),
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
