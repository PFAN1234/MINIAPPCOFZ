import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import AdminApp from '../AdminApp.tsx'
import { RepositorioAdminProvider } from '../dados/contexto.tsx'
import { criarRepositorioAdminFixture } from '../dados/fixture.ts'
import type { RepositorioAdmin } from '../dados/repositorio.ts'
import { CAMINHO_LOGO } from '../dados/tipos.ts'
import { criarEntrada } from '../entrada.ts'

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

// PNG 1×1 transparente.
const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='),
  (c) => c.charCodeAt(0),
)
const logo = (nome = 'logo.png', tipo = 'image/png', bytes: BlobPart = PNG) => new File([bytes], nome, { type: tipo })

describe('organização (fixture)', () => {
  it('a barra do topo mostra o nome da OM e "Fiscal Bot · Administração"', async () => {
    renderizar('/')
    const barra = await screen.findByRole('banner')
    expect(await within(barra).findByText('CO-FZ')).toBeInTheDocument()
    expect(within(barra).getByText('Fiscal Bot · Administração')).toBeInTheDocument()
    expect(within(barra).queryByRole('img')).not.toBeInTheDocument()
    const nav = within(barra).getByRole('navigation', { name: 'Principal' })
    expect(within(nav).getAllByRole('link').map((l) => l.textContent)).toEqual(['Etapas', 'Organização', 'Admins'])
  })

  it('troca o nome, envia o logo com pré-visualização e ele aparece na barra', async () => {
    const user = userEvent.setup()
    const repo = criarRepositorioAdminFixture()
    const enviar = vi.spyOn(repo, 'enviarLogo')
    renderizar('/organizacao', repo)
    const nome = await screen.findByLabelText('Nome da OM')
    expect(nome).toHaveValue('CO-FZ')
    expect(nome).toHaveAttribute('maxLength', '80')
    expect(screen.getByText('Sem logo')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salvar organização' })).toBeDisabled()

    await user.clear(nome)
    await user.type(nome, 'CO-FZ 10ª RM')
    await user.upload(screen.getByLabelText('Enviar logo…'), logo())
    const previa = await screen.findByRole('img', { name: 'Pré-visualização do logo novo' })
    expect(previa.getAttribute('src')).toMatch(/^data:image\/png;base64,/)
    expect(screen.getByText(/Logo novo: logo\.png/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Salvar organização' }))

    expect(await screen.findByText('Organização salva.')).toBeInTheDocument()
    expect(enviar).toHaveBeenCalledTimes(1)
    const org = await repo.obterOrganizacao()
    expect(org.nome).toBe('CO-FZ 10ª RM')
    expect(org.logo_path).toMatch(CAMINHO_LOGO)
    expect(await screen.findByRole('img', { name: 'Logo atual da OM' })).toBeInTheDocument()
    const barra = screen.getByRole('banner')
    expect(within(barra).getByRole('img', { name: 'Logo da CO-FZ 10ª RM' })).toBeInTheDocument()
    expect(within(barra).getByTestId('identidade-om')).toHaveTextContent('CO-FZ 10ª RM')
  })

  it('recusa no cliente arquivo de outro tipo ou maior que 1 MB', async () => {
    const user = userEvent.setup({ applyAccept: false })
    const repo = criarRepositorioAdminFixture()
    const enviar = vi.spyOn(repo, 'enviarLogo')
    renderizar('/organizacao', repo)
    const campo = await screen.findByLabelText('Enviar logo…')
    await user.upload(campo, logo('logo.gif', 'image/gif'))
    expect(await screen.findByRole('alert')).toHaveTextContent('O logo precisa ser PNG, JPEG ou WebP.')
    await user.upload(campo, logo('grande.png', 'image/png', new Uint8Array(1024 * 1024 + 1)))
    expect(await screen.findByRole('alert')).toHaveTextContent('O logo pode ter no máximo 1 MB.')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(enviar).not.toHaveBeenCalled()
  })

  it('remove o logo', async () => {
    const user = userEvent.setup()
    const repo = criarRepositorioAdminFixture()
    await repo.salvarOrganizacao({ nome: 'CO-FZ', logo_path: await repo.enviarLogo(logo()) })
    renderizar('/organizacao', repo)
    expect(await screen.findByRole('img', { name: 'Logo atual da OM' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remover logo' }))
    expect(screen.getByText('O logo será removido ao salvar.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Salvar organização' }))
    expect(await screen.findByText('Organização salva.')).toBeInTheDocument()
    expect(screen.getByText('Sem logo')).toBeInTheDocument()
    expect((await repo.obterOrganizacao()).logo_path).toBeNull()
    expect(within(screen.getByRole('banner')).queryByRole('img')).not.toBeInTheDocument()
  })

  it('falha ao carregar a organização não impede o uso do site', async () => {
    const repo: RepositorioAdmin = {
      ...criarRepositorioAdminFixture(),
      obterOrganizacao: () => Promise.reject(new Error('sem rede')),
    }
    renderizar('/', repo)
    expect(await screen.findByRole('heading', { level: 1, name: 'Etapas' })).toBeInTheDocument()
    const marca = within(screen.getByRole('banner')).getByTestId('identidade-om')
    expect(marca).toHaveTextContent('Fiscal Bot · Administração')
    expect(marca).not.toHaveTextContent('CO-FZ')
  })

  it('o repositório recusa nome longo e logo que não foi enviado', async () => {
    const repo = criarRepositorioAdminFixture()
    await expect(repo.salvarOrganizacao({ nome: 'x'.repeat(81), logo_path: null })).rejects.toThrow('até 80 caracteres')
    await expect(repo.salvarOrganizacao({ nome: 'CO-FZ', logo_path: 'logo-0123456789abcdef.png' })).rejects.toThrow(
      'envie o arquivo antes',
    )
  })
})
