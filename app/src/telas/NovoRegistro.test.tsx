import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import App from '../App.tsx'
import { RepositorioProvider } from '../dados/contexto.tsx'
import { ErroEnvio, MENSAGEM_REDE } from '../dados/erros.ts'
import { criarRepositorioFixture } from '../dados/fixture.ts'
import type { Repositorio } from '../dados/repositorio.ts'
import { MENSAGEM_COTA } from '../offline/armazenamento.ts'

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

const AMBIENTE = '/obras/hto/ambientes/terreo-apto-101'
const FORM = `${AMBIENTE}/novo`

beforeAll(() => {
  let n = 0
  URL.createObjectURL = () => `blob:teste/${++n}`
  URL.revokeObjectURL = () => {}
})

afterEach(() => vi.restoreAllMocks())

function renderizar(repo: Repositorio, entradas = [AMBIENTE, FORM]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <RepositorioProvider repositorio={repo}>
        <MemoryRouter initialEntries={entradas} initialIndex={entradas.length - 1}>
          <App />
        </MemoryRouter>
      </RepositorioProvider>
    </QueryClientProvider>,
  )
}

const foto = (nome = 'a.jpg') => new File(['x'], nome, { type: 'image/jpeg' })

async function preencher(usuario: ReturnType<typeof userEvent.setup>, fotos = [foto()]) {
  await usuario.upload(await screen.findByLabelText('Escolher fotos da galeria'), fotos)
  await usuario.click(screen.getByRole('radio', { name: 'Pendência' }))
  await usuario.type(screen.getByLabelText('Legenda'), 'Tomada solta na parede')
}

describe('Novo registro', () => {
  it('o botão fica desabilitado até o formulário ser válido', async () => {
    const usuario = userEvent.setup()
    renderizar(criarRepositorioFixture())
    const salvar = await screen.findByRole('button', { name: 'Salvar registro' })
    expect(salvar).toBeDisabled()
    expect(screen.getByRole('radio', { name: 'Serviço' })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: 'Pendência' })).not.toBeChecked()

    await usuario.upload(screen.getByLabelText('Escolher fotos da galeria'), [foto(), foto('b.jpg')])
    expect(await screen.findAllByRole('listitem')).toHaveLength(2)
    expect(salvar).toBeDisabled()
    await usuario.click(screen.getByRole('radio', { name: 'Serviço' }))
    expect(salvar).toBeDisabled()
    await usuario.type(screen.getByLabelText('Legenda'), '   ')
    expect(salvar).toBeDisabled()
    await usuario.type(screen.getByLabelText('Legenda'), 'Contrapiso')
    await waitFor(() => expect(salvar).toBeEnabled())
    expect(screen.getByText('13/1000')).toBeInTheDocument()

    await usuario.click(screen.getByRole('button', { name: 'Remover foto 1' }))
    await usuario.click(screen.getByRole('button', { name: 'Remover foto 1' }))
    expect(salvar).toBeDisabled()
  })

  it('salvar volta ao Histórico com o item local e o aviso, e depois o envio conclui', async () => {
    const usuario = userEvent.setup()
    const base = criarRepositorioFixture()
    let liberar!: () => void
    const portao = new Promise<void>((r) => (liberar = r))
    const repo: Repositorio = {
      ...base,
      enviarFoto: async (c, blob) => {
        await portao
        return base.enviarFoto(c, blob)
      },
      concluirRegistro: (d) => base.concluirRegistro(d),
    }
    renderizar(repo)
    await preencher(usuario)
    const salvar = screen.getByRole('button', { name: 'Salvar registro' })
    await waitFor(() => expect(salvar).toBeEnabled())
    await usuario.click(salvar)

    expect(await screen.findByRole('tab', { name: 'Histórico', selected: true })).toBeInTheDocument()
    expect(await screen.findByText('Registro salvo no aparelho')).toBeInTheDocument()
    const item = (await screen.findByText('Tomada solta na parede')).closest('li')!
    expect(within(item).getByText('Pendência aberta')).toBeInTheDocument()
    expect(within(item).getByText('Você')).toBeInTheDocument()
    expect(within(item).getByText('Enviando fotos 1 de 1…')).toBeInTheDocument()
    expect(within(item).getByRole('button', { name: 'Abrir 1 foto do registro' })).toBeInTheDocument()

    liberar()
    await waitFor(() =>
      expect(
        within(screen.getByText('Tomada solta na parede').closest('li')!).getByText(
          'Salvo no servidor · aguardando publicação',
        ),
      ).toBeInTheDocument(),
    )
    expect(screen.getAllByText('Tomada solta na parede')).toHaveLength(1)
    await waitFor(() =>
      expect(screen.queryByText(/registros? aguardando envio/)).not.toBeInTheDocument(),
    )
  })

  it('falha de rede deixa o item no aparelho e "Enviar" envia depois', async () => {
    const usuario = userEvent.setup()
    const base = criarRepositorioFixture()
    let falhar = true
    const repo: Repositorio = {
      ...base,
      enviarFoto: async (c, blob) => {
        if (falhar) throw new ErroEnvio('rede', MENSAGEM_REDE)
        return base.enviarFoto(c, blob)
      },
      concluirRegistro: (d) => base.concluirRegistro(d),
    }
    renderizar(repo)
    await preencher(usuario)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar registro' })).toBeEnabled())
    await usuario.click(screen.getByRole('button', { name: 'Salvar registro' }))

    expect(await screen.findByText('Salvo no aparelho · aguardando envio')).toBeInTheDocument()
    expect(screen.getByText('1 registro aguardando envio')).toBeInTheDocument()
    const tentar = await screen.findByRole('button', { name: 'Enviar' })

    falhar = false
    await usuario.click(tentar)
    expect(
      await screen.findByText('Salvo no servidor · aguardando publicação'),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByText('1 registro aguardando envio')).not.toBeInTheDocument(),
    )
    expect(screen.getAllByText('Tomada solta na parede')).toHaveLength(1)
  })

  it('falha definitiva mostra o erro com "Tentar de novo" e "Descartar"', async () => {
    const usuario = userEvent.setup()
    const base = criarRepositorioFixture()
    let falhar = true
    const repo: Repositorio = {
      ...base,
      enviarFoto: async (c, blob) => {
        if (falhar) throw new ErroEnvio('validacao', 'Legenda inválida.')
        return base.enviarFoto(c, blob)
      },
      concluirRegistro: (d) => base.concluirRegistro(d),
    }
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderizar(repo)
    await preencher(usuario)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar registro' })).toBeEnabled())
    await usuario.click(screen.getByRole('button', { name: 'Salvar registro' }))

    expect(await screen.findByText('Não foi possível enviar: Legenda inválida.')).toBeInTheDocument()
    expect(screen.getByText('1 registro com erro no envio')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver' })).toHaveAttribute('href', '/registros')

    // Descartar pede confirmação; ao recusar, o item continua.
    await usuario.click(screen.getByRole('button', { name: 'Descartar' }))
    expect(confirmar).toHaveBeenCalledWith('Descartar este registro? Ele ainda não foi enviado.')
    expect(screen.getByText('Tomada solta na parede')).toBeInTheDocument()

    falhar = false
    await usuario.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(
      await screen.findByText('Salvo no servidor · aguardando publicação'),
    ).toBeInTheDocument()
  })

  it('descartar com confirmação remove o item', async () => {
    const usuario = userEvent.setup()
    const base = criarRepositorioFixture()
    const repo: Repositorio = {
      ...base,
      enviarFoto: async () => {
        throw new ErroEnvio('conflito', 'Conflito no servidor.')
      },
    }
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderizar(repo)
    await preencher(usuario)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar registro' })).toBeEnabled())
    await usuario.click(screen.getByRole('button', { name: 'Salvar registro' }))
    await usuario.click(await screen.findByRole('button', { name: 'Descartar' }))
    await waitFor(() =>
      expect(screen.queryByText('Tomada solta na parede')).not.toBeInTheDocument(),
    )
  })

  describe('sem espaço no aparelho', () => {
    afterEach(() => {
      // @ts-expect-error remove a simulação
      delete navigator.storage
    })

    it('mostra o alerta e mantém o formulário preenchido', async () => {
      const usuario = userEvent.setup()
      Object.defineProperty(navigator, 'storage', {
        configurable: true,
        value: { estimate: async () => ({ quota: 1_000_000, usage: 999_000 }) },
      })
      renderizar(criarRepositorioFixture())
      await preencher(usuario)
      await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar registro' })).toBeEnabled())
      await usuario.click(screen.getByRole('button', { name: 'Salvar registro' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(MENSAGEM_COTA)
      expect(screen.getByLabelText('Legenda')).toHaveValue('Tomada solta na parede')
      expect(screen.getByRole('radio', { name: 'Pendência' })).toBeChecked()
      expect(screen.getByRole('button', { name: 'Salvar registro' })).toBeEnabled()
    })
  })

  it('pede confirmação ao sair com o formulário preenchido', async () => {
    const usuario = userEvent.setup()
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderizar(criarRepositorioFixture())
    // Vazio: sai sem perguntar. (O título já aparece enquanto o ambiente carrega; espera o formulário.)
    await screen.findByLabelText('Legenda')
    await usuario.type(screen.getByLabelText('Legenda'), 'rascunho')

    await usuario.click(screen.getByRole('button', { name: 'Voltar' }))
    expect(confirmar).toHaveBeenCalledWith('Descartar este registro?')
    expect(screen.getByRole('heading', { name: 'Novo registro' })).toBeInTheDocument()

    confirmar.mockReturnValue(true)
    await usuario.click(screen.getByRole('button', { name: 'Voltar' }))
    expect(await screen.findByRole('heading', { name: 'Obras' })).toBeInTheDocument()
  })

  it('formulário vazio sai sem confirmação', async () => {
    const usuario = userEvent.setup()
    const confirmar = vi.spyOn(window, 'confirm')
    renderizar(criarRepositorioFixture())
    // O título já aparece enquanto o ambiente carrega; o formulário vem depois.
    await screen.findByLabelText('Legenda')
    await usuario.click(screen.getByRole('button', { name: 'Voltar' }))
    expect(confirmar).not.toHaveBeenCalled()
  })
})
