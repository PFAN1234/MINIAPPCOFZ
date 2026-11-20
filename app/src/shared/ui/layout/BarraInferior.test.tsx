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
  it('tem Início, Registros e Relatórios, e marca o da tela atual com aria-current="page"', () => {
    renderizar('/registros')
    expect(screen.getAllByRole('link')).toHaveLength(3)
    expect(screen.queryByRole('link', { name: /Pendências/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Registros' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Início' })).not.toHaveAttribute('aria-current')
  })

  it('tem a aba Relatórios ao lado de Registros, e ela marca a rota atual', () => {
    renderizar('/relatorios')
    const rotulos = screen.getAllByRole('link').map((l) => l.textContent)
    expect(rotulos.slice(0, 3)).toEqual(['Início', 'Registros', 'Relatórios'])
    expect(screen.getByRole('link', { name: 'Relatórios' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Relatórios' })).toHaveAttribute('href', '/relatorios')
  })

  it('o Início só fica ativo na raiz', () => {
    renderizar('/obras/hto')
    for (const link of screen.getAllByRole('link')) expect(link).not.toHaveAttribute('aria-current')
  })
})
