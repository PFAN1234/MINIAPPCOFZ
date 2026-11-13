/** Cena 3D da RA: modelos `.frag` recortados em volta do ambiente e o contorno de conferência. */
import { FragmentsModels, type FragmentsModel } from '@thatopen/fragments'
import workerUrl from '@thatopen/fragments/worker?url'
import * as THREE from 'three'
import type { ModeloFrag } from '../modelo/modelos.ts'
import { arestasDoAmbiente, caixaDeCorte, type GeometriaAmbiente } from './geometria.ts'
import { orientacaoNoMundo, type Pose } from './pose.ts'

export class MotorRA {
  private readonly renderer: THREE.WebGLRenderer
  private readonly cena = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(60, 1, 0.05, 200)
  private readonly fragments: FragmentsModels
  private readonly modelos = new Map<string, FragmentsModel>()
  private readonly planos: THREE.Plane[]
  private readonly geometria: GeometriaAmbiente
  private descartado = false

  constructor(canvas: HTMLCanvasElement, geometria: GeometriaAmbiente) {
    this.geometria = geometria
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))

    const [x0, y0, z0, x1, y1, z1] = caixaDeCorte(geometria)
    this.planos = [
      new THREE.Plane(new THREE.Vector3(1, 0, 0), -x0),
      new THREE.Plane(new THREE.Vector3(-1, 0, 0), x1),
      new THREE.Plane(new THREE.Vector3(0, 1, 0), -y0),
      new THREE.Plane(new THREE.Vector3(0, -1, 0), y1),
      new THREE.Plane(new THREE.Vector3(0, 0, 1), -z0),
      new THREE.Plane(new THREE.Vector3(0, 0, -1), z1),
    ]
    this.renderer.clippingPlanes = this.planos

    this.cena.add(new THREE.AmbientLight(0xffffff, 1.6))
    const sol = new THREE.DirectionalLight(0xffffff, 1.2)
    sol.position.set(3, 8, 5)
    this.cena.add(sol)

    const linhas = new THREE.BufferGeometry()
    linhas.setAttribute('position', new THREE.Float32BufferAttribute(arestasDoAmbiente(geometria), 3))
    const contorno = new THREE.LineSegments(
      linhas,
      new THREE.LineBasicMaterial({ color: 0xf5b700, depthTest: false, transparent: true }),
    )
    contorno.renderOrder = 10
    contorno.frustumCulled = false
    this.cena.add(contorno)

    this.fragments = new FragmentsModels(workerUrl)
    // Todos os modelos entram no referencial do .frag de referência (ARQ).
    if (geometria.referencial) this.fragments.baseCoordinates = [...geometria.referencial.coordenadas]
  }

  /** Carrega os modelos, um por vez. O de referência vai primeiro para alinhar os demais. */
  async carregar(
    modelos: ModeloFrag[],
    baixar: (m: ModeloFrag) => Promise<ArrayBuffer>,
    aoProgredir: (texto: string) => void,
  ): Promise<void> {
    const referencia = this.geometria.referencial?.sigla
    const ordem = [...modelos].sort((a, b) => Number(b.sigla === referencia) - Number(a.sigla === referencia))
    for (const [i, m] of ordem.entries()) {
      aoProgredir(`Carregando ${m.sigla} (${i + 1} de ${ordem.length})…`)
      const buffer = await baixar(m)
      if (this.descartado) return
      const modelo = await this.fragments.load(buffer, {
        modelId: m.sigla,
        camera: this.camera,
        clippingPlanes: this.planos,
      })
      if (this.descartado) return
      const correcao = this.geometria.matrizes[m.sigla]
      if (correcao?.length === 16) modelo.object.applyMatrix4(new THREE.Matrix4().fromArray(correcao))
      this.cena.add(modelo.object)
      this.modelos.set(m.sigla, modelo)
    }
    await this.fragments.update(true)
  }

  definirVisiveis(siglas: ReadonlySet<string>): void {
    for (const [sigla, modelo] of this.modelos) modelo.object.visible = siglas.has(sigla)
    void this.fragments.update(true)
  }

  redimensionar(largura: number, altura: number): void {
    this.renderer.setSize(largura, altura, false)
    this.camera.aspect = largura / Math.max(1, altura)
  }

  /** Posiciona a câmera pela pose e pela orientação atual do aparelho. */
  posicionar(pose: Pose, q: THREE.Quaternion, fovGraus: number): void {
    this.camera.fov = fovGraus
    this.camera.position.copy(pose.posicao)
    this.camera.quaternion.copy(orientacaoNoMundo(pose, q))
    this.camera.updateProjectionMatrix()
    this.camera.updateMatrixWorld(true)
    void this.fragments.update()
  }

  renderizar(): void {
    this.renderer.render(this.cena, this.camera)
  }

  limpar(): void {
    this.renderer.clear()
  }

  descartar(): void {
    this.descartado = true
    void this.fragments.dispose()
    this.renderer.dispose()
  }
}
