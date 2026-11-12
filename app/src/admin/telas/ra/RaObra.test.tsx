import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AdminApp from '../../AdminApp.tsx'
import { RepositorioAdminProvider } from '../../dados/contexto.tsx'
import { criarRepositorioAdminFixture } from '../../dados/fixture.ts'
import { criarEntrada } from '../../entrada.ts'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

function renderizar(rota = '/obras/hto/ra') {
  const repo = criarRepositorioAdminFixture()
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

async function abrir(user: ReturnType<typeof userEvent.setup>, nome: string) {
  await user.click(await screen.findByRole('button', { name: `Abrir ${nome}` }))
  return screen.findByRole('heading', { name: new RegExp(`${nome}.*Térreo`) })
}

describe('realidade aumentada (fixture)', () => {
  it('a página da obra tem o link para a página de RA', async () => {
    const user = userEvent.setup()
    renderizar('/obras/hto')
    await user.click(await screen.findByRole('link', { name: 'Realidade aumentada' }))
    expect(await screen.findByRole('heading', { name: 'Realidade aumentada · HTO' })).toBeInTheDocument()
  })

  it('lista os ambientes por pavimento, dizendo quais têm QR', async () => {
    renderizar()
    const terreo = await screen.findByRole('region', { name: 'Térreo' })
    expect(within(within(terreo).getByTestId('ra-terreo-administracao')).getByText('Com QR')).toBeInTheDocument()
    expect(within(within(terreo).getByTestId('ra-terreo-alojamento')).getByText('Sem QR')).toBeInTheDocument()
  })

  it('obra sem geometria mostra o estado vazio', async () => {
    renderizar('/obras/cofz/ra')
    expect(await screen.findByText(/Esta obra ainda não tem a geometria dos ambientes\. Rode scripts\/gerar_geometria\.py/)).toBeInTheDocument()
  })

  it('desenha as paredes com comprimentos e o QR; o formulário move a marca', async () => {
    const user = userEvent.setup()
    renderizar()
    await abrir(user, 'Administração')
    const paredes = within(screen.getByRole('table', { name: 'Paredes' }))
    expect(paredes.getAllByRole('row')).toHaveLength(5)
    expect(paredes.getAllByText('6,03 m')).toHaveLength(2)
    expect(paredes.getAllByText('3,96 m')).toHaveLength(2)
    const marca = screen.getByTestId('ra-marca').querySelector('circle')!
    expect(Number(marca.getAttribute('cx'))).toBeCloseTo(2.5)
    await user.clear(screen.getByLabelText(/Distância a partir do canto/))
    await user.type(screen.getByLabelText(/Distância a partir do canto/), '4')
    expect(Number(screen.getByTestId('ra-marca').querySelector('circle')!.getAttribute('cx'))).toBeCloseTo(4)
    await user.selectOptions(screen.getByLabelText('Parede'), '1')
    expect(screen.getByLabelText(/Distância a partir do canto 2/)).toBeInTheDocument()
  })

  it('valida distância, altura e lado como o banco e bloqueia Salvar', async () => {
    const user = userEvent.setup()
    const repo = renderizar()
    const definir = vi.spyOn(repo, 'definirQr')
    await abrir(user, 'Administração')
    const distancia = screen.getByLabelText(/Distância a partir do canto/)
    await user.clear(distancia)
    await user.type(distancia, '7')
    expect(screen.getByRole('alert')).toHaveTextContent('A distância precisa estar entre 0 e 6,03 m')
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled()
    await user.clear(distancia)
    await user.type(distancia, '1')
    const altura = screen.getByLabelText(/Altura do centro/)
    await user.clear(altura)
    await user.type(altura, '5,5')
    expect(screen.getByRole('alert')).toHaveTextContent('A altura precisa estar entre 0 e 5 m')
    await user.clear(altura)
    await user.type(altura, '1,5')
    const lado = screen.getByLabelText(/Lado do QR/)
    await user.clear(lado)
    await user.type(lado, '4')
    expect(screen.getByRole('alert')).toHaveTextContent('entre 5 e 100 cm')
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled()
    expect(definir).not.toHaveBeenCalled()
  })

  it('salva em metros (lado em cm na tela) e depois permite imprimir a folha', async () => {
    const user = userEvent.setup()
    const repo = renderizar()
    const definir = vi.spyOn(repo, 'definirQr')
    const imprimir = vi.fn()
    vi.stubGlobal('print', imprimir)
    vi.stubEnv('VITE_TELEGRAM_BOT', '@bot_teste')
    await abrir(user, 'Alojamento')
    expect(screen.queryByRole('button', { name: 'Remover QR' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Imprimir' })).toBeDisabled()
    expect(screen.getByLabelText(/Altura do centro/)).toHaveValue('1,50')
    expect(screen.getByLabelText(/Lado do QR/)).toHaveValue('18')

    await user.selectOptions(screen.getByLabelText('Parede'), '1')
    const distancia = screen.getByLabelText(/Distância a partir do canto/)
    await user.clear(distancia)
    await user.type(distancia, '1,25')
    const lado = screen.getByLabelText(/Lado do QR/)
    await user.clear(lado)
    await user.type(lado, '15')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(await screen.findByText('QR salvo.')).toBeInTheDocument()
    expect(definir).toHaveBeenCalledWith('terreo-alojamento', { parede: 1, distancia_m: 1.25, altura_m: 1.5, lado_m: 0.15 })

    const folha = await screen.findByTestId('ra-folha')
    expect(folha).toHaveTextContent('HTO')
    expect(folha).toHaveTextContent('Térreo')
    expect(folha).toHaveTextContent('Alojamento')
    expect(folha).toHaveTextContent('Fixar na parede 2, a 1,25 m do canto 2, com o centro a 1,50 m do piso. Bordas no prumo.')
    expect(folha).toHaveTextContent('Imprimir em 100% (sem ajustar à página)')
    const svg = within(folha).getByTestId('ra-qr-svg')
    expect(svg.getAttribute('width')).toBe('150mm')
    expect(svg.getAttribute('height')).toBe('150mm')
    expect(within(folha).getByLabelText('Régua de 10 cm').getAttribute('width')).toBe('100mm')
    expect(folha).toHaveTextContent('https://t.me/bot_teste/fiscalcofz?startapp=amb_hto_terreo-alojamento')

    await user.click(screen.getByRole('button', { name: 'Imprimir' }))
    expect(imprimir).toHaveBeenCalledOnce()
  })

  it('remover pede confirmação e apaga o QR', async () => {
    const user = userEvent.setup()
    const repo = renderizar()
    const remover = vi.spyOn(repo, 'removerQr')
    await abrir(user, 'Administração')
    await user.click(screen.getByRole('button', { name: 'Remover QR' }))
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(remover).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Remover QR' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar remoção' }))
    expect(remover).toHaveBeenCalledWith('terreo-administracao')
    expect(await screen.findByText('QR removido.')).toBeInTheDocument()
    expect(screen.queryByTestId('ra-folha')).not.toBeInTheDocument()
    expect((await repo.listarRA('obra-hto')).find((a) => a.codigo === 'terreo-administracao')?.qr).toBeNull()
  })
})
