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

    await usuario.click(screen.getByRole('radio', { name: 'Abertas' }))
    expect(await screen.findAllByRole('listitem')).toHaveLength(3)
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

describe('Registros: filtros de etapa, pessoa e período', () => {
  it('o segmentado Abertas/Resolvidas filtra por situação', async () => {
    const usuario = userEvent.setup()
    renderizarApp('/registros')
    await screen.findByText(/Tomada da sala/)
    await usuario.click(screen.getByRole('radio', { name: 'Abertas' }))
    expect(await screen.findAllByRole('listitem')).toHaveLength(3)
    await usuario.click(screen.getByRole('radio', { name: 'Resolvidas' }))
    expect(await screen.findAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText(/Rejunte irregular/)).toBeInTheDocument()
  })

  it('etapa limita as obras do select e limpa a obra de outra etapa', async () => {
    const usuario = userEvent.setup()
    renderizarApp('/registros?obra=hto')
    const etapa = await screen.findByRole('combobox', { name: 'Filtrar por etapa' })
    const outra = (await criarRepositorioFixture().listarObras()).find((o) => o.slug === 'alojamentos')!
    await waitFor(() => expect(within(etapa).getAllByRole('option').length).toBeGreaterThan(2))
    expect(within(etapa).getByRole('option', { name: 'Todas as etapas' })).toBeInTheDocument()
    await usuario.selectOptions(etapa, outra.etapa.id)
    const obra = screen.getByRole('combobox', { name: 'Filtrar por obra' })
    await waitFor(() => expect(obra).toHaveValue(''))
    expect(within(obra).queryByRole('option', { name: 'HTO' })).not.toBeInTheDocument()
    expect(within(obra).getByRole('option', { name: 'Bloco de Alojamentos' })).toBeInTheDocument()
    expect(await screen.findByText('Nenhum registro ainda')).toBeInTheDocument()
  })

  it('pessoa, período e Limpar filtros', async () => {
    const usuario = userEvent.setup()
    renderizarApp('/registros')
    await screen.findByText(/Tomada da sala/)
    const pessoa = screen.getByRole('combobox', { name: 'Filtrar por pessoa' })
    await waitFor(() => expect(within(pessoa).getAllByRole('option').length).toBeGreaterThan(1))
    const antes = screen.getAllByRole('listitem').length
    expect(screen.queryByRole('button', { name: 'Limpar filtros' })).not.toBeInTheDocument()
    await usuario.selectOptions(pessoa, within(pessoa).getAllByRole('option')[1])
    await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeLessThan(antes))

    await usuario.click(screen.getByRole('button', { name: 'Limpar filtros' }))
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(antes))
    expect(screen.queryByRole('button', { name: 'Limpar filtros' })).not.toBeInTheDocument()

    await usuario.type(screen.getByLabelText('De'), '2026-11-04')
    await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeLessThan(antes))
    await usuario.type(screen.getByLabelText('Até'), '2026-11-05')
    await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0))
    expect(screen.queryByText(/Rejunte irregular/)).not.toBeInTheDocument()
  })

  it('repassa os filtros da URL ao repositório', async () => {
    const base = criarRepositorioFixture()
    const listar = vi.fn(base.listarRegistros)
    renderizarApp('/registros?etapa=e1&pessoa=u1&de=2026-11-01&ate=2026-11-30&tipo=resolvidas', {
      ...base,
      listarRegistros: listar,
    })
    await waitFor(() => expect(listar).toHaveBeenCalled())
    expect(listar).toHaveBeenCalledWith({
      obraSlug: undefined,
      tipo: 'pendencia',
      situacao: 'resolvida',
      etapaId: 'e1',
      autorId: 'u1',
      de: '2026-11-01',
      ate: '2026-11-30',
      limite: 50,
    })
  })
})
