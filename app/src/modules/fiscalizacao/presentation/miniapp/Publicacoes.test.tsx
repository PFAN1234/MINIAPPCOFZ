import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { criarRepositorioFixture } from '../../../../dados/fixture.ts'
import { renderizarApp } from '@shared/test/renderApp.tsx'

afterEach(() => vi.restoreAllMocks())

describe('Publicações com problema', () => {
  it('equipe vê só a mensagem de restrição', async () => {
    const base = criarRepositorioFixture()
    renderizarApp('/obras/hto/publicacoes', {
      ...base,
      obterObra: async (slug) => ({ ...(await base.obterObra(slug)), papel: 'equipe' }),
    })
    expect(await screen.findByText('Só gestores da obra têm acesso à gestão.')).toBeInTheDocument()
    expect(screen.queryByText('Participantes')).not.toBeInTheDocument()
  })

  it('mostra título, nome da obra e as publicações com problema', async () => {
    renderizarApp('/obras/hto/publicacoes')
    expect(await screen.findByRole('heading', { name: 'Publicações com problema' })).toBeInTheDocument()
    expect(await screen.findByText('Incerta: pode ter sido publicada')).toBeInTheDocument()
    expect(screen.getByText('Falhou')).toBeInTheDocument()
    expect(screen.queryByText('Participantes')).not.toBeInTheDocument()
  })

  it('a rota antiga da Gestão redireciona para as publicações', async () => {
    renderizarApp('/obras/hto/gestao')
    expect(await screen.findByRole('heading', { name: 'Publicações com problema' })).toBeInTheDocument()
  })

  it('reenviar e marcar como publicada pedem confirmação e tiram o item da lista', async () => {
    const usuario = userEvent.setup()
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true)
    renderizarApp('/obras/hto/publicacoes')
    const falhou = (await screen.findByText('Guarda-corpo com fixação folgada.')).closest('li')!
    await usuario.click(within(falhou).getByRole('button', { name: 'Reenviar' }))
    expect(confirmar).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Guarda-corpo com fixação folgada.')).toBeInTheDocument()
    await usuario.click(within(falhou).getByRole('button', { name: 'Reenviar' }))
    await vi.waitFor(() =>
      expect(screen.queryByText('Guarda-corpo com fixação folgada.')).not.toBeInTheDocument(),
    )

    const incerta = screen.getByText('Instalação do forro de gesso finalizada.').closest('li')!
    await usuario.click(within(incerta).getByRole('button', { name: 'Marcar como publicada' }))
    expect(await screen.findByText('Nenhuma publicação com problema.')).toBeInTheDocument()
  })
})
