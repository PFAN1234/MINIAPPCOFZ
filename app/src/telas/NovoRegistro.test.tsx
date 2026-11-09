import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import App from '../App.tsx'
import { RepositorioProvider } from '../dados/contexto.tsx'
import { ErroEnvio } from '../dados/erros.ts'
import { criarRepositorioFixture } from '../dados/fixture.ts'
import type { Repositorio } from '../dados/repositorio.ts'

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

  it('sucesso volta ao Histórico com o registro novo e o aviso', async () => {
    const usuario = userEvent.setup()
    renderizar(criarRepositorioFixture())
    await preencher(usuario)
    const salvar = screen.getByRole('button', { name: 'Salvar registro' })
    await waitFor(() => expect(salvar).toBeEnabled())
    await usuario.click(salvar)

    expect(await screen.findByRole('tab', { name: 'Histórico', selected: true })).toBeInTheDocument()
    expect(await screen.findByText('Registro salvo')).toBeInTheDocument()
    expect(await screen.findByText('Tomada solta na parede')).toBeInTheDocument()
    expect(screen.getAllByText('Aguardando publicação').length).toBeGreaterThan(0)
    const item = screen.getByText('Tomada solta na parede').closest('li')!
    expect(within(item).getByRole('button', { name: 'Abrir 1 foto do registro' })).toBeInTheDocument()
    expect(within(item).getByText('Aguardando publicação')).toBeInTheDocument()
  })

  it('erro mostra "Tentar de novo" e reaproveita os mesmos ids', async () => {
    const usuario = userEvent.setup()
    const base = criarRepositorioFixture()
    const chamadas: string[] = []
    let falhar = true
    const repo: Repositorio = {
      ...base,
      enviarFoto: async (c, blob) => {
        chamadas.push(`${c.registroId}/${c.fotoId}`)
        if (falhar) throw new ErroEnvio('rede', 'Sem conexão com o servidor.')
        return base.enviarFoto(c, blob)
      },
      concluirRegistro: (d) => base.concluirRegistro(d),
    }
    renderizar(repo)
    await preencher(usuario)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar registro' })).toBeEnabled())
    await usuario.click(screen.getByRole('button', { name: 'Salvar registro' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Sem conexão com o servidor.')
    const tentar = screen.getByRole('button', { name: 'Tentar de novo' })
    falhar = false
    await usuario.click(tentar)
    expect(await screen.findByText('Registro salvo')).toBeInTheDocument()
    expect(chamadas).toHaveLength(2)
    expect(chamadas[0]).toBe(chamadas[1])
  })

  it('depois de enviar alguma foto, um erro trava os campos e só permite tentar de novo', async () => {
    const usuario = userEvent.setup()
    const base = criarRepositorioFixture()
    let falhar = true
    const repo: Repositorio = {
      ...base,
      // A resposta da RPC se perde depois de o registro já ter sido gravado.
      concluirRegistro: async (d) => {
        const r = await base.concluirRegistro(d)
        if (falhar) throw new ErroEnvio('rede', 'Sem conexão com o servidor.')
        return r
      },
    }
    renderizar(repo)
    await preencher(usuario)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar registro' })).toBeEnabled())
    await usuario.click(screen.getByRole('button', { name: 'Salvar registro' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Sem conexão com o servidor.')
    expect(screen.getByLabelText('Legenda')).toBeDisabled()
    expect(screen.getByRole('radio', { name: 'Serviço' })).toBeDisabled()
    expect(screen.getByText(/não pode mais ser alterado/)).toBeInTheDocument()

    falhar = false
    await usuario.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByText('Registro salvo')).toBeInTheDocument()
    expect(await screen.findAllByText('Tomada solta na parede')).toHaveLength(1)
  })

  it('pede confirmação ao sair com o formulário preenchido', async () => {
    const usuario = userEvent.setup()
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderizar(criarRepositorioFixture())
    // Vazio: sai sem perguntar.
    await screen.findByRole('heading', { name: 'Novo registro' })
    await usuario.type(screen.getByLabelText('Legenda'), 'rascunho')

    await usuario.click(screen.getByRole('button', { name: '← Voltar' }))
    expect(confirmar).toHaveBeenCalledWith('Descartar este registro?')
    expect(screen.getByRole('heading', { name: 'Novo registro' })).toBeInTheDocument()

    confirmar.mockReturnValue(true)
    await usuario.click(screen.getByRole('button', { name: '← Voltar' }))
    expect(await screen.findByRole('heading', { name: 'Obras' })).toBeInTheDocument()
  })

  it('formulário vazio sai sem confirmação', async () => {
    const usuario = userEvent.setup()
    const confirmar = vi.spyOn(window, 'confirm')
    renderizar(criarRepositorioFixture())
    await screen.findByRole('heading', { name: 'Novo registro' })
    await usuario.click(screen.getByRole('button', { name: '← Voltar' }))
    expect(confirmar).not.toHaveBeenCalled()
  })
})
