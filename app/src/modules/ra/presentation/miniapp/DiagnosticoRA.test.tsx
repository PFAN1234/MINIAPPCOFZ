import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  abrirCamera: vi.fn(),
  fecharCamera: vi.fn(),
  criarLeitorQr: vi.fn().mockResolvedValue({ ler: vi.fn().mockResolvedValue(null) }),
}))

vi.mock('@modules/ra/infra/browser/camera.ts', async (orig) => ({
  ...(await orig<typeof import('@modules/ra/infra/browser/camera.ts')>()),
  abrirCamera: mocks.abrirCamera,
  fecharCamera: mocks.fecharCamera,
}))

vi.mock('@modules/ra/infra/browser/leitorQr.ts', () => ({
  criarLeitorQr: mocks.criarLeitorQr,
}))

import DiagnosticoRA from './DiagnosticoRA.tsx'

describe('DiagnosticoRA', () => {
  afterEach(() => {
    vi.clearAllMocks()
    delete (globalThis.DeviceOrientationEvent as unknown as { requestPermission?: unknown }).requestPermission
  })

  it('pede permissão do sensor no iOS e fecha a câmera se desmontar antes de abrirCamera resolver', async () => {
    const requestPermission = vi.fn().mockResolvedValue('granted')
    ;(globalThis.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission =
      requestPermission

    let resolverCamera!: (s: MediaStream) => void
    mocks.abrirCamera.mockReturnValue(new Promise<MediaStream>((r) => (resolverCamera = r)))

    const { unmount } = render(
      <MemoryRouter>
        <DiagnosticoRA />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Iniciar teste' }))
    expect(requestPermission).toHaveBeenCalledTimes(1)

    unmount()
    const stream = { getTracks: () => [] } as unknown as MediaStream
    resolverCamera(stream)
    await waitFor(() => expect(mocks.fecharCamera).toHaveBeenCalledWith(stream))
  })
})
