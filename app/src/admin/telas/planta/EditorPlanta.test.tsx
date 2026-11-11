import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import ambientesCofz from '../../../../../data/cofz/ambientes.json'
import AdminApp from '../../AdminApp.tsx'
import { RepositorioAdminProvider } from '../../dados/contexto.tsx'
import { criarRepositorioAdminFixture } from '../../dados/fixture.ts'
import { criarEntrada } from '../../entrada.ts'
import { criarServicoFalso, spansDosAmbientes } from './servicoFalso.ts'
import { ServicoPdfProvider } from './servicoPdf.tsx'

const W = 2908.320068359375
const H = 1683.719970703125

function renderizar(rota: string) {
  const repo = criarRepositorioAdminFixture()
  const servico = criarServicoFalso(spansDosAmbientes(ambientesCofz.ambientes, W, H), W, H)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <RepositorioAdminProvider repositorio={repo}>
        <ServicoPdfProvider servico={servico}>
          <MemoryRouter initialEntries={[rota]}>
            <AdminApp entrada={criarEntrada(null)} />
          </MemoryRouter>
        </ServicoPdfProvider>
      </RepositorioAdminProvider>
    </QueryClientProvider>,
  )
  return repo
}

function pdf(nome = 'CE01-01PE02-ARQ-DE009-R06.pdf') {
  return new File([new TextEncoder().encode('%PDF-1.6\n%falso\n')], nome, { type: 'application/pdf' })
}

async function abrirAmbientes(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(await screen.findByLabelText(/PDF da planta de arquitetura/), pdf())
  expect(await screen.findByText(/1 página\(s\)/)).toBeInTheDocument()
  expect(screen.getByLabelText(/^Revisão/)).toHaveValue('R06')
  await user.click(screen.getByRole('button', { name: 'Ler a página' }))
  expect(await screen.findByRole('heading', { name: 'Recorte e máscaras' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Continuar' }))
  expect(await screen.findByRole('heading', { name: 'Ambientes' })).toBeInTheDocument()
}

describe('editor de planta (fixture)', () => {
  it('página da obra leva aos pavimentos e mostra o histórico vazio', async () => {
    const user = userEvent.setup()
    renderizar('/obras/cofz')
    expect(await screen.findByRole('heading', { name: 'Planta (PDF)' })).toBeInTheDocument()
    expect(await screen.findByText(/Nenhuma publicação pelo site ainda/)).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Planta de Térreo' }))
    expect(await screen.findByRole('heading', { name: /Planta · COFZ · Térreo/ })).toBeInTheDocument()
  })

  it('revisão do arquivo diferente da informada bloqueia a leitura', async () => {
    const user = userEvent.setup()
    renderizar('/obras/cofz/planta/terreo')
    await user.upload(await screen.findByLabelText(/PDF da planta de arquitetura/), pdf())
    const revisao = await screen.findByLabelText(/^Revisão/)
    await user.clear(revisao)
    await user.type(revisao, 'R07')
    expect(screen.getByRole('alert')).toHaveTextContent('é da revisão R06, mas você informou R07')
    expect(screen.getByRole('button', { name: 'Ler a página' })).toBeDisabled()
  })

  it('arquivo que não é PDF dá erro claro', async () => {
    const user = userEvent.setup({ applyAccept: false })
    renderizar('/obras/cofz/planta/terreo')
    await user.upload(await screen.findByLabelText(/PDF da planta de arquitetura/), new File(['oi'], 'x.pdf'))
    expect(await screen.findByRole('alert')).toHaveTextContent('não é um PDF')
  })

  it('ambientes da COFZ, recorte inválido, renomear sem trocar o código, publicar e marcar revisado', async () => {
    const user = userEvent.setup()
    const repo = renderizar('/obras/cofz/planta/terreo')
    await user.upload(await screen.findByLabelText(/PDF da planta de arquitetura/), pdf())
    await user.click(await screen.findByRole('button', { name: 'Ler a página' }))

    // Recorte invertido bloqueia; voltar ao valor libera.
    const x1 = await screen.findByLabelText('Recorte do edifício x1')
    expect(x1).toHaveValue(0.89)
    await user.clear(x1)
    await user.type(x1, '0.01')
    expect(await screen.findByText(/retângulo normalizado inválido/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled()
    await user.clear(x1)
    await user.type(x1, '0.89')
    await user.click(screen.getByRole('button', { name: 'Continuar' }))

    // 19 ambientes (17 rotulados + 2 manuais), com os casos para revisar.
    expect(await screen.findByRole('heading', { name: 'Ambientes' })).toBeInTheDocument()
    expect(screen.getAllByRole('row', { name: /terreo-/ })).toHaveLength(19)
    expect(screen.getByText('3 caso(s) para conferir')).toBeInTheDocument()
    expect(within(screen.getByTestId('linha-terreo-circulacao-1')).getByText('revisar')).toBeInTheDocument()

    const nome = screen.getByLabelText('Nome operacional de Copa')
    await user.clear(nome)
    await user.type(nome, 'Copa dos funcionários{Enter}')
    // O código publicado continua (manter_codigo).
    expect(await screen.findByLabelText('Nome operacional de Copa dos funcionários')).toBeInTheDocument()
    expect(within(screen.getByTestId('linha-terreo-copa')).getByText('terreo-copa')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Categoria de Sala DA'), 'servico')

    await user.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(await screen.findByRole('heading', { name: 'Nova revisão' })).toBeInTheDocument()
    expect(screen.getByText('Copa → Copa dos funcionários')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /Removidos/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(await screen.findByRole('img', { name: /Prova/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Publicar' }))
    expect(await screen.findByText(/Publicado: Térreo, revisão R06, 19 ambiente\(s\)/)).toBeInTheDocument()

    const pubs = await repo.listarPublicacoes('cofz')
    expect(pubs).toHaveLength(1)
    expect(pubs[0]).toMatchObject({ pavimento: 'terreo', revisao: 'R06', pdf_nome: 'CE01-01PE02-ARQ-DE009-R06.pdf' })
    const ed = await repo.obterEditorPlanta('cofz')
    const copa = ed.ambientes.find((a) => a.codigo === 'terreo-copa')!
    expect(copa).toMatchObject({ nome_operacional: 'Copa dos funcionários', ativo: true })
    expect(ed.ambientes.find((a) => a.codigo === 'terreo-sala-da')?.categoria).toBe('servico')
    expect(ed.config?.manter_codigo).toEqual({ 'terreo-copa-dos-funcionarios': 'terreo-copa' })
    expect(ed.config?.categorias?.DA).toBe('servico')
    expect(ed.config?.status).toBe('aguardando_revisao_humana')
    expect(ed.pavimentos[0].ultimo_pdf?.revisao).toBe('R06')

    await user.click(screen.getByRole('button', { name: 'Marcar como revisado' }))
    expect(await screen.findByText('Marcada como revisada.')).toBeInTheDocument()
    await waitFor(async () => expect((await repo.obterObra('cofz')).config?.status).toBe('revisado'))
  })

  it('incluir ambiente sem rótulo e confirmar sucessor de um removido', async () => {
    const user = userEvent.setup()
    renderizar('/obras/cofz/planta/terreo')
    await abrirAmbientes(user)
    // Renomeia um ambiente manual (não existe no banco com outro código) e inclui um novo.
    await user.click(screen.getByRole('button', { name: 'Incluir ambiente sem rótulo' }))
    // No jsdom o SVG não tem tamanho: o clique cai no canto da planta, o que basta aqui.
    const svg = screen.getByLabelText('Pinos dos ambientes')
    svg.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 1, clientY: 1 }))
    await user.type(await screen.findByLabelText('Nome do ambiente'), 'Depósito novo')
    await user.click(screen.getByRole('button', { name: 'Incluir' }))
    expect(await screen.findByLabelText('Nome operacional de Depósito novo')).toBeInTheDocument()

    // Remover o manual "Sala de apoio" e incluir de novo com outro nome: vira removido + novo.
    const linha = screen.getByTestId('linha-terreo-sala-de-apoio')
    await user.click(within(linha).getByRole('button', { name: 'Remover ambiente' }))
    await user.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(await screen.findByRole('heading', { name: 'Removidos (1)' })).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Ambiente novo que substitui Sala de apoio'), 'terreo-deposito-novo')
    await user.click(screen.getByRole('button', { name: 'Confirmar: é o mesmo ambiente' }))
    expect(await screen.findByRole('heading', { name: /Mesmo ambiente, código mantido \(1\)/ })).toBeInTheDocument()
    expect(screen.getByText(/Sala de apoio → Depósito novo/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Desfazer' }))
    expect(await screen.findByRole('heading', { name: 'Removidos (1)' })).toBeInTheDocument()
  })
})
