import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { BarraInferior } from './BarraInferior.tsx'

function renderizar(rota: string) {
  return render(
    <MemoryRouter initialEntries={[rota]}>
      <BarraInferior />
    </MemoryRouter>,
  )
}

describe('BarraInferior', () => {
  it('só tem Início e Registros, e marca o da tela atual com aria-current="page"', () => {
    renderizar('/registros')
    expect(screen.getAllByRole('link')).toHaveLength(2)
    expect(screen.queryByRole('link', { name: /Pendências/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Registros' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Início' })).not.toHaveAttribute('aria-current')
  })

  it('o Início só fica ativo na raiz', () => {
    renderizar('/obras/hto')
    for (const link of screen.getAllByRole('link')) expect(link).not.toHaveAttribute('aria-current')
  })
})
