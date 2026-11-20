import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { EstadoConsulta, EstadoErro, EstadoVazio } from './Estado.tsx'

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

describe('estados', () => {
  it('o erro mostra a mensagem e o botão de tentar de novo', async () => {
    const usuario = userEvent.setup()
    const tentar = vi.fn()
    render(<EstadoErro mensagem="Sem resposta do servidor." onTentarDeNovo={tentar} />)
    const alerta = screen.getByRole('alert')
    expect(alerta).toHaveTextContent('Algo deu errado')
    expect(alerta).toHaveTextContent('Sem resposta do servidor.')
    await usuario.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(tentar).toHaveBeenCalledTimes(1)
  })

  it('o erro de uma consulta tenta de novo pelo refetch', async () => {
    const usuario = userEvent.setup()
    const refetch = vi.fn()
    render(
      <EstadoConsulta consulta={{ ...base, refetch, data: undefined, isError: true, error: new Error('falhou') }}>
        {() => null}
      </EstadoConsulta>,
    )
    await usuario.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('o vazio mostra título, texto e a ação opcional', () => {
    render(<EstadoVazio titulo="Nada aqui" texto="Ainda não há registros." acao={<button type="button">Registrar</button>} />)
    expect(screen.getByText('Nada aqui')).toBeInTheDocument()
    expect(screen.getByText('Ainda não há registros.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Registrar' })).toBeInTheDocument()
  })

  it('sem dados, mostra o topo da tela junto do estado; com dados, só os dados', () => {
    const { rerender } = render(
      <EstadoConsulta consulta={{ ...base, data: undefined, isPending: true }} topo={<h1>Obra</h1>}>
        {(d: string) => <p>dados {d}</p>}
      </EstadoConsulta>,
    )
    expect(screen.getByRole('heading', { name: 'Obra' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Carregando…')
    rerender(
      <EstadoConsulta consulta={{ ...base, data: 'ok' }} topo={<h1>Obra</h1>}>
        {(d: string) => <p>dados {d}</p>}
      </EstadoConsulta>,
    )
    expect(screen.queryByRole('heading', { name: 'Obra' })).not.toBeInTheDocument()
    expect(screen.getByText('dados ok')).toBeInTheDocument()
  })
})
