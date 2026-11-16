import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cameraNoApp } from '../telegram.ts'
import { CameraFotos } from './CameraFotos.tsx'
import { SeletorFotos } from './SeletorFotos.tsx'

const parar = vi.fn()
const getUserMedia = vi.fn()

function definirTelegram(platform: string | undefined, initData = 'x=1') {
  ;(window as unknown as { Telegram?: unknown }).Telegram =
    platform === undefined ? undefined : { WebApp: { initData, platform } }
}

beforeEach(() => {
  parar.mockClear()
  getUserMedia.mockReset()
  getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: parar }] })
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true })
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { value: 4000, configurable: true })
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { value: 3000, configurable: true })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as never)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) =>
    cb(new Blob(['x'], { type: 'image/jpeg' })),
  )
})

afterEach(() => {
  definirTelegram(undefined)
  vi.restoreAllMocks()
})

describe('cameraNoApp', () => {
  it.each([
    ['android', true],
    ['android_x', true],
    ['ios', false],
    ['tdesktop', false],
  ])('plataforma %s -> %s', (plataforma, esperado) => {
    definirTelegram(plataforma)
    expect(cameraNoApp()).toBe(esperado)
  })

  it('false fora do Telegram (initData vazio ou sem WebApp)', () => {
    definirTelegram('android', '')
    expect(cameraNoApp()).toBe(false)
    definirTelegram(undefined)
    expect(cameraNoApp()).toBe(false)
  })
})

describe('CameraFotos', () => {
  async function abrir(jaEscolhidas = 0) {
    const onFoto = vi.fn()
    const onFechar = vi.fn()
    const onUsarGaleria = vi.fn()
    const r = render(
      <CameraFotos jaEscolhidas={jaEscolhidas} onFoto={onFoto} onFechar={onFechar} onUsarGaleria={onUsarGaleria} />,
    )
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled())
    await act(async () => {})
    return { onFoto, onFechar, onUsarGaleria, ...r }
  }

  it('disparo chama onFoto com File JPEG e atualiza o contador', async () => {
    const { onFoto } = await abrir(2)
    expect(screen.getByText('2 de 10')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Tirar foto' }))
    await waitFor(() => expect(onFoto).toHaveBeenCalledTimes(1))
    const arquivo = onFoto.mock.calls[0][0] as File
    expect(arquivo).toBeInstanceOf(File)
    expect(arquivo.type).toBe('image/jpeg')
    expect(arquivo.name).toMatch(/^camera-\d+\.jpg$/)
    expect(await screen.findByText('3 de 10')).toBeInTheDocument()
  })

  it('no limite o disparo fica desabilitado', async () => {
    await abrir(10)
    expect(screen.getByRole('button', { name: 'Tirar foto' })).toBeDisabled()
  })

  it('erro mostra a mensagem, "Usar galeria" e "Fechar"', async () => {
    getUserMedia.mockRejectedValue(new DOMException('no', 'NotAllowedError'))
    const onUsarGaleria = vi.fn()
    const onFechar = vi.fn()
    render(<CameraFotos jaEscolhidas={0} onFoto={vi.fn()} onFechar={onFechar} onUsarGaleria={onUsarGaleria} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/acesso à câmera foi negado/)
    await userEvent.click(screen.getByRole('button', { name: 'Usar galeria' }))
    expect(onUsarGaleria).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    expect(onFechar).toHaveBeenCalled()
  })

  it('Concluir para as faixas e fecha; desmontar também para', async () => {
    const { onFechar, unmount } = await abrir()
    await userEvent.click(screen.getByRole('button', { name: 'Concluir' }))
    expect(onFechar).toHaveBeenCalled()
    expect(parar).toHaveBeenCalledTimes(1)
    unmount()

    parar.mockClear()
    const outra = await abrir()
    outra.unmount()
    expect(parar).toHaveBeenCalledTimes(1)
  })
})

describe('SeletorFotos com câmera no app', () => {
  const props = { itens: [], desabilitado: false, onAdicionar: vi.fn(), onRemover: vi.fn() }

  it('no Android abre a sobreposição e não clica o input', async () => {
    definirTelegram('android')
    const clique = vi.spyOn(HTMLInputElement.prototype, 'click')
    render(<SeletorFotos {...props} />)
    await userEvent.click(screen.getByRole('button', { name: 'Câmera' }))
    expect(await screen.findByRole('dialog', { name: 'Câmera' })).toBeInTheDocument()
    expect(clique).not.toHaveBeenCalled()
  })

  it('"Usar galeria" fecha a sobreposição e abre o input da galeria', async () => {
    definirTelegram('android')
    getUserMedia.mockRejectedValue(new Error('sem'))
    const clique = vi.spyOn(HTMLInputElement.prototype, 'click')
    render(<SeletorFotos {...props} />)
    await userEvent.click(screen.getByRole('button', { name: 'Câmera' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Usar galeria' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(clique).toHaveBeenCalledTimes(1)
  })

  it('fora do Android mantém o input nativo', async () => {
    definirTelegram('ios')
    const clique = vi.spyOn(HTMLInputElement.prototype, 'click')
    render(<SeletorFotos {...props} />)
    await userEvent.click(screen.getByRole('button', { name: 'Câmera' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(clique).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByLabelText('Tirar foto com a câmera'))
  })
})
