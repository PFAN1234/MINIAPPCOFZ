import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AdminApp from '../../AdminApp.tsx'
import { RepositorioAdminProvider } from '../../dados/contexto.tsx'
import { criarRepositorioAdminFixture } from '../../dados/fixture.ts'
import { somarDias } from '../../dados/fixtureBoletim.ts'
import type { RepositorioAdmin } from '../../dados/repositorio.ts'
import { criarEntrada } from '../../entrada.ts'
import { hojeNoFuso, numeroBoletim } from '../../formato.ts'

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
const ID = `boletim-${ontem}-0`
const SRV1 = `servico:srv-${ontem}-1`
const SRV2 = `servico:srv-${ontem}-2`
const ABERTA = `aberta:pen-${ontem}-1`
const FOTO_A = `etapa/fotos/${ontem}-a.jpg`
const FOTO_B = `etapa/fotos/${ontem}-b.jpg`
const RASCUNHO = { ocultos: [ABERTA], fotos_ocultas: [FOTO_A] }

/** O cartão de um item, pela chave. */
function item(chave: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-chave="${chave}"]`)
  if (!el) throw new Error(`Item ${chave} não encontrado`)
  return el
}

async function abrirEditor(id = ID, repo?: RepositorioAdmin) {
  const r = renderizar(`/boletins/${id}`, repo)
  await screen.findByRole('heading', { level: 1 })
  return r
}

async function editarTexto(user: ReturnType<typeof userEvent.setup>, chave: string, rotulo: RegExp, texto: string) {
  await user.click(within(item(chave)).getByRole('button', { name: rotulo }))
  const campo = screen.getByRole('textbox')
  expect(campo).toHaveFocus()
  await user.clear(campo)
  if (texto) await user.type(campo, texto)
  return campo
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:previa')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => vi.restoreAllMocks())

describe('editor do boletim', () => {
  it('mostra o cabeçalho, o rascunho como estado inicial e os blocos do snapshot', async () => {
    await abrirEditor()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(num(ontem))
    expect(screen.getByRole('link', { name: /Boletins de 2ª ETAPA/ })).toHaveAttribute('href', '/boletins?etapa=2a-etapa')
    expect(screen.getByText(/Rascunho salvo em .* por CP PATRICIO/)).toBeInTheDocument()
    expect(screen.getByText(/Telegram: aguardando/)).toBeInTheDocument()
    for (const t of ['Serviços', 'Pendências abertas', 'Pendências encerradas', 'Observações', 'Lançamentos tardios']) {
      expect(screen.getAllByRole('heading', { name: t }).length).toBeGreaterThan(0)
    }
    // Rascunho aplicado: pendência aberta oculta e uma foto oculta.
    expect(within(item(ABERTA)).getByText('oculto')).toBeInTheDocument()
    expect(within(item(SRV1)).getByRole('button', { name: `Mostrar foto ${ontem}-a.jpg` })).toBeInTheDocument()
    expect(within(item(`encerrada:enc-${ontem}-1`)).getByText('Espelho instalado')).toBeInTheDocument()
    expect(screen.getByText('Limpeza final do pavimento')).toBeInTheDocument()
    expect(await screen.findAllByRole('img')).not.toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled()
  })

  it('Abrir PDF abre o PDF do boletim numa aba nova', async () => {
    const user = userEvent.setup()
    const repo = criarRepositorioAdminFixture()
    vi.spyOn(repo, 'urlPdfBoletim').mockResolvedValue('https://exemplo/b.pdf')
    const abrir = vi.spyOn(window, 'open').mockReturnValue({} as Window)
    await abrirEditor(ID, repo)
    await user.click(screen.getByRole('button', { name: 'Abrir PDF' }))
    await waitFor(() => expect(abrir).toHaveBeenCalledWith('https://exemplo/b.pdf', '_blank'))
  })

  it('edita o texto no lugar e salva o rascunho com a edição certa', async () => {
    const user = userEvent.setup()
    const repo = criarRepositorioAdminFixture()
    const salvar = vi.spyOn(repo, 'salvarRascunhoBoletim')
    await abrirEditor(ID, repo)
    await editarTexto(user, SRV1, /Editar legenda/, 'Laje do térreo concluída')
    await user.tab()
    expect(within(item(SRV1)).getByText('Laje do térreo concluída')).toBeInTheDocument()
    expect(within(item(SRV1)).getAllByText('alterado').length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(salvar).toHaveBeenCalledWith(ID, { textos: { [SRV1]: 'Laje do térreo concluída' }, ...RASCUNHO }),
    )
    expect(await screen.findByText('Rascunho salvo.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled()
  })

  it('Enter no botão abre a edição; Esc cancela sem alterar', async () => {
    const user = userEvent.setup()
    await abrirEditor()
    within(item(SRV1)).getByRole('button', { name: /Editar legenda/ }).focus()
    await user.keyboard('{Enter}')
    const campo = screen.getByRole('textbox')
    expect(campo).toHaveFocus()
    await user.type(campo, ' XYZ')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(within(item(SRV1)).getByText('Concretagem da laje concluída')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled()
  })

  it('texto igual ao original remove a chave; texto vazio mostra "sem texto"', async () => {
    const user = userEvent.setup()
    await abrirEditor()
    await editarTexto(user, SRV1, /Editar legenda/, 'Outro')
    await user.tab()
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeEnabled()
    await editarTexto(user, SRV1, /Editar legenda/, 'Concretagem da laje concluída')
    await user.tab()
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled()
    await editarTexto(user, SRV1, /Editar legenda/, '')
    await user.tab()
    expect(within(item(SRV1)).getByText('sem texto')).toBeInTheDocument()
  })

  it('texto vazio numa observação e num lançamento tardio oculta o item', async () => {
    const user = userEvent.setup()
    await abrirEditor()
    await editarTexto(user, 'observacao:obra-hto:0', /Editar observação/, '')
    await user.tab()
    expect(within(item('observacao:obra-hto:0')).getByText('oculto (texto vazio)')).toBeInTheDocument()
    await editarTexto(user, `tardio:tar-${ontem}-1`, /Editar texto/, '')
    await user.tab()
    expect(within(item(`tardio:tar-${ontem}-1`)).getByText('oculto (texto vazio)')).toBeInTheDocument()
  })

  it('oculta e mostra item e foto; o encerramento não tem botão de ocultar', async () => {
    const user = userEvent.setup()
    const repo = criarRepositorioAdminFixture()
    const salvar = vi.spyOn(repo, 'salvarRascunhoBoletim')
    await abrirEditor(ID, repo)
    await user.click(within(item(SRV2)).getByRole('button', { name: /^Ocultar 1º pavimento/ }))
    expect(within(item(SRV2)).getByText('oculto')).toBeInTheDocument()
    await user.click(within(item(SRV1)).getByRole('button', { name: `Ocultar foto ${ontem}-b.jpg` }))
    await user.click(within(item(SRV1)).getByRole('button', { name: `Mostrar foto ${ontem}-a.jpg` }))
    await user.click(within(item(ABERTA)).getByRole('button', { name: /^Mostrar/ }))
    expect(within(item(ABERTA)).queryByText('oculto')).not.toBeInTheDocument()
    const enc = item(`encerrada:enc-${ontem}-1`)
    expect(within(enc).getAllByRole('button', { name: /^Ocultar/ })).toHaveLength(2) // item + foto do encerramento
    expect(within(enc).getByRole('button', { name: /Editar observação do encerramento/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(salvar).toHaveBeenCalledWith(ID, { ocultos: [SRV2], fotos_ocultas: [FOTO_B] }))
  })

  it('Descartar com rascunho confirma e salva vazio', async () => {
    const user = userEvent.setup()
    const repo = criarRepositorioAdminFixture()
    const salvar = vi.spyOn(repo, 'salvarRascunhoBoletim')
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    await abrirEditor(ID, repo)
    await user.click(screen.getByRole('button', { name: 'Descartar alterações' }))
    expect(salvar).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Descartar alterações' }))
    expect(confirmar).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(salvar).toHaveBeenCalledWith(ID, {}))
    await waitFor(() => expect(within(item(ABERTA)).queryByText('oculto')).not.toBeInTheDocument())
    expect(screen.queryByText(/Rascunho salvo em/)).not.toBeInTheDocument()
  })

  it('Descartar sem rascunho volta ao boletim sem edição, sem confirmar', async () => {
    const user = userEvent.setup()
    const confirmar = vi.spyOn(window, 'confirm')
    await abrirEditor(`boletim-3a-${ontem}-0`)
    await user.click(within(item(`servico:srv-${ontem}-1`)).getByRole('button', { name: /^Ocultar Térreo/ }))
    expect(screen.getByText('alterações não salvas')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Descartar alterações' }))
    expect(confirmar).not.toHaveBeenCalled()
    expect(screen.queryByText('alterações não salvas')).not.toBeInTheDocument()
  })

  it('Pré-visualizar envia a edição atual e abre o PDF numa aba', async () => {
    const user = userEvent.setup()
    const repo = criarRepositorioAdminFixture()
    const previa = vi.spyOn(repo, 'previaBoletimEditado')
    const abrir = vi.spyOn(window, 'open').mockReturnValue({} as Window)
    await abrirEditor(ID, repo)
    await user.click(screen.getByRole('button', { name: 'Pré-visualizar' }))
    await waitFor(() => expect(previa).toHaveBeenCalledWith(ID, RASCUNHO))
    await waitFor(() => expect(abrir).toHaveBeenCalledWith('blob:previa', '_blank'))
  })

  it('Salvar e reenviar: confirmação recusada não chama; aceita retifica e volta à etapa', async () => {
    const user = userEvent.setup()
    const repo = criarRepositorioAdminFixture()
    const retificar = vi.spyOn(repo, 'retificarBoletim')
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    await abrirEditor(ID, repo)
    await user.click(screen.getByRole('button', { name: 'Salvar e reenviar' }))
    expect(confirmar).toHaveBeenLastCalledWith(
      'Gera a retificação R1 com as alterações e substitui a mensagem no grupo. Mensagens com mais de 48 h não podem ser apagadas e ficam no grupo.',
    )
    expect(retificar).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Salvar e reenviar' }))
    await waitFor(() => expect(retificar).toHaveBeenCalledWith(ID, RASCUNHO))
    const pedidos = await screen.findByRole('table', { name: 'Pedidos de emissão' })
    expect(within(pedidos).getByText('R1')).toBeInTheDocument()
  })

  it('mostra o erro da mutação na tela', async () => {
    const user = userEvent.setup()
    const repo = criarRepositorioAdminFixture()
    vi.spyOn(repo, 'salvarRascunhoBoletim').mockRejectedValue(new Error('Falha ao gravar'))
    await abrirEditor(ID, repo)
    await user.click(within(item(SRV2)).getByRole('button', { name: /^Ocultar (?!foto)/ }))
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Falha ao gravar')
  })

  it('o link de volta pede confirmação com alterações não salvas', async () => {
    const user = userEvent.setup()
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    await abrirEditor()
    await user.click(within(item(SRV2)).getByRole('button', { name: /^Ocultar (?!foto)/ }))
    await user.click(screen.getByRole('link', { name: /Boletins de 2ª ETAPA/ }))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(num(ontem))
    await user.click(screen.getByRole('link', { name: /Boletins de 2ª ETAPA/ }))
    expect(confirmar).toHaveBeenCalledTimes(2)
    expect(await screen.findByRole('heading', { name: 'Boletins' })).toBeInTheDocument()
  })

  it('só leitura quando não é a última revisão, com link para a lista da etapa', async () => {
    await abrirEditor(`boletim-${anteontem}-0`)
    expect(screen.getByText(/Só leitura: existe uma revisão mais recente/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'lista da etapa' })).toHaveAttribute('href', '/boletins?etapa=2a-etapa')
    expect(screen.queryByRole('button', { name: 'Salvar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Ocultar/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Editar legenda/ })).not.toBeInTheDocument()
    expect(screen.getByText('Concretagem da laje concluída')).toBeInTheDocument()
  })

  it('só leitura com emissão em andamento', async () => {
    const repo = criarRepositorioAdminFixture()
    const original = repo.boletim.bind(repo)
    vi.spyOn(repo, 'boletim').mockImplementation(async (id) => ({ ...(await original(id)), emissao_em_andamento: true }))
    await abrirEditor(ID, repo)
    expect(screen.getByText(/Só leitura: há uma emissão em andamento/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Salvar e reenviar' })).not.toBeInTheDocument()
  })

  it('aviso de retificação editada a partir do boletim base', async () => {
    await abrirEditor(`boletim-${anteontem}-1`)
    expect(screen.getByText(`Retificação editada a partir de ${num(anteontem)}`)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Abrir PDF' })).toBeEnabled()
  })
})
