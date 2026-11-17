import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  abrirCamera: vi.fn(),
  fecharCamera: vi.fn(),
  iniciarOrientacao: vi.fn(),
  motorInstancias: [] as { descartar: ReturnType<typeof vi.fn> }[],
}))

vi.mock('./camera.ts', async (orig) => ({
  ...(await orig<typeof import('./camera.ts')>()),
  abrirCamera: mocks.abrirCamera,
  fecharCamera: mocks.fecharCamera,
}))

vi.mock('./orientacao.ts', async (orig) => ({
  ...(await orig<typeof import('./orientacao.ts')>()),
  iniciarOrientacao: mocks.iniciarOrientacao,
}))

vi.mock('./motor.ts', () => ({
  MotorRA: class {
    descartar = vi.fn()
    carregar = vi.fn().mockResolvedValue(undefined)
    definirVisiveis = vi.fn()
    definirMalha = vi.fn()
    redimensionar = vi.fn()
    posicionar = vi.fn()
    posicionarProcura = vi.fn()
    renderizar = vi.fn()
    constructor() {
      mocks.motorInstancias.push(this)
    }
  },
}))

import { Quaternion } from 'three'
import { quaternionDoAparelho } from './orientacao.ts'
import TelaRA from './TelaRA.tsx'
import type { GeometriaAmbiente } from './geometria.ts'

function geometriaBase(qr: GeometriaAmbiente['qr'] = null): GeometriaAmbiente {
  return {
    contorno: [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ],
    yPiso: 0,
    yTeto: 2.6,
    qr,
    referencial: null,
    matrizes: {},
  }
}

function propsBase(geometria = geometriaBase()) {
  return {
    obra: { slug: 'hto', nome: 'HTO' },
    pavimento: 'Térreo',
    ambiente: { codigo: 'terreo-apto-101', nome: 'Apto. 101' },
    geometria,
    modelos: [{ sigla: 'ELT', revisao: 'R03', arquivo: 'ELT.frag', bytes: 10, hash: 'abc' }],
    baixar: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    vagas: 10,
    onConcluir: vi.fn(),
    onFechar: vi.fn(),
  }
}

describe('TelaRA', () => {
  beforeAll(() => {
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver
  })

  afterEach(() => {
    vi.clearAllMocks()
    mocks.motorInstancias.length = 0
  })

  it('limpa câmera e orientação se desmontar enquanto abrirCamera ainda está pendente', async () => {
    const parar = vi.fn()
    mocks.iniciarOrientacao.mockResolvedValue({
      atual: () => new Quaternion(),
      fonte: () => 'navegador',
      leituras: () => 1,
      parar,
    })
    let resolverCamera!: (s: MediaStream) => void
    mocks.abrirCamera.mockReturnValue(new Promise<MediaStream>((r) => (resolverCamera = r)))

    const { unmount } = render(
      <MemoryRouter>
        <TelaRA {...propsBase()} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Abrir câmera' }))
    unmount()

    const stream = { getTracks: () => [] } as unknown as MediaStream
    resolverCamera(stream)
    await waitFor(() => {
      expect(mocks.fecharCamera).toHaveBeenCalledWith(stream)
      expect(parar).toHaveBeenCalledTimes(1)
    })
  })

  it('para a orientação se abrirCamera falhar e usa Link SPA para /ra-teste', async () => {
    const parar = vi.fn()
    mocks.iniciarOrientacao.mockResolvedValue({
      atual: () => new Quaternion(),
      fonte: () => 'navegador',
      leituras: () => 1,
      parar,
    })
    mocks.abrirCamera.mockRejectedValue(new Error('Permissão negada'))

    render(
      <MemoryRouter>
        <TelaRA {...propsBase()} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Abrir câmera' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Permissão negada')
    expect(parar).toHaveBeenCalledTimes(1)
    const link = screen.getByRole('link', { name: 'Testar este aparelho' })
    expect(link).toHaveAttribute('href', '/ra-teste')
    // React Router <Link> não faz navegação de documento completa quando clicado com prevenção padrão,
    // mas aqui verificamos que está dentro do mesmo MemoryRouter (onClick interceptado).
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
  })

  it('não exibe botão de QR quando parede do QR está fora do contorno', async () => {
    const parar = vi.fn()
    mocks.iniciarOrientacao.mockResolvedValue({
      atual: () => new Quaternion(),
      fonte: () => 'navegador',
      leituras: () => 1,
      parar,
    })
    mocks.abrirCamera.mockResolvedValue({ getTracks: () => [] } as unknown as MediaStream)

    render(
      <MemoryRouter>
        <TelaRA {...propsBase(geometriaBase({ parede: 99, distancia_m: 1, altura_m: 1.5, lado_m: 0.18 }))} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Abrir câmera' }))
    expect(await screen.findByRole('button', { name: 'Marcar canto' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Usar o QR do ambiente' })).not.toBeInTheDocument()
  })

  it('limpa erroCm obsoleto quando o usuário ajusta a pose por arraste', async () => {
    const orientacoes = [
      quaternionDoAparelho(0, Math.PI / 3, 0, 0),
      quaternionDoAparelho(Math.PI / 2, Math.PI / 3, 0, 0),
      quaternionDoAparelho(Math.PI, Math.PI / 3, 0, 0),
    ]
    let passo = 0
    mocks.iniciarOrientacao.mockResolvedValue({
      atual: () => orientacoes[Math.min(passo, orientacoes.length - 1)].clone(),
      fonte: () => 'navegador',
      leituras: () => 2,
      parar: vi.fn(),
    })
    mocks.abrirCamera.mockResolvedValue({ getTracks: () => [] } as unknown as MediaStream)

    render(
      <MemoryRouter>
        <TelaRA {...propsBase()} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Abrir câmera' }))
    await screen.findByRole('button', { name: 'Marcar canto' })

    // Marca 1º e 2º cantos com orientações distintas
    fireEvent.click(screen.getByRole('button', { name: 'Marcar canto' }))
    fireEvent.click(screen.getByRole('button', { name: 'Canto 1' }))
    passo = 1
    fireEvent.click(screen.getByRole('button', { name: 'Marcar canto' }))
    fireEvent.click(screen.getByRole('button', { name: 'Canto 2' }))

    // Confere 3º canto
    passo = 2
    fireEvent.click(await screen.findByRole('button', { name: 'Conferir canto' }))
    fireEvent.click(screen.getByRole('button', { name: 'Conferir este canto' }))
    fireEvent.click(screen.getByRole('button', { name: 'Canto 3' }))
    expect(await screen.findByText(/Erro no canto conferido:/)).toBeInTheDocument()

    // Arrasta na tela para ajustar o modelo: o erro antigo deve sumir
    const toque = screen.getByTestId('ra-toque')
    fireEvent.pointerDown(toque, { pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(toque, { pointerId: 1, clientX: 130, clientY: 100 })
    fireEvent.pointerUp(toque, { pointerId: 1, clientX: 130, clientY: 100 })

    expect(screen.queryByText(/Erro no canto conferido:/)).not.toBeInTheDocument()
  })
})
