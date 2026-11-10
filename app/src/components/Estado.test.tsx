import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EstadoConsulta } from './Estado.tsx'

const base = { isPending: false, isError: false, error: null, refetch: vi.fn() }

describe('EstadoConsulta', () => {
  it('sem dados e pausada mostra "Sem conexão" com "Tentar de novo"', () => {
    render(
      <EstadoConsulta
        consulta={{ ...base, data: undefined, isPending: true, fetchStatus: 'paused' }}
      >
        {() => <p>dados</p>}
      </EstadoConsulta>,
    )
    expect(
      screen.getByText('Sem conexão. Esta tela aparece quando o sinal voltar.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument()
  })

  it('com dados mostra os dados mesmo com erro', () => {
    render(
      <EstadoConsulta
        consulta={{ ...base, data: 'ok', isError: true, error: new Error('x'), fetchStatus: 'idle' }}
      >
        {(d) => <p>dados {d}</p>}
      </EstadoConsulta>,
    )
    expect(screen.getByText('dados ok')).toBeInTheDocument()
  })

  it('sem dados e com erro mostra o erro', () => {
    render(
      <EstadoConsulta consulta={{ ...base, data: undefined, isError: true, error: new Error('falhou') }}>
        {() => null}
      </EstadoConsulta>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('falhou')
  })
})
