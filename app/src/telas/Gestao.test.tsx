import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { criarRepositorioFixture } from '../dados/fixture.ts'
import { renderizarApp } from '../test/renderApp.tsx'

afterEach(() => vi.restoreAllMocks())

describe('Gestão', () => {
  it('equipe vê só a mensagem de restrição', async () => {
    const base = criarRepositorioFixture()
    renderizarApp('/obras/hto/gestao', {
      ...base,
      obterObra: async (slug) => ({ ...(await base.obterObra(slug)), papel: 'equipe' }),
    })
    expect(await screen.findByText('Só gestores da obra têm acesso à gestão.')).toBeInTheDocument()
    expect(screen.queryByText('Participantes')).not.toBeInTheDocument()
  })

  it('mostra pedidos, participantes (gestores primeiro) e publicações com problema', async () => {
    renderizarApp('/obras/hto/gestao')
    expect(await screen.findByRole('heading', { level: 3, name: 'Pedidos de acesso' })).toBeInTheDocument()
    expect(await screen.findByText('Maria Souza')).toBeInTheDocument()
    const participantes = (await screen.findAllByRole('combobox', { name: /^Papel de / })).map(
      (c) => c.getAttribute('aria-label'),
    )
    expect(participantes).toEqual(['Papel de Você (teste)', 'Papel de João Lima', 'Papel de Marcos Teixeira'])
    expect(screen.getByText('@marcos')).toBeInTheDocument()
    expect(await screen.findByText('Incerta: pode ter sido publicada')).toBeInTheDocument()
    expect(screen.getByText('Falhou')).toBeInTheDocument()
  })

  it('muda o papel e mostra o erro inline ao rebaixar o último gestor', async () => {
    const usuario = userEvent.setup()
    renderizarApp('/obras/hto/gestao')
    const marcos = await screen.findByRole('combobox', { name: 'Papel de Marcos Teixeira' })
    expect(marcos).toHaveValue('equipe')
    await usuario.selectOptions(marcos, 'gestor')
    expect(await screen.findByRole('combobox', { name: 'Papel de Marcos Teixeira' })).toHaveValue('gestor')

    // Agora há dois gestores: dá para rebaixar um (Marcos) e o outro vira o último.
    await usuario.selectOptions(screen.getByRole('combobox', { name: 'Papel de Marcos Teixeira' }), 'equipe')
    await screen.findByRole('combobox', { name: 'Papel de Marcos Teixeira' })
    await usuario.selectOptions(screen.getByRole('combobox', { name: 'Papel de Você (teste)' }), 'equipe')
    expect(await screen.findByRole('alert')).toHaveTextContent('A obra precisa de pelo menos um gestor.')
    expect(screen.getByRole('combobox', { name: 'Papel de Você (teste)' })).toHaveValue('gestor')
  })

  it('remover pede confirmação e tira o participante', async () => {
    const usuario = userEvent.setup()
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    renderizarApp('/obras/hto/gestao')
    await usuario.click(await screen.findByRole('button', { name: 'Remover João Lima' }))
    expect(confirmar).toHaveBeenCalledTimes(1)
    expect(screen.getByText('João Lima')).toBeInTheDocument()
    await usuario.click(screen.getByRole('button', { name: 'Remover João Lima' }))
    await vi.waitFor(() => expect(screen.queryByText('João Lima')).not.toBeInTheDocument())
  })

  it('reenviar e marcar como publicada pedem confirmação e tiram o item da lista', async () => {
    const usuario = userEvent.setup()
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true)
    renderizarApp('/obras/hto/gestao')
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
