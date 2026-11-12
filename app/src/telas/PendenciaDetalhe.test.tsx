import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ErroEnvio, MENSAGEM_REDE } from '../dados/erros.ts'
import { criarRepositorioFixture } from '../dados/fixture.ts'
import type { Repositorio } from '../dados/repositorio.ts'
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

afterEach(() => vi.restoreAllMocks())

const ABERTA = '/obras/hto/pendencias/00000000-0000-4000-8000-000000000101'
const RESOLVIDA = '/obras/hto/pendencias/00000000-0000-4000-8000-000000000106'
const foto = (nome = 'a.jpg') => new File(['x'], nome, { type: 'image/jpeg' })

describe('Detalhe da pendência', () => {
  it('aberta, como gestor: mostra a pendência e o formulário; só habilita com foto', async () => {
    const usuario = userEvent.setup()
    renderizarApp(ABERTA)
    expect(await screen.findByRole('heading', { level: 1, name: 'Apto. 101' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'HTO · Térreo' })).toBeInTheDocument()
    expect(screen.getByText('Tomada da sala sem espelho; refazer o acabamento.')).toBeInTheDocument()
    expect(screen.getAllByText('Aberta').length).toBeGreaterThan(0)
    expect(screen.getByText(/Marcos Teixeira/)).toBeInTheDocument()
    // A primeira foto grande e a segunda em miniatura.
    expect(screen.getByRole('button', { name: /Abrir foto 1 de 2/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Abrir foto 2 de 2/ })).toBeInTheDocument()

    expect(screen.getByText('Comprovação da correção')).toBeInTheDocument()
    expect(screen.getByText('Acesso de gestor')).toBeInTheDocument()
    const encerrar = screen.getByRole('button', { name: 'Encerrar pendência' })
    expect(encerrar).toBeDisabled()
    const obs = screen.getByLabelText('Observação')
    expect(obs).toHaveAttribute('placeholder', 'Descreva a correção')
    expect(obs).toHaveAttribute('maxlength', '1000')
    await usuario.type(obs, 'Espelho trocado')
    expect(screen.getByText('15/1000')).toBeInTheDocument()
    expect(encerrar).toBeDisabled()
    await usuario.upload(screen.getByLabelText('Escolher fotos da galeria'), [foto()])
    await waitFor(() => expect(encerrar).toBeEnabled())
  })

  it('abrir uma foto original mostra o visualizador', async () => {
    const usuario = userEvent.setup()
    renderizarApp(ABERTA)
    await usuario.click(await screen.findByRole('button', { name: /Abrir foto 2 de 2/ }))
    expect(await screen.findByRole('dialog')).toHaveTextContent('Foto 2 de 2')
  })

  it('aberta, como equipe: sem formulário e com a nota', async () => {
    const base = criarRepositorioFixture()
    renderizarApp(ABERTA, {
      ...base,
      obterPendencia: async (id) => {
        const d = await base.obterPendencia(id)
        return d ? { ...d, papel: 'equipe' } : d
      },
    })
    expect(
      await screen.findByText('Só gestores da obra podem encerrar pendências.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Encerrar pendência' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Observação')).not.toBeInTheDocument()
  })

  it('resolvida: mostra a resolução, o gestor e a publicação, sem formulário', async () => {
    renderizarApp(RESOLVIDA)
    expect(await screen.findByRole('heading', { level: 3, name: 'Resolução' })).toBeInTheDocument()
    expect(screen.getByText('Rejunte refeito e piso limpo.')).toBeInTheDocument()
    expect(screen.getByText(/Encerrada por Juliana Prado/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Abrir foto 1 de 1: Fotos da comprovação/ })).toBeInTheDocument()
    expect(screen.getAllByText('Publicado no tópico')).toHaveLength(2)
    expect(screen.getAllByText('Resolvida').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Encerrar pendência' })).not.toBeInTheDocument()
  })

  it('pendência inexistente mostra o estado vazio', async () => {
    renderizarApp('/obras/hto/pendencias/00000000-0000-4000-8000-0000000009ff')
    expect(await screen.findByText('Pendência não encontrada')).toBeInTheDocument()
  })

  it('encerrar pede confirmação, volta para a lista com o aviso e depois aparece em Resolvidas', async () => {
    const usuario = userEvent.setup()
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    renderizarApp(ABERTA)
    await usuario.type(await screen.findByLabelText('Observação'), 'Espelho trocado')
    await usuario.upload(screen.getByLabelText('Escolher fotos da galeria'), [foto()])
    const encerrar = screen.getByRole('button', { name: 'Encerrar pendência' })
    await waitFor(() => expect(encerrar).toBeEnabled())

    await usuario.click(encerrar)
    expect(confirmar).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Encerrar pendência' })).toBeInTheDocument()

    await usuario.click(encerrar)
    expect(await screen.findByText('Encerramento salvo no aparelho')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Pendências' })).toBeInTheDocument()
    // O envio corre em segundo plano; depois dele, a pendência passa a Resolvidas.
    expect(await screen.findByRole('tab', { name: 'Resolvidas (2)' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Abertas (2)' })).toBeInTheDocument()
  })

  it('sem sinal: o detalhe mostra o encerramento no aparelho, sem formulário', async () => {
    const usuario = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const base = criarRepositorioFixture()
    const repo: Repositorio = {
      ...base,
      enviarFoto: () => Promise.reject(new ErroEnvio('rede', MENSAGEM_REDE)),
    }
    renderizarApp(ABERTA, repo)
    await usuario.upload(await screen.findByLabelText('Escolher fotos da galeria'), [foto()])
    const encerrar = screen.getByRole('button', { name: 'Encerrar pendência' })
    await waitFor(() => expect(encerrar).toBeEnabled())
    await usuario.click(encerrar)
    expect(await screen.findByText('Encerramento salvo no aparelho')).toBeInTheDocument()

    await usuario.click(await screen.findByRole('link', { name: /Tomada da sala/ }))
    expect(
      await screen.findByText('Encerramento salvo no aparelho · aguardando envio'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Encerrar pendência' })).not.toBeInTheDocument()
    expect(screen.getByText('1 item aguardando envio')).toBeInTheDocument()
  })

  it('conflito definitivo mostra "Esta pendência já foi encerrada." com Tentar de novo e Descartar', async () => {
    const usuario = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const base = criarRepositorioFixture()
    const repo: Repositorio = {
      ...base,
      encerrarPendencia: () =>
        Promise.reject(new ErroEnvio('conflito', 'Esta pendência já foi encerrada.')),
    }
    renderizarApp(ABERTA, repo)
    await usuario.upload(await screen.findByLabelText('Escolher fotos da galeria'), [foto()])
    const encerrar = screen.getByRole('button', { name: 'Encerrar pendência' })
    await waitFor(() => expect(encerrar).toBeEnabled())
    await usuario.click(encerrar)
    await screen.findByText('Encerramento salvo no aparelho')

    await usuario.click(await screen.findByRole('link', { name: /Tomada da sala/ }))
    const estado = await screen.findByText(/Não foi possível enviar: Esta pendência já foi encerrada\./)
    const secao = estado.closest('section')!
    expect(within(secao).getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument()
    await usuario.click(within(secao).getByRole('button', { name: 'Descartar' }))
    expect(await screen.findByRole('button', { name: 'Encerrar pendência' })).toBeInTheDocument()
  })
})
