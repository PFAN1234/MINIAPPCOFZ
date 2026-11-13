import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErroEnvio } from '../dados/erros.ts'
import { criarRepositorioFixture } from '../dados/fixture.ts'
import type { Repositorio } from '../dados/repositorio.ts'
import { renderizarApp } from '../test/renderApp.tsx'
import { formatarDia, horaNoFuso } from '../util/fuso.ts'

const HTO = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4e01'
const TRAVADA = 'O boletim de hoje já foi emitido. Correções são feitas por retificação.'

afterEach(() => {
  vi.restoreAllMocks()
})

async function cartao() {
  const titulo = await screen.findByRole('heading', { level: 3, name: 'Observações do dia' })
  return titulo.closest('section') as HTMLElement
}

/** Itens da lista do cartão, depois de carregados. */
async function itens(c: HTMLElement) {
  await within(c).findAllByRole('listitem')
  return within(c).getAllByRole('listitem')
}

function semSinal() {
  return vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
}

describe('Obra: cartão "Observações do dia"', () => {
  it('lista as de hoje por hora com "HH:MM · NOME" e botões só nas próprias', async () => {
    const repo = criarRepositorioFixture()
    const dia = await repo.observacoesDoDia(HTO)
    renderizarApp('/obras/hto', repo)
    const c = await cartao()
    expect(within(c).getByText(formatarDia(dia.data))).toBeInTheDocument()
    const [primeira, segunda] = await itens(c)
    const [patricio, minha] = dia.observacoes
    expect(primeira).toHaveTextContent(`${horaNoFuso(patricio.escrito_em, dia.fuso)} · CP PATRICIO`)
    expect(primeira).toHaveTextContent('Concretagem da laje do 1º pavimento')
    expect(within(primeira).queryByRole('button')).not.toBeInTheDocument()
    expect(segunda).toHaveTextContent(`${horaNoFuso(minha.escrito_em, dia.fuso)} · Você (teste)`)
    expect(within(segunda).getByRole('button', { name: /^Editar observação/ })).toBeEnabled()
    expect(within(segunda).getByRole('button', { name: /^Excluir observação/ })).toBeEnabled()
    expect(within(c).getByLabelText('Adicionar observação')).toBeInTheDocument()
    expect(within(c).getByRole('button', { name: 'Salvar' })).toBeDisabled()
  })

  it('obra sem observações hoje: "Nenhuma observação hoje."', async () => {
    renderizarApp('/obras/aurora')
    const c = await cartao()
    expect(await within(c).findByText('Nenhuma observação hoje.')).toBeInTheDocument()
  })

  it('adiciona pela fila (com sinal) e a observação passa ao servidor sem duplicar', async () => {
    const usuario = userEvent.setup()
    const repo = criarRepositorioFixture()
    const salvar = vi.spyOn(repo, 'salvarObservacao')
    renderizarApp('/obras/hto', repo)
    const c = await cartao()
    await itens(c)
    await usuario.type(within(c).getByLabelText('Adicionar observação'), '  Chuva forte às 15h  ')
    await usuario.click(within(c).getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(within(c).getAllByRole('listitem')).toHaveLength(3))
    expect(within(c).getByLabelText('Adicionar observação')).toHaveValue('')
    await waitFor(() => expect(within(c).queryByText(/aguardando envio|Enviando/)).not.toBeInTheDocument())
    expect(within(c).getAllByText('Chuva forte às 15h')).toHaveLength(1)
    expect(salvar).toHaveBeenCalledTimes(1)
    const [dados] = salvar.mock.calls[0]
    expect(dados).toMatchObject({ obraId: HTO, texto: 'Chuva forte às 15h' })
    expect(dados.id).toMatch(/^[0-9a-f-]{36}$/)
    expect((await repo.observacoesDoDia(HTO)).observacoes).toHaveLength(3)
  })

  it('contador perto do limite de 1000 caracteres', async () => {
    const usuario = userEvent.setup()
    renderizarApp('/obras/hto')
    const c = await cartao()
    const campo = within(c).getByLabelText('Adicionar observação')
    expect(campo).toHaveAttribute('maxlength', '1000')
    await usuario.click(campo)
    await usuario.paste('x'.repeat(899))
    expect(within(c).queryByText('899/1000')).not.toBeInTheDocument()
    await usuario.type(campo, 'y')
    expect(within(c).getByText('900/1000')).toBeInTheDocument()
  })

  it('edita a própria: novo texto e marca "editada"', async () => {
    const usuario = userEvent.setup()
    renderizarApp('/obras/hto')
    const c = await cartao()
    const minha = (await itens(c))[1]
    await usuario.click(within(minha).getByRole('button', { name: /^Editar observação/ }))
    const campo = within(minha).getByRole('textbox')
    await usuario.clear(campo)
    await usuario.type(campo, 'Elétrica retomada à tarde.')
    await usuario.click(within(minha).getByRole('button', { name: 'Salvar alteração' }))
    expect(await within(c).findByText('Elétrica retomada à tarde.')).toBeInTheDocument()
    await waitFor(() => expect(within(c).getByText(/editada/)).toBeInTheDocument())
  })

  it('exclui a própria depois de confirmar', async () => {
    const usuario = userEvent.setup()
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    renderizarApp('/obras/hto')
    const c = await cartao()
    const minha = (await itens(c))[1]
    await usuario.click(within(minha).getByRole('button', { name: /^Excluir observação/ }))
    expect(within(c).getAllByRole('listitem')).toHaveLength(2)
    await usuario.click(within(minha).getByRole('button', { name: /^Excluir observação/ }))
    expect(confirmar).toHaveBeenCalledWith('Excluir esta observação?')
    await waitFor(() => expect(within(c).getAllByRole('listitem')).toHaveLength(1))
    expect(within(c).queryByText(/Equipe de elétrica/)).not.toBeInTheDocument()
  })

  it('travada (boletim de hoje emitido): aviso e nada de adicionar, editar ou excluir', async () => {
    renderizarApp('/obras/hto', criarRepositorioFixture({ boletimEmitido: true }))
    const c = await cartao()
    expect(await within(c).findByText(TRAVADA)).toBeInTheDocument()
    await itens(c)
    expect(within(c).queryByRole('button')).not.toBeInTheDocument()
    expect(within(c).queryByLabelText('Adicionar observação')).not.toBeInTheDocument()
  })

  it('sem sinal: editar/excluir desabilitados com a dica; a nova fica "aguardando envio" e sai ao voltar o sinal', async () => {
    const usuario = userEvent.setup()
    const repo = criarRepositorioFixture()
    const salvar = vi.spyOn(repo, 'salvarObservacao')
    const onLine = semSinal()
    renderizarApp('/obras/hto', repo)
    const c = await cartao()
    const minha = (await itens(c))[1]
    expect(within(minha).getByRole('button', { name: /^Editar observação/ })).toBeDisabled()
    expect(within(minha).getByRole('button', { name: /^Excluir observação/ })).toBeDisabled()
    expect(within(minha).getByText('Precisa de conexão')).toBeInTheDocument()

    await usuario.type(within(c).getByLabelText('Adicionar observação'), 'Sem sinal no canteiro')
    await usuario.click(within(c).getByRole('button', { name: 'Salvar' }))
    const local = (await within(c).findByText('Sem sinal no canteiro')).closest('li')!
    expect(local).toHaveTextContent('· Você')
    await waitFor(() => expect(local).toHaveTextContent('Salvo no aparelho · aguardando envio'))
    expect(await screen.findByText('1 item aguardando envio')).toBeInTheDocument()

    onLine.mockReturnValue(true)
    window.dispatchEvent(new Event('online'))
    await waitFor(() => expect(within(c).queryByText(/aguardando envio/)).not.toBeInTheDocument())
    expect(within(c).getAllByText('Sem sinal no canteiro')).toHaveLength(1)
    // Mesmo id em todas as tentativas: no servidor fica uma só.
    expect(new Set(salvar.mock.calls.map(([d]) => d.id)).size).toBe(1)
    const servidor = (await repo.observacoesDoDia(HTO)).observacoes
    expect(servidor.filter((o) => o.texto === 'Sem sinal no canteiro')).toHaveLength(1)
  })

  it('22023 na fila (dia já emitido): falha definitiva com a mensagem, "Copiar texto" e "Descartar"', async () => {
    const usuario = userEvent.setup()
    const mensagem = 'O boletim de 13/11/2026 já foi emitido; a correção é feita por retificação'
    const base = criarRepositorioFixture()
    const repo: Repositorio = {
      ...base,
      salvarObservacao: vi.fn(async () => {
        throw new ErroEnvio('validacao', mensagem)
      }),
    }
    const escrever = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: escrever } })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderizarApp('/obras/hto', repo)
    const c = await cartao()
    await itens(c)
    await usuario.type(within(c).getByLabelText('Adicionar observação'), 'Tarde')
    await usuario.click(within(c).getByRole('button', { name: 'Salvar' }))
    const item = (await within(c).findByText(`Não foi possível enviar: ${mensagem}`)).closest('li')!
    expect(within(item).queryByRole('button', { name: 'Tentar de novo' })).not.toBeInTheDocument()
    await usuario.click(within(item).getByRole('button', { name: 'Copiar texto' }))
    expect(escrever).toHaveBeenCalledWith('Tarde')
    expect(await within(item).findByText('Texto copiado.')).toBeInTheDocument()
    await usuario.click(within(item).getByRole('button', { name: 'Descartar' }))
    await waitFor(() => expect(within(c).queryByText('Tarde')).not.toBeInTheDocument())
    expect(repo.salvarObservacao).toHaveBeenCalledTimes(1)
  })

  it('mais de 3: mostra as 3 últimas e "Ver todas (n)"', async () => {
    const usuario = userEvent.setup()
    const repo = criarRepositorioFixture()
    for (const [i, texto] of ['Terceira', 'Quarta'].entries()) {
      await repo.salvarObservacao({
        id: `00000000-0000-4000-8000-00000000060${i}`,
        obraId: HTO,
        texto,
        escritoEm: new Date().toISOString(),
      })
    }
    renderizarApp('/obras/hto', repo)
    const c = await cartao()
    await waitFor(() => expect(within(c).getAllByRole('listitem')).toHaveLength(3))
    expect(within(c).queryByText(/Concretagem da laje/)).not.toBeInTheDocument()
    await usuario.click(within(c).getByRole('button', { name: 'Ver todas (4)' }))
    expect(within(c).getAllByRole('listitem')).toHaveLength(4)
    expect(within(c).getByText(/Concretagem da laje/)).toBeInTheDocument()
  })
})
