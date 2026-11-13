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

describe('aba Boletins: etapa escolhida', () => {
  it('lista os emitidos (mais recentes primeiro) e o pedido com falha, com o erro', async () => {
    renderizar('/boletins?etapa=2a-etapa')
    const tabela = await screen.findByRole('table', { name: 'Boletins emitidos' })
    const linhas = within(tabela).getAllByRole('row').slice(1)
    expect(linhas.map((l) => within(l).getAllByRole('cell')[0].textContent)).toEqual([
      `${num(ontem)} rascunho`,
      `${num(anteontem, 1)} editado a partir de ${num(anteontem)}`,
      num(anteontem),
    ])
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
    renderizar('/boletins?etapa=2a-etapa', repo)
    await user.click(await screen.findByRole('button', { name: `Abrir PDF de ${num(ontem)}` }))
    expect(url).toHaveBeenCalledWith(`etapa-2a/${num(ontem).replace(/\//g, '')}.pdf`)
    expect(abrir).toHaveBeenCalledWith('https://exemplo/assinada.pdf', '_blank')
  })

  it('emitir agora: confirma com o número e o envio ao grupo; o pedido entra na fila', async () => {
    const user = userEvent.setup()
    renderizar('/boletins?etapa=2a-etapa')
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
    renderizar('/boletins?etapa=2a-etapa', repo)
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
    renderizar('/boletins?etapa=2a-etapa', repo)
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
    renderizar('/boletins?etapa=2a-etapa', repo)
    await user.click(await screen.findByRole('button', { name: 'Pré-visualizar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Gerador indisponível')
  })

  it('etapa sem sigla e sem grupo: pede a sigla e não oferece emissão', async () => {
    renderizar('/boletins?etapa=3a-etapa')
    expect(await screen.findByText('Defina a sigla da etapa para emitir boletins.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Emitir agora' })).not.toBeInTheDocument()
    expect(await screen.findByRole('table', { name: 'Boletins emitidos' })).toHaveTextContent(numeroBoletim('3', ontem, 'CO-FZ'))
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

describe('aba Boletins: reenvio ao Telegram', () => {
  /** Repositório cujo boletim mais recente está no estado de publicação dado. */
  async function comEstado(estado: string, erro: string | null = null) {
    const repo = criarRepositorioAdminFixture()
    const lista = await repo.listarTodosBoletins({ etapa: '2a-etapa' })
    const boletins = lista.boletins.map((b, i) =>
      i === 0 ? { ...b, publicado: false, publicacao_estado: estado, publicacao_erro: erro, publicacao_tentativas: 8 } : b,
    )
    vi.spyOn(repo, 'listarTodosBoletins').mockResolvedValue({ ...lista, boletins })
    return repo
  }

  it('falhou: mostra o erro e reenvia sem confirmação', async () => {
    const user = userEvent.setup()
    const repo = await comEstado('falhou', 'chat not found')
    const reenviar = vi.spyOn(repo, 'reenviarBoletim').mockResolvedValue()
    const confirmar = vi.spyOn(window, 'confirm')
    renderizar('/boletins?etapa=2a-etapa', repo)
    expect(await screen.findByText('chat not found')).toHaveClass('adm-dica')
    await user.click(screen.getByRole('button', { name: `Reenviar ${num(ontem)} ao Telegram` }))
    expect(confirmar).not.toHaveBeenCalled()
    expect(reenviar).toHaveBeenCalledWith('2a-etapa', `boletim-${ontem}-0`)
  })

  it('incerto: pede confirmação; recusada não reenvia, aceita reenvia', async () => {
    const user = userEvent.setup()
    const repo = await comEstado('incerto')
    const reenviar = vi.spyOn(repo, 'reenviarBoletim').mockResolvedValue()
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    renderizar('/boletins?etapa=2a-etapa', repo)
    const botao = await screen.findByRole('button', { name: `Reenviar ${num(ontem)} ao Telegram` })
    await user.click(botao)
    expect(confirmar).toHaveBeenCalledWith(
      'O envio pode ter chegado ao grupo. Confira no Telegram antes: reenviar pode duplicar a mensagem. Reenviar mesmo assim?',
    )
    expect(reenviar).not.toHaveBeenCalled()
    await user.click(botao)
    expect(reenviar).toHaveBeenCalledTimes(1)
  })

  it('sem botão em publicado e aguardando', async () => {
    renderizar('/boletins?etapa=2a-etapa')
    await screen.findByRole('table', { name: 'Boletins emitidos' })
    expect(screen.queryByRole('button', { name: /Reenviar/ })).not.toBeInTheDocument()
  })

  it('mostra o erro do reenvio', async () => {
    const user = userEvent.setup()
    const repo = await comEstado('falhou')
    vi.spyOn(repo, 'reenviarBoletim').mockRejectedValue(new Error('O envio deste boletim já está em andamento'))
    renderizar('/boletins?etapa=2a-etapa', repo)
    await user.click(await screen.findByRole('button', { name: `Reenviar ${num(ontem)} ao Telegram` }))
    expect(await screen.findByRole('alert')).toHaveTextContent('já está em andamento')
  })

  it('fixture: recusa pendente, publicado, boletim inexistente e etapa sem grupo', async () => {
    const repo = criarRepositorioAdminFixture()
    await expect(repo.reenviarBoletim('2a-etapa', `boletim-${ontem}-0`)).rejects.toThrow('em andamento')
    await expect(repo.reenviarBoletim('2a-etapa', `boletim-${anteontem}-0`)).rejects.toThrow('já foi publicado')
    await expect(repo.reenviarBoletim('2a-etapa', 'nao-existe')).rejects.toThrow('Boletim não encontrado')
    await expect(repo.reenviarBoletim('3a-etapa', `boletim-${ontem}-0`)).rejects.toThrow('Boletim não encontrado')
  })
})

describe('aba Boletins: lista geral e filtros', () => {
  const linhas = async () => {
    const tabela = await screen.findByRole('table', { name: 'Boletins emitidos' })
    return within(tabela).getAllByRole('row').slice(1)
  }

  it('sem etapa: todas as etapas, últimos 30 dias, sem o bloco de emissão', async () => {
    renderizar('/boletins')
    const l = await linhas()
    // 2ª e 3ª etapa; o boletim de 45 dias atrás fica de fora
    expect(l).toHaveLength(4)
    expect(within(l[0]).getByText('2ª ETAPA')).toBeInTheDocument()
    expect(within(l[1]).getByText('3ª ETAPA')).toBeInTheDocument()
    expect(screen.getByLabelText('Etapa')).toHaveValue('')
    expect(screen.getByLabelText('De')).toHaveValue(somarDias(hoje, -30))
    expect(screen.getByLabelText('Até')).toHaveValue(hoje)
    expect(screen.queryByLabelText('Data do boletim')).not.toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Pedidos de emissão' })).toHaveTextContent('Tempo esgotado ao gerar o PDF')
  })

  it('?etapa= escolhe a etapa no filtro e mostra o bloco de emissão; trocar o filtro refaz a lista', async () => {
    const user = userEvent.setup()
    renderizar('/boletins?etapa=3a-etapa')
    expect(await screen.findByLabelText('Etapa')).toHaveValue('3a-etapa')
    expect(await linhas()).toHaveLength(1)
    await user.selectOptions(screen.getByLabelText('Etapa'), '2a-etapa')
    expect(await screen.findByLabelText('Data do boletim')).toBeInTheDocument()
    await waitFor(async () => expect(await linhas()).toHaveLength(3))
    await user.selectOptions(screen.getByLabelText('Etapa'), '')
    await waitFor(async () => expect(await linhas()).toHaveLength(4))
    expect(screen.queryByLabelText('Data do boletim')).not.toBeInTheDocument()
  })

  it('etapa inexistente na URL: avisa', async () => {
    renderizar('/boletins?etapa=nao-existe')
    expect(await screen.findByRole('alert')).toHaveTextContent('Etapa não encontrada')
  })

  it('período: ampliar o "De" traz o boletim antigo; o repositório recebe as datas', async () => {
    const user = userEvent.setup()
    const repo = criarRepositorioAdminFixture()
    const listar = vi.spyOn(repo, 'listarTodosBoletins')
    renderizar('/boletins', repo)
    await linhas()
    expect(listar).toHaveBeenCalledWith({ etapa: undefined, de: somarDias(hoje, -30), ate: hoje })
    const de = screen.getByLabelText('De')
    await user.clear(de)
    await user.type(de, somarDias(hoje, -60))
    await waitFor(async () => expect(await linhas()).toHaveLength(5))
    await user.clear(screen.getByLabelText('Até'))
    await user.type(screen.getByLabelText('Até'), somarDias(hoje, -50))
    expect(await screen.findByText('Nenhum boletim emitido no período.')).toBeInTheDocument()
  })

  it('marcas "editado" (com a base) e "rascunho", e o link Editar', async () => {
    renderizar('/boletins?etapa=2a-etapa')
    const l = await linhas()
    expect(within(l[0]).getByText('rascunho')).toBeInTheDocument()
    expect(within(l[0]).queryByText('editado')).not.toBeInTheDocument()
    expect(within(l[1]).getByText('editado')).toBeInTheDocument()
    expect(within(l[1]).getByText(`a partir de ${num(anteontem)}`)).toBeInTheDocument()
    expect(within(l[2]).queryByText('editado')).not.toBeInTheDocument()
    expect(within(l[2]).queryByText('rascunho')).not.toBeInTheDocument()
    expect(within(l[1]).getByRole('link', { name: `Editar ${num(anteontem, 1)}` })).toHaveAttribute('href', `/boletins/boletim-${anteontem}-1`)
  })

  it('Editar abre o editor do boletim', async () => {
    const user = userEvent.setup()
    renderizar('/boletins?etapa=2a-etapa')
    await user.click(await screen.findByRole('link', { name: `Editar ${num(ontem)}` }))
    expect(await screen.findByRole('heading', { level: 1, name: `Boletim ${num(ontem)}` })).toBeInTheDocument()
  })
})

describe('fixture: edição do boletim', () => {
  const id = `boletim-${ontem}-0`
  it('rascunho: salva, lê no boletim e apaga com edição vazia', async () => {
    const repo = criarRepositorioAdminFixture()
    expect((await repo.boletim(id)).rascunho?.edicao.fotos_ocultas).toHaveLength(1)
    expect(await repo.salvarRascunhoBoletim(id, { ocultos: ['servico:x'] })).toMatchObject({ atualizado_em: expect.any(String) })
    expect((await repo.boletim(id)).rascunho?.edicao).toEqual({ ocultos: ['servico:x'] })
    expect(await repo.salvarRascunhoBoletim(id, {})).toBeNull()
    expect((await repo.boletim(id)).rascunho).toBeNull()
    await expect(repo.salvarRascunhoBoletim(`boletim-${anteontem}-0`, { ocultos: ['a'] })).rejects.toThrow('última revisão')
    await expect(repo.boletim('nao-existe')).rejects.toThrow('não encontrado')
  })

  it('retificar: próxima revisão, pedido editado; recusa vazia e emissão em andamento', async () => {
    const repo = criarRepositorioAdminFixture()
    await expect(repo.retificarBoletim(id, {})).rejects.toThrow('Nenhuma alteração')
    const r = await repo.retificarBoletim(id, { ocultos: ['servico:x'] })
    expect(r).toMatchObject({ revisao: 1, estado: 'pendente', numero: num(ontem, 1) })
    const { pedidos } = await repo.listarTodosBoletins({ etapa: '2a-etapa' })
    expect(pedidos.find((p) => p.data === ontem)).toMatchObject({ editado: true, etapa_slug: '2a-etapa' })
    expect((await repo.boletim(id)).emissao_em_andamento).toBe(true)
    await expect(repo.retificarBoletim(id, { ocultos: ['b'] })).rejects.toThrow('em andamento')
  })

  it('prévia editada é PDF e urlsFotos devolve uma URL por caminho', async () => {
    const repo = criarRepositorioAdminFixture()
    expect((await repo.previaBoletimEditado(id, { ocultos: ['a'] })).type).toBe('application/pdf')
    const urls = await repo.urlsFotos(['a/1.jpg', 'a/1.jpg', 'b/2.jpg'])
    expect(Object.keys(urls)).toEqual(['a/1.jpg', 'b/2.jpg'])
    const b = await repo.boletim(id)
    expect(b.ultima_revisao).toBe(true)
    expect(b.snapshot.obras[0].servicos.length).toBeGreaterThan(0)
  })
})
