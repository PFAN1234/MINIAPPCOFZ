/** Cena 3D da RA: modelos `.frag` recortados em volta do ambiente e o contorno de conferência. */
import { FragmentsModels, type FragmentsModel } from '@thatopen/fragments'
import workerUrl from '@thatopen/fragments/worker?url'
import * as THREE from 'three'
import type { ModeloFrag } from '../modelo/modelos.ts'
import { arestasDoAmbiente, caixaDeCorte, type GeometriaAmbiente } from './geometria.ts'
import { gradeDeProcura, malhaDoAmbiente } from './malha.ts'
import { orientacaoNoMundo, type Pose } from './pose.ts'

/** Altura da câmera acima do piso na grade de procura (a do celular na mão). */
const ALTURA_PROCURA = 1.4

function segmentosDeLinha(vertices: number[], cor: number, opacidade: number): THREE.LineSegments {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  const l = new THREE.LineSegments(
    g,
    new THREE.LineBasicMaterial({
      color: cor,
      transparent: true,
      opacity: opacidade,
      depthTest: false,
    }),
  )
  l.renderOrder = 5
  l.frustumCulled = false
  return l
}

export class MotorRA {
  private readonly renderer: THREE.WebGLRenderer
  private readonly cena = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(60, 1, 0.05, 200)
  private readonly fragments: FragmentsModels
  private readonly modelos = new Map<string, FragmentsModel>()
  private readonly planos: THREE.Plane[]
  private readonly geometria: GeometriaAmbiente
  private readonly contorno: THREE.LineSegments
  private readonly grupoMalha = new THREE.Group()
  private readonly grupoProcura = new THREE.Group()
  private siglasVisiveis: ReadonlySet<string> | null = null
  private malhaLigada = true
  private emProcura = false
  private descartado = false

  constructor(canvas: HTMLCanvasElement, geometria: GeometriaAmbiente) {
    this.geometria = geometria
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
    })
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
      new THREE.LineBasicMaterial({
        color: 0xf5b700,
        depthTest: false,
        transparent: true,
      }),
    )
    contorno.renderOrder = 10
    contorno.frustumCulled = false
    this.contorno = contorno
    this.cena.add(contorno)

    const malha = malhaDoAmbiente(geometria)
    this.grupoMalha.add(
      segmentosDeLinha(malha.piso, 0x34d1ff, 0.35),
      segmentosDeLinha(malha.paredes, 0xffffff, 0.35),
      segmentosDeLinha(malha.teto, 0xffffff, 0.2),
    )
    this.cena.add(this.grupoMalha)

    this.grupoProcura.add(segmentosDeLinha(gradeDeProcura(), 0x34d1ff, 0.35))
    this.grupoProcura.visible = false
    this.cena.add(this.grupoProcura)

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
      modelo.object.visible = !this.emProcura && (this.siglasVisiveis?.has(m.sigla) ?? true)
      this.cena.add(modelo.object)
      this.modelos.set(m.sigla, modelo)
    }
    await this.fragments.update(true)
  }

  definirVisiveis(siglas: ReadonlySet<string>): void {
    this.siglasVisiveis = siglas
    this.aplicarVisibilidade()
    void this.fragments.update(true)
  }

  /** Liga ou desliga a malha do ambiente (piso, paredes e teto). */
  definirMalha(visivel: boolean): void {
    this.malhaLigada = visivel
    this.aplicarVisibilidade()
  }

  private aplicarVisibilidade(): void {
    for (const [sigla, modelo] of this.modelos) {
      modelo.object.visible = !this.emProcura && (this.siglasVisiveis?.has(sigla) ?? true)
    }
    this.contorno.visible = !this.emProcura
    this.grupoMalha.visible = !this.emProcura && this.malhaLigada
    this.grupoProcura.visible = this.emProcura
  }

  private mudarModo(procura: boolean): void {
    if (this.emProcura === procura) return
    this.emProcura = procura
    this.aplicarVisibilidade()
    void this.fragments.update(true)
  }

  redimensionar(largura: number, altura: number): void {
    this.renderer.setSize(largura, altura, false)
    this.camera.aspect = largura / Math.max(1, altura)
  }

  /** Posiciona a câmera pela pose e pela orientação atual do aparelho. */
  posicionar(pose: Pose, q: THREE.Quaternion, fovGraus: number): void {
    this.mudarModo(false)
    this.ajustarCamera(pose, q, fovGraus)
  }

  private ajustarCamera(pose: Pose, q: THREE.Quaternion, fovGraus: number): void {
    this.camera.fov = fovGraus
    this.camera.position.copy(pose.posicao)
    this.camera.quaternion.copy(orientacaoNoMundo(pose, q))
    this.camera.updateProjectionMatrix()
    this.camera.updateMatrixWorld(true)
    void this.fragments.update()
  }

  /**
   * Sem pose: só a grade de procura no piso, com a câmera a 1,4 m acima dela,
   * em volta do centroide do contorno e com rumo 0.
   */
  posicionarProcura(q: THREE.Quaternion, fovGraus: number): void {
    this.mudarModo(true)
    const n = this.geometria.contorno.length || 1
    const cx = this.geometria.contorno.reduce((s, p) => s + p[0], 0) / n
    const cz = this.geometria.contorno.reduce((s, p) => s + p[1], 0) / n
    this.grupoProcura.position.set(cx, this.geometria.yPiso, cz)
    this.grupoProcura.updateMatrixWorld(true)
    this.ajustarCamera(
      {
        posicao: new THREE.Vector3(cx, this.geometria.yPiso + ALTURA_PROCURA, cz),
        rumo: 0,
      },
      q,
      fovGraus,
    )
  }

  renderizar(opcoes?: { semMalha?: boolean }): void {
    const visivel = this.grupoMalha.visible
    if (opcoes?.semMalha) this.grupoMalha.visible = false
    this.renderer.render(this.cena, this.camera)
    this.grupoMalha.visible = visivel
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
