import * as OBC from '@thatopen/components'
import CameraControls from 'camera-controls'
import workerUrl from '@thatopen/fragments/worker?url'
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { type GeometriaAmbiente } from '@modules/ra/domain/tipos.ts'
import { caixaDeCorte } from '@modules/ra/infra/three/geometria3d.ts'
import { planosDeCorte, posicaoInterna } from './corte.ts'
import { ordenarPorReferencia, temWebGL, type ModeloFrag } from './modelos.ts'

type Estado = { tipo: 'carregando'; texto: string } | { tipo: 'pronto' } | { tipo: 'erro'; texto: string }

interface Props {
  modelos: ModeloFrag[]
  /** Entrega o conteúdo do `.frag` (do cache do aparelho ou da rede). */
  baixar: (modelo: ModeloFrag) => Promise<ArrayBuffer>
  /** Siglas visíveis. */
  ativos: ReadonlySet<string>
  /** Prévia da tela da obra: sem botão Enquadrar e sem resposta a toque ou arrasto. */
  previa?: boolean
  /** Ambiente do QR: o modelo é cortado em volta dele (chip liga/desliga) e a câmera nasce por dentro, no centro. */
  ambiente?: GeometriaAmbiente
}

interface Motor {
  components: OBC.Components
  world: OBC.SimpleWorld<OBC.SimpleScene, OBC.SimpleCamera, OBC.SimpleRenderer>
  fragments: OBC.FragmentsManager
}

/** Distância câmera-alvo na vista interna: pequena, para o arrasto girar a vista no lugar. */
const DIST_ALVO = 0.01

function mostrar(objeto: THREE.Object3D, visivel: boolean) {
  objeto.visible = visivel
}

/** Visualizador 3D do modelo federado (That Open Engine). Carregado sob demanda pela tela Modelo. */
export default function VisualizadorModelo({ modelos, baixar, ativos, previa = false, ambiente }: Props) {
  const contenedor = useRef<HTMLDivElement>(null)
  const motor = useRef<Motor | null>(null)
  const [estado, setEstado] = useState<Estado>(() =>
    temWebGL()
      ? { tipo: 'carregando', texto: 'Preparando o visualizador…' }
      : { tipo: 'erro', texto: 'Este aparelho não permite exibir o modelo 3D.' },
  )
  const ativosRef = useRef(ativos)
  const [soAmbiente, setSoAmbiente] = useState(true)
  const soAmbienteRef = useRef(true)
  // Mesmo array passado ao load e ao renderer: esvaziar/preencher liga/desliga o corte sem recarregar.
  const planosRef = useRef<THREE.Plane[]>([])
  const ambienteRef = useRef(ambiente)

  function enquadrar(animar: boolean) {
    const m = motor.current
    if (!m) return
    const amb = ambienteRef.current
    if (amb) {
      // Câmera por dentro: gira em volta de si (alvo colado na câmera) e anda pelo ambiente.
      const c = posicaoInterna(amb)
      void m.world.camera.controls.setLookAt(c.x, c.y, c.z + DIST_ALVO, c.x, c.y, c.z, animar)
      return
    }
    const caixa = new THREE.Box3()
    for (const [id, modelo] of m.fragments.list) {
      if (!ativosRef.current.has(id)) continue
      modelo.object.updateWorldMatrix(true, false)
      caixa.union(modelo.box.clone().applyMatrix4(modelo.object.matrixWorld))
    }
    if (caixa.isEmpty()) return
    void m.world.camera.controls.fitToBox(caixa, animar, { paddingLeft: 0.1, paddingRight: 0.1, paddingTop: 0.1, paddingBottom: 0.1 })
  }

  useEffect(() => {
    const el = contenedor.current
    if (!el || !temWebGL()) return
    let cancelado = false
    ambienteRef.current = ambiente
    const planos = planosRef.current
    planos.length = 0
    if (ambiente && soAmbienteRef.current) planos.push(...planosDeCorte(caixaDeCorte(ambiente)))

    const components = new OBC.Components()
    const world = components.get(OBC.Worlds).create<OBC.SimpleScene, OBC.SimpleCamera, OBC.SimpleRenderer>()
    world.scene = new OBC.SimpleScene(components)
    world.scene.setup()
    world.renderer = new OBC.SimpleRenderer(components, el)
    world.renderer.showLogo = false
    world.camera = new OBC.SimpleCamera(components)
    if (ambiente) world.renderer.three.clippingPlanes = planos
    components.init()
    if (previa) world.camera.controls.enabled = false
    if (ambiente) {
      const ctl = world.camera.controls
      ctl.minDistance = DIST_ALVO
      ctl.maxDistance = DIST_ALVO
      ctl.verticalDragToForward = true
      ctl.mouseButtons.wheel = CameraControls.ACTION.ZOOM
      ctl.touches.two = CameraControls.ACTION.TOUCH_ZOOM_TRUCK
      ctl.minZoom = 0.5
      ctl.maxZoom = 4
      world.camera.three.near = 0.05
      world.camera.three.updateProjectionMatrix()
    }

    const fragments = components.get(OBC.FragmentsManager)
    fragments.init(workerUrl)
    // Todos os modelos entram no referencial do .frag de referência (igual ao motor da RA).
    if (ambiente?.referencial) fragments.core.baseCoordinates = [...ambiente.referencial.coordenadas]
    world.camera.controls.addEventListener('update', () => fragments.core.update())
    fragments.list.onItemSet.add(({ value: modelo }) => {
      modelo.useCamera(world.camera.three)
      world.scene.three.add(modelo.object)
      fragments.core.update(true)
    })
    motor.current = { components, world, fragments }

    void (async () => {
      try {
        const ordem = ordenarPorReferencia(modelos, ambiente?.referencial?.sigla ?? 'ARQ')
        for (const [i, m] of ordem.entries()) {
          setEstado({ tipo: 'carregando', texto: `Carregando ${m.sigla} (${i + 1} de ${ordem.length})…` })
          const buffer = await baixar(m)
          if (cancelado) return
          const modelo = await fragments.core.load(buffer, { modelId: m.sigla, clippingPlanes: planos })
          if (cancelado) return
          const correcao = ambiente?.matrizes[m.sigla] ?? m.matriz
          if (correcao?.length === 16) modelo.object.applyMatrix4(new THREE.Matrix4().fromArray(correcao))
          mostrar(modelo.object, ativosRef.current.has(m.sigla))
        }
        await fragments.core.update(true)
        if (cancelado) return
        enquadrar(false)
        setEstado({ tipo: 'pronto' })
      } catch (e) {
        if (!cancelado) setEstado({ tipo: 'erro', texto: e instanceof Error ? e.message : 'Falha ao abrir o modelo.' })
      }
    })()

    return () => {
      cancelado = true
      motor.current = null
      components.dispose()
    }
    // enquadrar só lê refs; o motor é recriado apenas se a obra ou a lista mudarem.
  }, [modelos, baixar, previa, ambiente])

  useEffect(() => {
    ativosRef.current = ativos
    const m = motor.current
    if (!m) return
    for (const [id, modelo] of m.fragments.list) mostrar(modelo.object, ativos.has(id))
    void m.fragments.core.update(true)
  }, [ativos])

  useEffect(() => {
    soAmbienteRef.current = soAmbiente
    const amb = ambienteRef.current
    const m = motor.current
    if (!amb || !m) return
    const planos = planosRef.current
    planos.length = 0
    if (soAmbiente) planos.push(...planosDeCorte(caixaDeCorte(amb)))
    void m.fragments.core.update(true)
  }, [soAmbiente])

  return (
    <div className={previa ? 'visualizador-modelo visualizador-previa' : 'visualizador-modelo'}>
      <div ref={contenedor} className="visualizador-tela" role="img" aria-label="Modelo 3D federado" />
      {estado.tipo === 'carregando' && (
        <p className="visualizador-aviso" role="status">
          {estado.texto}
        </p>
      )}
      {estado.tipo === 'erro' && (
        <p className="visualizador-aviso visualizador-erro" role="alert">
          {estado.texto}
        </p>
      )}
      {estado.tipo === 'pronto' && !previa && (
        <button type="button" className="botao visualizador-enquadrar" onClick={() => enquadrar(true)}>
          {ambiente ? 'Voltar ao centro' : 'Enquadrar'}
        </button>
      )}
      {estado.tipo === 'pronto' && !previa && ambiente && (
        <button type="button" className="botao visualizador-chip" aria-pressed={soAmbiente} onClick={() => setSoAmbiente((v) => !v)}>
          Só este ambiente
        </button>
      )}
    </div>
  )
}
