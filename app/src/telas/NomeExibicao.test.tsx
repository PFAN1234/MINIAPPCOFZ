import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderizarApp } from '../test/renderApp.tsx'

// Na fixture, "Patricio Ferreira" (Telegram) tem o nome de exibição CP PATRICIO; os demais não têm.
describe('nome de exibição nas telas', () => {
  it('Registros: o autor aparece pelo nome de exibição e os demais pelo nome do Telegram', async () => {
    renderizarApp('/registros')
    const guarda = (await screen.findByText(/Guarda-corpo com fixação folgada/)).closest('li')!
    expect(guarda).toHaveTextContent('CP PATRICIO')
    expect(screen.queryByText(/Patricio Ferreira/)).not.toBeInTheDocument()
    const tomada = screen.getByText(/Tomada da sala/).closest('li')!
    expect(tomada).toHaveTextContent('Marcos Teixeira')
  })

  it('Histórico do ambiente: autor pelo nome de exibição', async () => {
    renderizarApp('/obras/hto/ambientes/1pav-circulacao')
    const item = (await screen.findByText(/Guarda-corpo com fixação folgada/)).closest('li')!
    expect(within(item).getByText(/CP PATRICIO/)).toBeInTheDocument()
  })

  it('Detalhe da pendência: autor pelo nome de exibição', async () => {
    renderizarApp('/obras/hto/pendencias/00000000-0000-4000-8000-000000000105')
    expect(await screen.findByText(/CP PATRICIO/)).toBeInTheDocument()
  })
})
