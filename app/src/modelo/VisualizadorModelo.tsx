import * as OBC from '@thatopen/components'
import workerUrl from '@thatopen/fragments/worker?url'
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import type { ModeloFrag } from './modelos.ts'

type Estado = { tipo: 'carregando'; texto: string } | { tipo: 'pronto' } | { tipo: 'erro'; texto: string }

interface Props {
  modelos: ModeloFrag[]
  /** Entrega o conteúdo do `.frag` (do cache do aparelho ou da rede). */
  baixar: (modelo: ModeloFrag) => Promise<ArrayBuffer>
  /** Siglas visíveis. */
  ativos: ReadonlySet<string>
}

interface Motor {
  components: OBC.Components
  world: OBC.SimpleWorld<OBC.SimpleScene, OBC.SimpleCamera, OBC.SimpleRenderer>
  fragments: OBC.FragmentsManager
}

function temWebGL(): boolean {
  try {
    return Boolean(document.createElement('canvas').getContext('webgl2'))
  } catch {
    return false
  }
}

function mostrar(objeto: THREE.Object3D, visivel: boolean) {
  objeto.visible = visivel
}

/** Visualizador 3D do modelo federado (That Open Engine). Carregado sob demanda pela tela Modelo. */
export default function VisualizadorModelo({ modelos, baixar, ativos }: Props) {
  const contenedor = useRef<HTMLDivElement>(null)
  const motor = useRef<Motor | null>(null)
  const [estado, setEstado] = useState<Estado>(() =>
    temWebGL()
      ? { tipo: 'carregando', texto: 'Preparando o visualizador…' }
      : { tipo: 'erro', texto: 'Este aparelho não permite exibir o modelo 3D.' },
  )
  const ativosRef = useRef(ativos)

  function enquadrar(animar: boolean) {
    const m = motor.current
    if (!m) return
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

    const components = new OBC.Components()
    const world = components.get(OBC.Worlds).create<OBC.SimpleScene, OBC.SimpleCamera, OBC.SimpleRenderer>()
    world.scene = new OBC.SimpleScene(components)
    world.scene.setup()
    world.renderer = new OBC.SimpleRenderer(components, el)
    world.renderer.showLogo = false
    world.camera = new OBC.SimpleCamera(components)
    components.init()

    const fragments = components.get(OBC.FragmentsManager)
    fragments.init(workerUrl)
    world.camera.controls.addEventListener('update', () => fragments.core.update())
    fragments.list.onItemSet.add(({ value: modelo }) => {
      modelo.useCamera(world.camera.three)
      world.scene.three.add(modelo.object)
      fragments.core.update(true)
    })
    motor.current = { components, world, fragments }

    void (async () => {
      try {
        for (const [i, m] of modelos.entries()) {
          setEstado({ tipo: 'carregando', texto: `Carregando ${m.sigla} (${i + 1} de ${modelos.length})…` })
          const buffer = await baixar(m)
          if (cancelado) return
          const modelo = await fragments.core.load(buffer, { modelId: m.sigla })
          if (cancelado) return
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
  }, [modelos, baixar])

  useEffect(() => {
    ativosRef.current = ativos
    const m = motor.current
    if (!m) return
    for (const [id, modelo] of m.fragments.list) mostrar(modelo.object, ativos.has(id))
    void m.fragments.core.update(true)
  }, [ativos])

  return (
    <div className="visualizador-modelo">
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
      {estado.tipo === 'pronto' && (
        <button type="button" className="botao visualizador-enquadrar" onClick={() => enquadrar(true)}>
          Enquadrar
        </button>
      )}
    </div>
  )
}
