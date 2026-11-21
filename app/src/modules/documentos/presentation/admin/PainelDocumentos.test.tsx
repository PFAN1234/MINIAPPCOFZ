import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RepositorioAdminProvider } from '../../../../admin/dados/contexto.tsx'
import { criarRepositorioAdminFixture } from '../../../../admin/dados/fixture.ts'
import type { RepositorioAdmin } from '../../../../admin/dados/repositorio.ts'
import { OBRAS } from '../../../modelos/presentation/admin/central/obrasDeTeste.ts'
import PainelDocumentos from './PainelDocumentos.tsx'

const REF_A = { sigla: 'ARQ', globalId: 'g-parede-1', classe: 'IFCWALL', nome: 'Parede 1' }
const REF_P = { sigla: 'ARQ', globalId: 'g-pav-1', classe: 'IFCBUILDINGSTOREY', nome: 'Térreo' }

async function renderizar(selecao: (typeof REF_A)[] = [], preparar?: (repo: RepositorioAdmin) => Promise<void>) {
  const repo = criarRepositorioAdminFixture()
  await preparar?.(repo)
  const obra = { ...OBRAS[0], obra_id: (await repo.obterObra('hto')).obra.id }
  const aoAbrir = vi.fn()
  const onMostrar = vi.fn()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <RepositorioAdminProvider repositorio={repo}>
        <PainelDocumentos obra={obra} siglas={['ARQ', 'EST']}
          aoAbrir={aoAbrir}
          selecao={selecao}
          pavimentos={[REF_P]}
          onMostrar={onMostrar}
        />
      </RepositorioAdminProvider>
    </QueryClientProvider>,
  )
  return { repo, aoAbrir, onMostrar }
}

const pdf = (nome: string) => new File(['%PDF-1.4 teste'], nome, { type: 'application/pdf' })
const item = (titulo: string) => screen.getByText(titulo).closest('li') as HTMLElement

describe('PainelDocumentos (fixture)', () => {
  it('agrupa por disciplina e filtra por tipo e por texto', async () => {
    const user = userEvent.setup()
    await renderizar()
    const grupo = await screen.findByRole('region', { name: 'ARQ' })
    expect(within(grupo).getByRole('heading')).toHaveTextContent('ARQ (2)')
    expect(within(grupo).getAllByRole('listitem')).toHaveLength(2)

    await user.selectOptions(screen.getByLabelText('Tipo'), 'desenho')
    expect(screen.queryByText('Planta baixa do pavimento tipo')).not.toBeInTheDocument()
    expect(screen.getByText('Implantação (DWG)')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Tipo'), '')
    await user.type(screen.getByLabelText('Buscar'), 'ar-pr-001')
    expect(screen.queryByText('Implantação (DWG)')).not.toBeInTheDocument()
    await user.clear(screen.getByLabelText('Buscar'))
    await user.type(screen.getByLabelText('Buscar'), 'nada disso')
    expect(screen.getByText(/Nenhum documento encontrado/)).toBeInTheDocument()
  })

  it('envia um PDF novo: preenche título, tipo e disciplina pelo nome, e o grupo aparece', async () => {
    const user = userEvent.setup()
    await renderizar()
    await screen.findByRole('region', { name: 'ARQ' })
    await user.click(screen.getByRole('button', { name: 'Enviar documento' }))
    const enviar = screen.getByRole('button', { name: 'Enviar' })
    expect(enviar).toBeDisabled()
    await user.upload(screen.getByLabelText('Arquivo'), pdf('CE01-14PE01-EST-PR-002.pdf'))
    expect(screen.getByLabelText('Título')).toHaveValue('CE01-14PE01-EST-PR-002')
    expect(screen.getByLabelText('Tipo do documento')).toHaveValue('prancha')
    expect(screen.getByLabelText(/Disciplina/)).toHaveValue('EST')
    expect(enviar).toBeDisabled() // falta a revisão
    expect(screen.getByRole('alert')).toHaveTextContent(/Revisão inválida/)
    await user.type(screen.getByLabelText('Revisão'), 'R01')
    expect(enviar).toBeEnabled()
    await user.click(enviar)
    expect(await screen.findByText(/Enviado: CE01-14PE01-EST-PR-002, revisão R01/)).toBeInTheDocument()
    const grupo = await screen.findByRole('region', { name: 'EST' })
    expect(within(grupo).getByText('CE01-14PE01-EST-PR-002')).toBeInTheDocument()
  })

  it('nova revisão preenche a série e a próxima revisão; a lista mostra a nova', async () => {
    const user = userEvent.setup()
    const { repo } = await renderizar()
    const antes = (await repo.listarDocumentos('hto')).find((d) => d.revisao === 'R06')!
    await screen.findByText(antes.titulo)
    await user.click(within(item(antes.titulo)).getByRole('button', { name: 'Nova revisão' }))
    expect(screen.getByLabelText('Título')).toHaveValue(antes.titulo)
    expect(screen.getByLabelText('Revisão')).toHaveValue('R07')
    await user.upload(screen.getByLabelText('Arquivo'), pdf('nova.pdf'))
    await user.click(screen.getByRole('button', { name: 'Enviar' }))
    await waitFor(() => expect(item(antes.titulo)).toHaveTextContent('R07'))
    const depois = (await repo.listarDocumentos('hto')).find((d) => d.serie === antes.serie)!
    expect(depois).toMatchObject({ revisao: 'R07', revisoes: 2 })
  })

  it('mostra o histórico, retira com confirmação e chama aoAbrir em "Ver"', async () => {
    const user = userEvent.setup()
    const { aoAbrir } = await renderizar()
    const titulo = 'Planta baixa do pavimento tipo'
    await screen.findByText(titulo)
    expect(within(item('Implantação (DWG)')).queryByRole('button', { name: 'Ver' })).not.toBeInTheDocument()

    await user.click(within(item(titulo)).getByRole('button', { name: 'Ver' }))
    expect(aoAbrir).toHaveBeenCalledWith(expect.objectContaining({ titulo }))

    await user.click(within(item(titulo)).getByRole('button', { name: 'Histórico' }))
    expect(await within(item(titulo)).findByText('R06')).toBeInTheDocument()

    await user.click(within(item(titulo)).getByRole('button', { name: 'Retirar' }))
    expect(screen.getByText('O arquivo fica guardado e continua no histórico.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirmar: retirar' }))
    await waitFor(() => expect(screen.queryByText(titulo)).not.toBeInTheDocument())
    expect(screen.getByText('Implantação (DWG)')).toBeInTheDocument()
  })

  const TITULO = 'Planta baixa do pavimento tipo'
  const vinculosDoTitulo = async (repo: Awaited<ReturnType<typeof renderizar>>['repo']) =>
    (await repo.listarDocumentos('hto')).find((d) => d.titulo === TITULO)!.vinculos

  it('vincula a seleção, mostra o vínculo, remove e mostra no 3D ao clicar', async () => {
    const user = userEvent.setup()
    const { repo, onMostrar } = await renderizar([REF_A])
    await screen.findByText(TITULO)
    await user.click(within(item(TITULO)).getByRole('button', { name: /^Vínculos \(0\)/ }))
    await user.click(within(item(TITULO)).getByRole('button', { name: 'Vincular seleção (1)' }))
    await waitFor(async () => expect(await vinculosDoTitulo(repo)).toHaveLength(1))
    expect(await vinculosDoTitulo(repo)).toEqual([expect.objectContaining({ tipo: 'elemento', sigla: 'ARQ', globalId: 'g-parede-1' })])
    const mostrar = await within(item(TITULO)).findByRole('button', { name: 'Mostrar Parede 1' })
    await user.click(mostrar)
    expect(onMostrar).toHaveBeenCalledWith([expect.objectContaining({ globalId: 'g-parede-1' })])

    await user.click(within(item(TITULO)).getByRole('button', { name: 'Remover vínculo Parede 1' }))
    await waitFor(async () => expect(await vinculosDoTitulo(repo)).toHaveLength(0))
  })

  it('"Vincular seleção" fica desabilitado sem seleção', async () => {
    const user = userEvent.setup()
    await renderizar([])
    await screen.findByText(TITULO)
    await user.click(within(item(TITULO)).getByRole('button', { name: /^Vínculos/ }))
    expect(within(item(TITULO)).getByRole('button', { name: 'Vincular seleção (0)' })).toBeDisabled()
  })

  it('vincula um pavimento', async () => {
    const user = userEvent.setup()
    const { repo } = await renderizar()
    await screen.findByText(TITULO)
    await user.click(within(item(TITULO)).getByRole('button', { name: /^Vínculos/ }))
    await user.selectOptions(within(item(TITULO)).getByLabelText('Vincular pavimento…'), 'g-pav-1')
    await waitFor(async () =>
      expect(await vinculosDoTitulo(repo)).toEqual([expect.objectContaining({ tipo: 'pavimento', nome: 'Térreo', globalId: 'g-pav-1' })]),
    )
  })

  it('nova revisão copia os vínculos da anterior (e não copia se desmarcado)', async () => {
    const user = userEvent.setup()
    const { repo } = await renderizar([], async (r) => {
      const d = (await r.listarDocumentos('hto')).find((x) => x.titulo === TITULO)!
      await r.vincularDocumento(d.id, [{ tipo: 'elemento', ...REF_A }])
    })
    const antes = (await repo.listarDocumentos('hto')).find((d) => d.titulo === TITULO)!
    await screen.findByText(TITULO)
    await waitFor(() => expect(item(TITULO)).toHaveTextContent('R06'))
    await user.click(within(item(TITULO)).getByRole('button', { name: 'Nova revisão' }))
    expect(screen.getByLabelText('Copiar os vínculos da revisão anterior')).toBeChecked()
    await user.upload(screen.getByLabelText('Arquivo'), pdf('nova.pdf'))
    await user.click(screen.getByRole('button', { name: 'Enviar' }))
    await waitFor(() => expect(item(TITULO)).toHaveTextContent('R07'))
    const nova = (await repo.listarDocumentos('hto')).find((d) => d.serie === antes.serie)!
    expect(nova.id).not.toBe(antes.id)
    expect(nova.vinculos).toEqual([expect.objectContaining({ globalId: 'g-parede-1' })])
  })
})
