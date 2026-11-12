import { render } from '@testing-library/react'
import type { ComponentType } from 'react'
import { describe, expect, it } from 'vitest'
import * as Icones from './Icones.tsx'

const todos = Object.entries(Icones) as [string, ComponentType<{ tamanho?: number }>][]

describe('Icones', () => {
  it('tem os ícones do novo visual', () => {
    const nomes = todos.map(([nome]) => nome)
    for (const nome of [
      'IconeCasa',
      'IconeLista',
      'IconeAlerta',
      'IconeCamera',
      'IconeGaleria',
      'IconeMais',
      'IconeLupa',
      'IconePlanta',
      'IconeCubo',
      'IconeCelular',
      'IconeSemSinal',
      'IconeCheck',
      'IconeFechar',
      'IconeVoltar',
      'IconePessoas',
    ]) {
      expect(nomes).toContain(nome)
    }
  })

  it.each(todos)('%s: traço em currentColor, viewBox 24 e escondido do leitor de tela', (_nome, Icone) => {
    const { container } = render(<Icone tamanho={20} />)
    const svg = container.querySelector('svg')!
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24')
    expect(svg).toHaveAttribute('fill', 'none')
    expect(svg).toHaveAttribute('stroke', 'currentColor')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('width', '20')
    expect(svg.children.length).toBeGreaterThan(0)
    // Nenhuma forma com preenchimento próprio: tudo é traço.
    expect(svg.querySelector('[fill]:not([fill="none"])')).toBeNull()
  })
})
