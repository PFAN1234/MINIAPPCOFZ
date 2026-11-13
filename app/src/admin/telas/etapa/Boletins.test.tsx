import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AdminApp from '../../AdminApp.tsx'
import { RepositorioAdminProvider } from '../../dados/contexto.tsx'
import { criarRepositorioAdminFixture } from '../../dados/fixture.ts'
import { somarDias } from '../../dados/fixtureBoletim.ts'
import type { RepositorioAdmin } from '../../dados/repositorio.ts'
import { criarEntrada } from '../../entrada.ts'
import { dataBr, hojeNoFuso, numeroBoletim } from '../../formato.ts'

function renderizar(rota: string, repo: RepositorioAdmin = criarRepositorioAdminFixture()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <RepositorioAdminProvider repositorio={repo}>
        <MemoryRouter initialEntries={[rota]}>
          <AdminApp entrada={criarEntrada(null)} />
        </MemoryRouter>
      </RepositorioAdminProvider>
    </QueryClientProvider>,
  )
  return repo
}

const hoje = hojeNoFuso('America/Fortaleza')
const ontem = somarDias(hoje, -1)
const anteontem = somarDias(hoje, -2)
const num = (data: string, r = 0) => numeroBoletim('2', data, 'CO-FZ') + (r > 0 ? `-R${r}` : '')

beforeEach(() => {
  // jsdom não tem as URLs de blob.
  URL.createObjectURL = vi.fn(() => 'blob:previa')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => vi.restoreAllMocks())

describe('página da etapa: boletins', () => {
  it('lista os emitidos (mais recentes primeiro) e o pedido com falha, com o erro', async () => {
    renderizar('/etapas/2a-etapa')
    const tabela = await screen.findByRole('table', { name: 'Boletins emitidos' })
    const linhas = within(tabela).getAllByRole('row').slice(1)
    expect(linhas.map((l) => within(l).getAllByRole('cell')[0].textContent)).toEqual([num(ontem), num(anteontem, 1), num(anteontem)])
    expect(within(linhas[0]).getByText('automático')).toBeInTheDocument()
    expect(within(linhas[0]).getByText('aguardando')).toBeInTheDocument()
    expect(within(linhas[1]).getByText('CP PATRICIO')).toBeInTheDocument()
    expect(within(linhas[1]).getByText('publicado')).toBeInTheDocument()
    const pedidos = screen.getByRole('table', { name: 'Pedidos de emissão' })
    expect(within(pedidos).getByText('falhou')).toBeInTheDocument()
    expect(within(pedidos).getByText('Tempo esgotado ao gerar o PDF')).toBeInTheDocument()
    expect(within(pedidos).getByText('8')).toBeInTheDocument()
  })

  it('"Abrir PDF" pede a URL do PDF e abre numa aba nova', async () => {
    const user = userEvent.setup()
    const repo = criarRepositorioAdminFixture()
    const url = vi.spyOn(repo, 'urlPdfBoletim').mockResolvedValue('https://exemplo/assinada.pdf')
    const abrir = vi.spyOn(window, 'open').mockReturnValue({} as Window)
    renderizar('/etapas/2a-etapa', repo)
    await user.click(await screen.findByRole('button', { name: `Abrir PDF de ${num(ontem)}` }))
    expect(url).toHaveBeenCalledWith(`etapa-2a/${num(ontem).replace(/\//g, '')}.pdf`)
    expect(abrir).toHaveBeenCalledWith('https://exemplo/assinada.pdf', '_blank')
  })

  it('emitir agora: confirma com o número e o envio ao grupo; o pedido entra na fila', async () => {
    const user = userEvent.setup()
    renderizar('/etapas/2a-etapa')
    const data = await screen.findByLabelText('Data do boletim')
    expect(data).toHaveValue(hoje)
    expect(data).toHaveAttribute('max', hoje)
    await user.click(screen.getByRole('button', { name: 'Emitir agora' }))
    const dialogo = screen.getByRole('alertdialog')
    expect(dialogo).toHaveTextContent(`Será emitido o boletim ${num(hoje)}, com os lançamentos de ${dataBr(hoje)}`)
    expect(dialogo).toHaveTextContent('O PDF será enviado ao grupo do Telegram da etapa.')
    await user.click(within(dialogo).getByRole('button', { name: `Confirmar: emitir agora (${num(hoje)})` }))
    expect(await screen.findByText(/Pedido de emissão de .* enviado/)).toBeInTheDocument()
    const pedidos = await screen.findByRole('table', { name: 'Pedidos de emissão' })
    expect(await within(pedidos).findByText('na fila')).toBeInTheDocument()
    // com o pedido em andamento, não deixa pedir de novo para a mesma data
    expect(screen.getByRole('button', { name: 'Emitir agora' })).toBeDisabled()
    expect(screen.getByText(`Já há um pedido de emissão em andamento para ${dataBr(hoje)}.`)).toBeInTheDocument()
  })

  it('data com boletim emitido vira retificação com o próximo número', async () => {
    const user = userEvent.setup()
    const repo = criarRepositorioAdminFixture()
    const pedir = vi.spyOn(repo, 'pedirEmissao')
    renderizar('/etapas/2a-etapa', repo)
    const data = await screen.findByLabelText('Data do boletim')
    await user.clear(data)
    await user.type(data, anteontem)
    await user.click(screen.getByRole('button', { name: 'Emitir retificação' }))
    const dialogo = screen.getByRole('alertdialog')
    expect(dialogo).toHaveTextContent(`Será emitida a retificação ${num(anteontem, 2)} do boletim de ${dataBr(anteontem)}`)
    await user.click(within(dialogo).getByRole('button', { name: /^Confirmar: emitir retificação/ }))
    expect(pedir).toHaveBeenCalledWith('2a-etapa', anteontem)
    expect(await screen.findByText(`Pedido de emissão de ${num(anteontem, 2)} enviado. O boletim aparece na lista assim que for gerado.`)).toBeInTheDocument()
  })

  it('pré-visualizar abre o PDF da prévia sem gravar nada', async () => {
    const user = userEvent.setup()
    const repo = criarRepositorioAdminFixture()
    const previa = vi.spyOn(repo, 'previaBoletim')
    const pedir = vi.spyOn(repo, 'pedirEmissao')
    const abrir = vi.spyOn(window, 'open').mockReturnValue(null)
    renderizar('/etapas/2a-etapa', repo)
    await user.click(await screen.findByRole('button', { name: 'Pré-visualizar' }))
    expect(previa).toHaveBeenCalledWith('2a-etapa', hoje)
    expect(await screen.findByRole('link', { name: 'abrir a prévia' })).toHaveAttribute('href', 'blob:previa')
    expect(abrir).toHaveBeenCalledWith('blob:previa', '_blank')
    expect(pedir).not.toHaveBeenCalled()
  })

  it('mostra o erro do servidor', async () => {
    const user = userEvent.setup()
    const repo = criarRepositorioAdminFixture()
    vi.spyOn(repo, 'previaBoletim').mockRejectedValue(new Error('Gerador indisponível'))
    renderizar('/etapas/2a-etapa', repo)
    await user.click(await screen.findByRole('button', { name: 'Pré-visualizar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Gerador indisponível')
  })

  it('etapa sem sigla e sem grupo: pede a sigla e não oferece emissão', async () => {
    renderizar('/etapas/3a-etapa')
    expect(await screen.findByText('Defina a sigla da etapa para emitir boletins.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Emitir agora' })).not.toBeInTheDocument()
    expect(screen.getByText('Nenhum boletim emitido.')).toBeInTheDocument()
  })
})

describe('fixture: boletins (como admin_listar_boletins / admin_pedir_emissao)', () => {
  it('recusa data futura e pedido repetido em andamento; retificação soma 1 na revisão', async () => {
    const repo = criarRepositorioAdminFixture()
    await expect(repo.pedirEmissao('2a-etapa', somarDias(hoje, 1))).rejects.toThrow('data futura')
    await expect(repo.pedirEmissao('2a-etapa', '2026-02-30')).rejects.toThrow('Data inválida')
    expect(await repo.pedirEmissao('2a-etapa', hoje)).toMatchObject({ data: hoje, revisao: 0, estado: 'pendente' })
    await expect(repo.pedirEmissao('2a-etapa', hoje)).rejects.toThrow('em andamento')
    expect((await repo.pedirEmissao('2a-etapa', anteontem)).revisao).toBe(2)
    expect((await repo.pedirEmissao('2a-etapa', ontem)).revisao).toBe(1)
    const { pedidos } = await repo.listarBoletins('2a-etapa')
    expect(pedidos.map((p) => [p.data, p.revisao, p.estado])).toEqual([
      [hoje, 0, 'pendente'],
      [ontem, 1, 'pendente'],
      [anteontem, 2, 'pendente'],
      [somarDias(hoje, -3), 0, 'falhou'],
    ])
  })

  it('pedido que falhou volta para a fila ao pedir de novo', async () => {
    const repo = criarRepositorioAdminFixture()
    const r = await repo.pedirEmissao('2a-etapa', somarDias(hoje, -3))
    expect(r).toMatchObject({ id: 1, revisao: 0, estado: 'pendente', tentativas: 0, erro: null })
  })

  it('etapa sem sigla não emite; prévia é um PDF', async () => {
    const repo = criarRepositorioAdminFixture()
    await expect(repo.pedirEmissao('3a-etapa', hoje)).rejects.toThrow('não tem sigla')
    const pdf = await repo.previaBoletim('2a-etapa', hoje)
    expect(pdf.type).toBe('application/pdf')
    expect(new TextDecoder().decode(await pdf.arrayBuffer())).toMatch(/^%PDF-1\.4[\s\S]*%%EOF\n$/)
  })
})
