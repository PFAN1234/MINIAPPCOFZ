import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('App', () => {
  it('mostra o cabeçalho e o estado vazio de Obras', () => {
    render(<App />)
    expect(
      screen.getByRole('heading', { level: 1, name: 'Diário da obra' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: 'Obras' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Nenhuma obra por aqui ainda')).toBeInTheDocument()
  })
})
