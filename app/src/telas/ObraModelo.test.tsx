import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { criarRepositorioFixture } from '../dados/fixture.ts'
import { renderizarApp } from '../test/renderApp.tsx'

describe('Obra: cartão do modelo e atalhos', () => {
  it('mostra "← Obras", o cartão do modelo federado e os atalhos (gestor)', async () => {
    renderizarApp('/obras/hto')
    expect(await screen.findByRole('link', { name: '← Obras' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: /Visualizar modelo federado/ })).toHaveAttribute(
      'href',
      '/obras/hto/modelo',
    )
    expect(await screen.findByRole('link', { name: 'Pendências 3' })).toHaveAttribute(
      'href',
      '/obras/hto/pendencias',
    )
    expect(await screen.findByRole('link', { name: 'Gestão 3' })).toHaveAttribute('href', '/obras/hto/gestao')
    expect(screen.getByRole('heading', { level: 3, name: 'Ambientes' })).toBeInTheDocument()
  })

  it('equipe não vê o atalho da Gestão', async () => {
    const base = criarRepositorioFixture()
    renderizarApp('/obras/hto', {
      ...base,
      obterObra: async (slug) => ({ ...(await base.obterObra(slug)), papel: 'equipe' }),
    })
    await screen.findByRole('link', { name: 'Pendências 3' })
    expect(screen.queryByRole('link', { name: /Gestão/ })).not.toBeInTheDocument()
  })

  it('o cartão leva ao marcador de lugar do modelo federado', async () => {
    const usuario = userEvent.setup()
    renderizarApp('/obras/hto')
    await usuario.click(await screen.findByRole('link', { name: /Visualizar modelo federado/ }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Modelo federado' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '← HTO' })).toHaveAttribute('href', '/obras/hto')
    expect(
      screen.getByText('O visualizador 3D do modelo federado está em preparação e chega numa próxima versão.'),
    ).toBeInTheDocument()
    const chips = within(screen.getByRole('list', { name: 'Modelos previstos' })).getAllByRole('button')
    expect(chips.map((c) => c.textContent)).toEqual(['ARQ', 'ELT', 'HID', 'ESG', 'DRE', 'PCI', 'VES', 'TLD', 'ANT'])
    for (const chip of chips) expect(chip).toBeDisabled()
  })
})
