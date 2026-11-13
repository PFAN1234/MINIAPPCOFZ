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
    expect(within(nav).getAllByRole('link').map((l) => l.textContent)).toEqual(['Etapas', 'Relatórios', 'Pessoas', 'Organização', 'Admins'])
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

describe('linhas do cabeçalho do boletim (fixture)', () => {
  it('mostra as linhas do exemplo e a prévia com logo, linhas e nome', async () => {
    const repo = criarRepositorioAdminFixture()
    await repo.salvarOrganizacao({ nome: 'CO-FZ', logo_path: await repo.enviarLogo(logo()) })
    renderizar('/organizacao', repo)
    expect(await screen.findByLabelText('Linha 1 do cabeçalho')).toHaveValue('COMANDO DA AERONÁUTICA')
    expect(screen.getByLabelText('Linha 3 do cabeçalho')).toHaveValue('COMISSÃO DE OBRAS DE FORTALEZA (CO-FZ)')
    const previa = screen.getByRole('group', { name: 'Prévia do cabeçalho do boletim' })
    expect(within(previa).getAllByText(/./).map((e) => e.textContent)).toEqual([
      'COMANDO DA AERONÁUTICA',
      'DIRETORIA DE INFRAESTRUTURA DA AERONÁUTICA',
      'COMISSÃO DE OBRAS DE FORTALEZA (CO-FZ)',
      'CO-FZ',
    ])
    expect(previa.querySelector('img')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Salvar organização' })).toBeDisabled()
  })

  it('adiciona (até 4), reordena, remove e salva; a prévia acompanha e linha vazia é descartada', async () => {
    const user = userEvent.setup()
    const repo = criarRepositorioAdminFixture()
    const salvar = vi.spyOn(repo, 'salvarOrganizacao')
    renderizar('/organizacao', repo)
    await screen.findByLabelText('Linha 1 do cabeçalho')
    const adicionar = screen.getByRole('button', { name: 'Adicionar linha' })
    await user.click(adicionar)
    expect(adicionar).toBeDisabled()
    expect(screen.getByLabelText('Linha 4 do cabeçalho')).toHaveValue('')
    await user.click(screen.getByRole('button', { name: 'Subir linha 3' }))
    expect(screen.getByLabelText('Linha 2 do cabeçalho')).toHaveValue('COMISSÃO DE OBRAS DE FORTALEZA (CO-FZ)')
    expect(screen.getByRole('button', { name: 'Subir linha 1' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Descer linha 4' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Remover linha 1' }))
    expect(screen.getByRole('button', { name: 'Adicionar linha' })).toBeEnabled()
    await user.type(screen.getByLabelText('Linha 3 do cabeçalho'), 'Seção nova')
    await user.click(screen.getByRole('button', { name: 'Salvar organização' }))
    expect(await screen.findByText('Organização salva.')).toBeInTheDocument()
    expect(salvar).toHaveBeenCalledWith({
      nome: 'CO-FZ',
      logo_path: null,
      cabecalho: ['COMISSÃO DE OBRAS DE FORTALEZA (CO-FZ)', 'DIRETORIA DE INFRAESTRUTURA DA AERONÁUTICA', 'Seção nova'],
    })
    expect((await repo.obterOrganizacao()).cabecalho).toHaveLength(3)
  })

  it('remover todas as linhas limpa o cabeçalho', async () => {
    const user = userEvent.setup()
    const repo = criarRepositorioAdminFixture()
    renderizar('/organizacao', repo)
    for (let i = 0; i < 3; i++) await user.click(await screen.findByRole('button', { name: 'Remover linha 1' }))
    expect(screen.queryByLabelText('Linha 1 do cabeçalho')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Salvar organização' }))
    expect(await screen.findByText('Organização salva.')).toBeInTheDocument()
    expect((await repo.obterOrganizacao()).cabecalho).toEqual([])
  })
})
