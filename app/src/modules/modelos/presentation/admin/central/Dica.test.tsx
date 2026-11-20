import { act, fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Dicas from './Dica.tsx'

function Tela() {
  const raiz = useRef<HTMLDivElement>(null)
  return (
    <div ref={raiz}>
      <Dicas raiz={raiz} />
      <button type="button" aria-label="Ocultar" data-dica="Ocultar a seleção (H)" data-dica-lado="cima" />
      <button type="button" aria-label="Isolar" data-dica="Isolar a seleção (I)" />
      <p>fora</p>
    </div>
  )
}

describe('Dicas', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('mostra o nome só depois do atraso ao passar o mouse e some ao sair', () => {
    render(<Tela />)
    fireEvent.pointerOver(screen.getByRole('button', { name: 'Ocultar' }))
    expect(screen.queryByText('Ocultar a seleção (H)')).toBeNull()
    act(() => vi.advanceTimersByTime(400))
    const dica = screen.getByText('Ocultar a seleção (H)')
    expect(dica).toHaveAttribute('aria-hidden', 'true')
    expect(dica).toHaveAttribute('data-lado', 'cima')
    // Com a dica aberta, passar a outro botão troca na hora.
    fireEvent.pointerOver(screen.getByRole('button', { name: 'Isolar' }))
    expect(screen.getByText('Isolar a seleção (I)')).toBeInTheDocument()
    fireEvent.pointerOut(screen.getByRole('button', { name: 'Isolar' }), { relatedTarget: document.body })
    expect(screen.queryByText('Isolar a seleção (I)')).toBeNull()
  })

  it('fecha ao clicar e com Esc', () => {
    render(<Tela />)
    const botao = screen.getByRole('button', { name: 'Isolar' })
    fireEvent.pointerOver(botao)
    act(() => vi.advanceTimersByTime(400))
    fireEvent.pointerDown(botao)
    expect(screen.queryByText('Isolar a seleção (I)')).toBeNull()
    fireEvent.pointerOver(screen.getByText('fora'))
    fireEvent.pointerOver(botao)
    act(() => vi.advanceTimersByTime(400))
    fireEvent.keyDown(botao, { key: 'Escape' })
    expect(screen.queryByText('Isolar a seleção (I)')).toBeNull()
  })
})
