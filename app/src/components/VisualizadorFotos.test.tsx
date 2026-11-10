import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { VisualizadorFotos } from './VisualizadorFotos.tsx'

const fotos = [1, 2, 3].map((n) => ({
  id: `f${n}`,
  url: `blob:foto-${n}`,
  largura: 100,
  altura: 80,
}))

function abrir(indiceInicial = 1) {
  const onFechar = vi.fn()
  render(<VisualizadorFotos fotos={fotos} indiceInicial={indiceInicial} rotulo="Fotos" onFechar={onFechar} />)
  return onFechar
}

describe('VisualizadorFotos', () => {
  it('abre na foto indicada, navega pelos botões e respeita os limites', async () => {
    const usuario = userEvent.setup()
    abrir(1)
    expect(screen.getByRole('dialog', { name: 'Fotos' })).toBeInTheDocument()
    expect(screen.getByText('Foto 2 de 3')).toBeInTheDocument()
    expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:foto-2')
    await usuario.click(screen.getByRole('button', { name: 'Próxima foto' }))
    expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:foto-3')
    expect(screen.getByRole('button', { name: 'Próxima foto' })).toBeDisabled()
    await usuario.click(screen.getByRole('button', { name: 'Foto anterior' }))
    await usuario.click(screen.getByRole('button', { name: 'Foto anterior' }))
    expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:foto-1')
    expect(screen.getByRole('button', { name: 'Foto anterior' })).toBeDisabled()
  })

  it('fecha pelo botão e pela tecla Esc', async () => {
    const usuario = userEvent.setup()
    const onFechar = abrir()
    await usuario.click(screen.getByRole('button', { name: 'Fechar' }))
    expect(onFechar).toHaveBeenCalledTimes(1)
    await usuario.keyboard('{Escape}')
    expect(onFechar).toHaveBeenCalledTimes(2)
  })

  it('desliza para mudar de foto', () => {
    abrir(1)
    const palco = screen.getByRole('img').parentElement!
    fireEvent.touchStart(palco, { touches: [{ clientX: 300 }] })
    fireEvent.touchEnd(palco, { changedTouches: [{ clientX: 100 }] })
    expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:foto-3')
    fireEvent.touchStart(palco, { touches: [{ clientX: 100 }] })
    fireEvent.touchEnd(palco, { changedTouches: [{ clientX: 300 }] })
    expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:foto-2')
  })
})
