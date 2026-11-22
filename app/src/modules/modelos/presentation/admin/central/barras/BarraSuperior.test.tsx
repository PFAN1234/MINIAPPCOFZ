import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import BarraSuperior from './BarraSuperior.tsx'
import type { TipoMedida } from '../../../../domain/central.ts'

function montar(medicao: TipoMedida | null = null) {
  const noop = vi.fn()
  render(
    <div>
      <p>fora</p>
      <BarraSuperior
        ativo
        ortografica={false}
        cor="nenhum"
        grade
        onEnquadrar={noop}
        onProjecao={noop}
        onCor={noop}
        onGrade={noop}
        pavimentos={['TÉRREO']}
        vista={{ tipo: '3d' }}
        onVista3d={noop}
        onPlanta={noop}
        onElevacao={noop}
        onCortar={noop}
        cortes={0}
        minimapa={false}
        onMinimapa={noop}
        medicao={medicao}
        onMedir={noop}
        marcadores
        onMarcadores={noop}
        onCaptura={noop}
      />
    </div>,
  )
}

describe('BarraSuperior: menus', () => {
  it('fecha o menu Cor com Esc e com clique fora', async () => {
    const u = userEvent.setup()
    montar()
    await u.click(screen.getByRole('button', { name: 'Cor' }))
    expect(screen.getByRole('menu', { name: 'Colorir por' })).toBeInTheDocument()
    await u.keyboard('{Escape}')
    expect(screen.queryByRole('menu', { name: 'Colorir por' })).toBeNull()
    await u.click(screen.getByRole('button', { name: 'Cor' }))
    await u.click(screen.getByText('fora'))
    expect(screen.queryByRole('menu', { name: 'Colorir por' })).toBeNull()
  })

  it('mantém o submenu Medir aberto enquanto há um modo de medição ativo', async () => {
    const u = userEvent.setup()
    montar('distancia')
    await u.click(screen.getByRole('button', { name: 'Medir' }))
    await u.click(screen.getByText('fora'))
    expect(screen.getByRole('button', { name: 'Distância' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('fecha o submenu Medir com clique fora quando nenhum modo está ativo', async () => {
    const u = userEvent.setup()
    montar()
    await u.click(screen.getByRole('button', { name: 'Medir' }))
    expect(screen.getByRole('button', { name: 'Área' })).toBeInTheDocument()
    await u.click(screen.getByText('fora'))
    expect(screen.queryByRole('button', { name: 'Área' })).toBeNull()
  })
})
