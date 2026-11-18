import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as erros from '../util/erros.ts'
import ErrorBoundary from './ErrorBoundary.tsx'

function Quebrado(): never {
  throw new Error('render quebrou')
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => vi.restoreAllMocks())

describe('ErrorBoundary', () => {
  it('mostra os filhos quando não há erro', () => {
    render(
      <ErrorBoundary>
        <p>tudo certo</p>
      </ErrorBoundary>,
    )
    expect(screen.getByText('tudo certo')).toBeInTheDocument()
  })

  it('mostra "Algo deu errado", registra o erro com o componentStack e recarrega', async () => {
    const registrar = vi.spyOn(erros, 'registrarErro').mockResolvedValue()
    const recarregar = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload: recarregar })
    render(
      <ErrorBoundary>
        <Quebrado />
      </ErrorBoundary>,
    )
    expect(screen.getByText('Algo deu errado')).toBeInTheDocument()
    expect(registrar).toHaveBeenCalledTimes(1)
    const [erro, extra] = registrar.mock.calls[0]
    expect((erro as Error).message).toBe('render quebrou')
    expect(extra).toHaveProperty('componentStack')
    await userEvent.click(screen.getByRole('button', { name: 'Recarregar' }))
    expect(recarregar).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
