import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ErroEnvio, MENSAGEM_REDE } from '../dados/erros.ts'
import { criarRepositorioFixture } from '../dados/fixture.ts'
import { renderizarApp } from '../test/renderApp.tsx'

vi.mock('../util/imagem.ts', async (original) => ({
  ...(await original<typeof import('../util/imagem.ts')>()),
  prepararFoto: vi.fn(async () => ({
    id: crypto.randomUUID(),
    blob: new Blob(['jpeg'], { type: 'image/jpeg' }),
    largura: 1200,
    altura: 900,
    bytes: 4,
  })),
}))

beforeAll(() => {
  let n = 0
  URL.createObjectURL = () => `blob:teste/${++n}`
  URL.revokeObjectURL = () => {}
})

describe('Pendências', () => {
  it('na rota da obra: abas com contagem, filtro por ambiente e aba Resolvidas', async () => {
    const usuario = userEvent.setup()
    renderizarApp('/obras/hto/pendencias')
    expect(await screen.findByRole('heading', { level: 1, name: 'Pendências' })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'HTO' })).toHaveAttribute('href', '/obras/hto')
    expect(await screen.findByRole('tab', { name: 'Abertas (3)', selected: true })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Resolvidas (1)' })).toBeInTheDocument()

    const cartoes = await screen.findAllByRole('link', { name: /Aberta/ })
    expect(cartoes).toHaveLength(3)
    const tomada = screen.getByRole('link', { name: /Tomada da sala/ })
    expect(tomada).toHaveTextContent('Térreo · Apto. 101')
    expect(tomada).toHaveAttribute('href', '/obras/hto/pendencias/00000000-0000-4000-8000-000000000101')

    const filtro = screen.getByRole('combobox', { name: 'Filtrar por ambiente' })
    expect(within(filtro).getByRole('option', { name: 'Todos os ambientes' })).toBeInTheDocument()
    await usuario.selectOptions(filtro, 'terreo-apto-101')
    expect(screen.getAllByRole('link', { name: /Aberta/ })).toHaveLength(1)
    expect(screen.getByRole('tab', { name: 'Abertas (1)' })).toBeInTheDocument()

    await usuario.click(screen.getByRole('tab', { name: 'Resolvidas (0)' }))
    expect(await screen.findByText('Nenhuma pendência resolvida')).toBeInTheDocument()
    await usuario.selectOptions(filtro, '')
    const resolvida = await screen.findByRole('link', { name: /Rejunte irregular/ })
    expect(resolvida).toHaveTextContent('Resolvida')
  })

  it('a rota antiga /pendencias redireciona para Registros com as abertas', async () => {
    renderizarApp('/pendencias')
    expect(await screen.findByRole('heading', { level: 1, name: 'Registros' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Abertas' })).toBeChecked()
    expect(await screen.findAllByRole('listitem')).toHaveLength(3)
  })

  it('pendência local (fila) aparece no topo de Abertas, sem link para o detalhe', async () => {
    const usuario = userEvent.setup()
    const base = criarRepositorioFixture()
    // Sem sinal: o registro novo fica na fila.
    renderizarApp('/obras/hto/ambientes/terreo-apto-101/novo', {
      ...base,
      enviarFoto: () => Promise.reject(new ErroEnvio('rede', MENSAGEM_REDE)),
    })
    await usuario.upload(await screen.findByLabelText('Escolher fotos da galeria'), [
      new File(['x'], 'a.jpg', { type: 'image/jpeg' }),
    ])
    await usuario.click(screen.getByRole('radio', { name: 'Pendência' }))
    await usuario.type(screen.getByLabelText('Legenda'), 'Janela sem trinco')
    const salvar = screen.getByRole('button', { name: 'Salvar registro' })
    await waitFor(() => expect(salvar).toBeEnabled())
    await usuario.click(salvar)
    await screen.findByText('Registro salvo no aparelho')

    const navegacao = await screen.findByRole('navigation', { name: 'Navegação principal' })
    await usuario.click(await within(navegacao).findByRole('link', { name: 'Registros' }))
    await usuario.click(await screen.findByRole('radio', { name: 'Abertas' }))
    const item = (await screen.findByText('Janela sem trinco')).closest('li')!
    expect(within(item).getByText('Salvo no aparelho · aguardando envio')).toBeInTheDocument()
    expect(within(item).queryByRole('link', { name: /pendencias\// })).not.toBeInTheDocument()
    // É o primeiro da lista.
    expect(screen.getAllByRole('listitem')[0]).toBe(item)
  })
})
