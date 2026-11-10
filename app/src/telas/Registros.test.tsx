import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { criarRepositorioFixture } from '../dados/fixture.ts'
import type { Repositorio } from '../dados/repositorio.ts'
import type { RegistroResumo } from '../dados/tipos.ts'
import { renderizarApp } from '../test/renderApp.tsx'

describe('Registros', () => {
  it('filtros de obra e tipo (segmentado) e itens de pendência levam ao detalhe', async () => {
    const usuario = userEvent.setup()
    renderizarApp('/registros')
    expect(await screen.findByText(/Tomada da sala/)).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(6)
    expect(screen.getByRole('radio', { name: 'Todos' })).toBeChecked()

    await usuario.click(screen.getByRole('radio', { name: 'Serviços' }))
    expect(await screen.findAllByRole('listitem')).toHaveLength(2)
    expect(screen.queryByText(/Tomada da sala/)).not.toBeInTheDocument()

    await usuario.click(screen.getByRole('radio', { name: 'Pendências' }))
    expect(await screen.findAllByRole('listitem')).toHaveLength(4)
    const tomada = screen.getByText(/Tomada da sala/).closest('li')!
    expect(within(tomada).getByRole('link')).toHaveAttribute(
      'href',
      '/obras/hto/pendencias/00000000-0000-4000-8000-000000000101',
    )

    await usuario.selectOptions(screen.getByRole('combobox', { name: 'Filtrar por obra' }), 'aurora')
    expect(await screen.findByText('Nenhum registro ainda')).toBeInTheDocument()
  })

  it('lê os filtros da URL', async () => {
    renderizarApp('/registros?obra=hto&tipo=servico')
    expect(await screen.findByRole('radio', { name: 'Serviços' })).toBeChecked()
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Filtrar por obra' })).toHaveValue('hto'))
    expect(await screen.findAllByRole('listitem')).toHaveLength(2)
  })

  it('limite de 50 e "Carregar mais" (+50)', async () => {
    const usuario = userEvent.setup()
    const base = criarRepositorioFixture()
    const modelo = (await base.listarRegistros({}))[0]
    const todos: RegistroResumo[] = Array.from({ length: 120 }, (_, i) => ({
      ...modelo,
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      tipo: 'servico',
      situacao: null,
      legenda: `Registro ${i}`,
    }))
    const listar = vi.fn(async (filtro: { limite?: number }) => todos.slice(0, filtro.limite))
    const repo: Repositorio = { ...base, listarRegistros: listar }
    renderizarApp('/registros', repo)
    expect(await screen.findAllByRole('listitem')).toHaveLength(50)
    await usuario.click(screen.getByRole('button', { name: 'Carregar mais' }))
    expect(await screen.findAllByRole('listitem')).toHaveLength(100)
    expect(listar).toHaveBeenLastCalledWith(expect.objectContaining({ limite: 100 }))
    await usuario.click(screen.getByRole('button', { name: 'Carregar mais' }))
    expect(await screen.findAllByRole('listitem')).toHaveLength(120)
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).not.toBeInTheDocument()
  })
})
