/**
 * Minimapa do motor That Open: segunda câmera ortográfica de topo, desenhada num canvas pequeno
 * (2D) no canto do container. O quadro é renderizado pelo renderer principal num alvo fora da tela
 * e copiado para o canvas (um segundo contexto WebGL derrubava o Chromium com WebGL por software), com um marcador (seta) na posição e direção da câmera principal.
 * O marcador vive na camada 1 da cena: só a câmera do minimapa a enxerga.
 */
import * as THREE from 'three'

const TAMANHO = 180
const CAMADA_MARCADOR = 1

interface Entradas {
  /** Elemento que recebe o canvas do minimapa. */
  container: HTMLElement
  /** Renderer da vista principal (reaproveitado: nada de segundo contexto WebGL). */
  renderer: THREE.WebGLRenderer
  cena: THREE.Scene
  /** Câmera principal em uso (muda quando uma vista de planta/elevação abre). */
  cameraPrincipal(): THREE.Camera
  /** Caixa de todos os modelos carregados (vazia quando não há modelo). */
  caixa(): THREE.Box3
}

export interface Minimapa {
  /** Redesenha; chamar depois de cada quadro da vista principal. */
  desenhar(): void
  dispose(): void
}

export function criarMinimapa({ container, renderer, cena, cameraPrincipal, caixa }: Entradas): Minimapa {
  const canvas = document.createElement('canvas')
  canvas.setAttribute('data-testid', 'minimapa')
  canvas.setAttribute('aria-label', 'Minimapa')
  canvas.setAttribute('role', 'img')
  Object.assign(canvas.style, {
    position: 'absolute',
    right: '12px',
    bottom: '64px',
    width: `${TAMANHO}px`,
    height: `${TAMANHO}px`,
    border: '1px solid rgba(124, 77, 255, 0.7)',
    borderRadius: '6px',
    background: 'rgba(0, 0, 0, 0.25)',
    pointerEvents: 'none',
    zIndex: '3',
  })
  container.appendChild(canvas)

  const contexto = canvas.getContext('2d')
  canvas.width = TAMANHO
  canvas.height = TAMANHO
  const alvo = new THREE.WebGLRenderTarget(TAMANHO, TAMANHO)
  alvo.texture.colorSpace = THREE.SRGBColorSpace
  const pixels = new Uint8Array(TAMANHO * TAMANHO * 4)
  const imagem = new ImageData(TAMANHO, TAMANHO)
  const fundoMinimapa = new THREE.Color(0x1b1b22)

  const camera = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.1, 10000)
  camera.layers.enable(CAMADA_MARCADOR)
  camera.up.set(0, 0, -1)

  // Seta no plano XZ apontando para -Z (a rotação em Y a orienta).
  const geometria = new THREE.BufferGeometry()
  geometria.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -1, -0.6, 0, 0.8, 0.6, 0, 0.8], 3))
  geometria.setIndex([0, 1, 2])
  const material = new THREE.MeshBasicMaterial({ color: 0xff5252, side: THREE.DoubleSide, depthTest: false })
  const marcador = new THREE.Mesh(geometria, material)
  marcador.layers.set(CAMADA_MARCADOR)
  marcador.renderOrder = 999
  marcador.frustumCulled = false
  cena.add(marcador)

  const dir = new THREE.Vector3()
  const centro = new THREE.Vector3()
  const tamanho = new THREE.Vector3()

  function desenhar() {
    const c = caixa()
    if (c.isEmpty()) return
    c.getCenter(centro)
    c.getSize(tamanho)
    const lado = Math.max(tamanho.x, tamanho.z, 1) * 0.6
    camera.left = -lado
    camera.right = lado
    camera.top = lado
    camera.bottom = -lado
    camera.position.set(centro.x, c.max.y + 200, centro.z)
    camera.lookAt(centro.x, centro.y, centro.z)
    camera.updateProjectionMatrix()

    const principal = cameraPrincipal()
    principal.getWorldDirection(dir)
    marcador.position.set(principal.position.x, c.max.y + 100, principal.position.z)
    marcador.scale.setScalar(lado * 0.07)
    // Seta aponta para onde a câmera olha; vista de cima pura mantém a última direção.
    if (Math.hypot(dir.x, dir.z) > 1e-3) marcador.rotation.y = Math.atan2(-dir.x, -dir.z)

    const fundo = cena.background
    const alvoAnterior = renderer.getRenderTarget()
    const autoClear = renderer.autoClear
    cena.background = fundoMinimapa
    renderer.autoClear = true
    renderer.setRenderTarget(alvo)
    try {
      renderer.render(cena, camera)
      renderer.readRenderTargetPixels(alvo, 0, 0, TAMANHO, TAMANHO, pixels)
    } finally {
      renderer.setRenderTarget(alvoAnterior)
      renderer.autoClear = autoClear
      cena.background = fundo
    }
    // O WebGL devolve as linhas de baixo para cima: inverte ao copiar para o canvas 2D.
    const linha = TAMANHO * 4
    for (let y = 0; y < TAMANHO; y++) {
      imagem.data.set(pixels.subarray((TAMANHO - 1 - y) * linha, (TAMANHO - y) * linha), y * linha)
    }
    contexto?.putImageData(imagem, 0, 0)
  }

  return {
    desenhar,
    dispose() {
      cena.remove(marcador)
      geometria.dispose()
      material.dispose()
      alvo.dispose()
      canvas.remove()
    },
  }
}
