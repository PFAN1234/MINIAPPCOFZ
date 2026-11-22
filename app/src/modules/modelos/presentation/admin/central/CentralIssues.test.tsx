import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RepositorioAdminProvider } from '../../../../../admin/dados/contexto.tsx'
import { criarRepositorioAdminFixture } from '../../../../../admin/dados/fixture.ts'
import { MotorVisualizadorFalso } from '../../../infra/MotorVisualizadorFalso.ts'
import { temWebGL } from '../../../infra/modelosLocais.ts'
import type { ModeloFrag } from '../../../domain/modelos.ts'
import { unzipSync } from 'fflate'
import { BCF21, zipDe } from '../../../../issues/infra/bcf/__fixtures__/pacotes.ts'
import { lerBcf } from '../../../../issues/infra/bcf/bcfZip.ts'
import CentralObra from './CentralObra.tsx'
import { PreviaPdfProvider } from '../../../../documentos/presentation/admin/previaPdf.tsx'
import { FabricaMotorProvider } from './motorContexto.tsx'
import { OBRAS } from './obrasDeTeste.ts'

vi.mock('../../../infra/modelosLocais.ts', async (original) => ({
  ...(await original<typeof import('../../../infra/modelosLocais.ts')>()),
  temWebGL: vi.fn(() => true),
}))

const frag = (sigla: string): ModeloFrag => ({ sigla, revisao: 'R01', arquivo: `${sigla}.frag`, bytes: 3, hash: `h${sigla}` })
let motor: MotorVisualizadorFalso

beforeEach(() => {
  motor = new MotorVisualizadorFalso()
  vi.mocked(temWebGL).mockReturnValue(true)
})
afterEach(() => localStorage.clear())

function Url() {
  const l = useLocation()
  return <output data-testid="url">{l.pathname + l.search}</output>
}

interface Opcoes {
  /** Dá uma vista às issues 2 e 3 (a fixture só tem vista na 1). */
  vistasEmTodas?: boolean
  falharEnvio?: boolean
}

function renderizar(rota: string, opcoes: Opcoes = {}) {
  const base = criarRepositorioAdminFixture()
  const salvarIssue = vi.fn(base.salvarIssue)
  const repo = {
    ...base,
    salvarIssue,
    listarObrasCentral: async () => {
      const id = (await base.obterObra('hto')).obra.id
      return OBRAS.map((o) => (o.slug === 'hto' ? { ...o, obra_id: id } : o))
    },
    listarIssues: async (obraId: string) => {
      const lista = await base.listarIssues(obraId)
      if (!opcoes.vistasEmTodas) return lista
      const modelo = lista.find((i) => i.vistas.length > 0)!.vistas[0]
      return lista.map((i) => (i.vistas.length ? i : { ...i, vistas: [{ ...modelo, id: `v${i.numero}` }] }))
    },
    enviarArquivo: opcoes.falharEnvio
      ? async () => {
          throw new Error('storage fora do ar')
        }
      : base.enviarArquivo,
    listarModelos: async () => [frag('ARQ')],
    baixarModelo: async () => new ArrayBuffer(3),
  }
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <RepositorioAdminProvider repositorio={repo}>
        <FabricaMotorProvider fabrica={async () => motor}>
          <PreviaPdfProvider
            previa={{
              abrirPdf: async () => {
                throw new Error('sem prévia')
              },
            }}
          >
            <MemoryRouter initialEntries={[rota]}>
              <Routes>
                <Route path="/modelos/:slug" element={<CentralObra />} />
              </Routes>
              <Url />
            </MemoryRouter>
          </PreviaPdfProvider>
        </FabricaMotorProvider>
      </RepositorioAdminProvider>
    </QueryClientProvider>,
  )
  return { salvarIssue }
}

const prontoMotor = () => waitFor(() => expect(screen.getByRole('button', { name: 'Enquadrar' })).toBeEnabled())
const itemIssue = (n: number) => screen.getByTestId(`issue-${n}`)

describe('Painel Issues na central', () => {
  it('lista as abertas por padrão, conta e filtra por status e por texto', async () => {
    const usuario = userEvent.setup()
    renderizar('/modelos/hto?painel=issues')
    expect(await screen.findByText(/2 abertas de 3/)).toBeInTheDocument()
    expect(itemIssue(1)).toHaveTextContent('Viga colidindo com a tubulação de esgoto')
    expect(itemIssue(1)).toHaveTextContent('Alta')
    expect(itemIssue(1)).toHaveTextContent('1 comentário')
    expect(itemIssue(1)).toHaveTextContent('Prazo 05/12/2026')
    expect(itemIssue(2)).toHaveTextContent('Em andamento')
    expect(screen.queryByTestId('issue-3')).not.toBeInTheDocument()

    await usuario.selectOptions(screen.getByLabelText('Status'), 'resolvida')
    expect(screen.getByTestId('issue-3')).toBeInTheDocument()
    expect(screen.queryByTestId('issue-1')).not.toBeInTheDocument()

    await usuario.selectOptions(screen.getByLabelText('Status'), 'todas')
    expect(screen.getByRole('list', { name: 'Issues' }).querySelectorAll(':scope > li')).toHaveLength(3)
    await usuario.type(screen.getByLabelText('Buscar'), 'peitoril')
    expect(screen.getByRole('list', { name: 'Issues' }).querySelectorAll(':scope > li')).toHaveLength(1)
    expect(screen.getByTestId('issue-2')).toBeInTheDocument()
    await usuario.clear(screen.getByLabelText('Buscar'))
    await usuario.type(screen.getByLabelText('Buscar'), 'nada disso')
    expect(screen.getByText(/Nenhuma issue encontrada/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Exportar BCF' })).toBeEnabled()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Importar BCF' })).toBeEnabled())
  })

  it('cria uma issue a partir da vista atual (captura ao abrir) e a contagem de abertas muda', async () => {
    const usuario = userEvent.setup()
    const vistaAtual = vi.spyOn(motor, 'vistaAtual')
    const capturar = vi.spyOn(motor, 'capturar')
    renderizar('/modelos/hto?painel=issues')
    await screen.findByText(/2 abertas de 3/)
    await prontoMotor()
    await usuario.click(screen.getByRole('button', { name: 'Nova issue' }))
    await waitFor(() => expect(capturar).toHaveBeenCalled())
    expect(vistaAtual).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled()
    await usuario.type(screen.getByLabelText('Título'), 'Pilar fora de prumo')
    await usuario.selectOptions(screen.getByLabelText('Prioridade'), 'critica')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar' })).toBeEnabled())
    await usuario.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByRole('article', { name: 'Issue #4' })).toBeInTheDocument()
    expect(screen.getByTestId('url')).toHaveTextContent('painel=issues&issue=4')
    expect(await screen.findByText('Vista 1')).toBeInTheDocument()
    await usuario.click(screen.getByRole('button', { name: 'Voltar à lista' }))
    expect(await screen.findByText(/3 abertas de 4/)).toBeInTheDocument()
    expect(itemIssue(4)).toHaveTextContent('Crítica')
  })

  it('imagem que não sobe: issue criada, mensagem com o número e oferta de adicionar a vista', async () => {
    const usuario = userEvent.setup()
    renderizar('/modelos/hto?painel=issues', { falharEnvio: true })
    await screen.findByText(/2 abertas de 3/)
    await prontoMotor()
    await usuario.click(screen.getByRole('button', { name: 'Nova issue' }))
    await usuario.type(screen.getByLabelText('Título'), 'Sem imagem')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar' })).toBeEnabled())
    await usuario.click(screen.getByRole('button', { name: 'Salvar' }))
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(/A issue #4 foi criada, mas a imagem da vista não pôde ser enviada/)
    expect(within(alerta).getByRole('button', { name: 'Adicionar vista atual' })).toBeInTheDocument()
    expect(await screen.findByText(/3 abertas de 4/)).toBeInTheDocument()
  })

  it('abrir uma issue com vista aplica a primeira vista uma vez; "Restaurar vista" aplica de novo', async () => {
    const usuario = userEvent.setup()
    renderizar('/modelos/hto?painel=issues')
    await screen.findByText(/2 abertas de 3/)
    await prontoMotor()
    await usuario.click(within(itemIssue(1)).getByRole('button'))
    expect(await screen.findByRole('article', { name: 'Issue #1' })).toBeInTheDocument()
    expect(screen.getByTestId('url')).toHaveTextContent('painel=issues&issue=1')
    await waitFor(() => expect(motor.chamadasDe('aplicarVista')).toHaveLength(1))
    expect(screen.getByText('Projetista de hidráulica avisado; aguardando nova revisão.')).toBeInTheDocument()
    await usuario.click(screen.getByRole('button', { name: 'Restaurar vista' }))
    expect(motor.chamadasDe('aplicarVista')).toHaveLength(2)
    expect(motor.chamadasDe('aplicarVista')[1][0]).toMatchObject({ camera: { alvo: [0, 1.5, 0] } })
    await usuario.click(screen.getByRole('button', { name: 'Voltar à lista' }))
    expect(screen.getByTestId('url')).not.toHaveTextContent('issue=')
  })

  it('?issue= abre o detalhe e a vista é aplicada quando o motor fica pronto', async () => {
    renderizar('/modelos/hto?painel=issues&issue=1')
    expect(await screen.findByRole('article', { name: 'Issue #1' })).toBeInTheDocument()
    await waitFor(() => expect(motor.chamadasDe('aplicarVista')).toHaveLength(1))
  })

  it('mudar o status salva só o status', async () => {
    const usuario = userEvent.setup()
    const { salvarIssue } = renderizar('/modelos/hto?painel=issues&issue=1')
    await screen.findByRole('article', { name: 'Issue #1' })
    await usuario.selectOptions(screen.getByLabelText('Status'), 'resolvida')
    await waitFor(() => expect(salvarIssue).toHaveBeenCalledTimes(1))
    expect(salvarIssue).toHaveBeenCalledWith(expect.any(String), { status: 'resolvida' }, 'issue-semente-1')
    await waitFor(() => expect(screen.getByLabelText('Status')).toHaveValue('resolvida'))
  })

  it('comenta e o comentário aparece na lista do detalhe', async () => {
    const usuario = userEvent.setup()
    renderizar('/modelos/hto?painel=issues&issue=2')
    await screen.findByRole('article', { name: 'Issue #2' })
    expect(screen.getByRole('button', { name: 'Comentar' })).toBeDisabled()
    await usuario.type(screen.getByLabelText('Comentário'), 'Peitoril de 1,10 m confirmado')
    await usuario.click(screen.getByRole('button', { name: 'Comentar' }))
    expect(await screen.findByText('Peitoril de 1,10 m confirmado')).toBeInTheDocument()
    expect(screen.getByLabelText('Comentário')).toHaveValue('')
  })

  describe('marcadores', () => {
    it('vão ao motor só para abertas ou em andamento com vista', async () => {
      renderizar('/modelos/hto', { vistasEmTodas: true })
      await waitFor(() => expect(motor.marcadoresAtuais).toHaveLength(2))
      expect(motor.marcadoresAtuais.map((m) => m.rotulo).sort()).toEqual(['#1', '#2'])
      expect(motor.marcadoresAtuais.find((m) => m.rotulo === '#1')).toEqual({
        id: 'issue-semente-1',
        posicao: [0, 1.5, 0],
        rotulo: '#1',
      })

    })

    it('sem vista, a issue não ganha marcador', async () => {
      renderizar('/modelos/hto')
      await waitFor(() => expect(motor.marcadoresAtuais).toHaveLength(1))
      expect(motor.marcadoresAtuais[0].rotulo).toBe('#1')
    })

    it('clicar no marcador abre a issue e atualiza a URL', async () => {
      renderizar('/modelos/hto')
      await waitFor(() => expect(motor.marcadoresAtuais).toHaveLength(1))
      act(() => motor.clicarMarcador('issue-semente-1'))
      expect(await screen.findByRole('article', { name: 'Issue #1' })).toBeInTheDocument()
      expect(screen.getByTestId('url')).toHaveTextContent('painel=issues&issue=1')
      expect(screen.getByRole('tab', { name: 'Issues', selected: true })).toBeInTheDocument()
    })

    it('o botão Issues liga e desliga os marcadores e lembra a escolha', async () => {
      const usuario = userEvent.setup()
      renderizar('/modelos/hto')
      const botao = await screen.findByRole('button', { name: 'Issues' })
      await waitFor(() => expect(botao).toBeEnabled())
      expect(botao).toHaveAttribute('aria-pressed', 'true')
      await waitFor(() => expect(motor.marcadoresAtuais).toHaveLength(1))
      await usuario.click(botao)
      expect(botao).toHaveAttribute('aria-pressed', 'false')
      expect(localStorage.getItem('central.marcadores')).toBe('0')
      await waitFor(() => expect(motor.marcadoresAtuais).toHaveLength(0))
      await usuario.click(botao)
      expect(botao).toHaveAttribute('aria-pressed', 'true')
      await waitFor(() => expect(motor.marcadoresAtuais).toHaveLength(1))
    })

    it('começa desligado se a preferência salva for desligada', async () => {
      localStorage.setItem('central.marcadores', '0')
      renderizar('/modelos/hto')
      const botao = await screen.findByRole('button', { name: 'Issues' })
      await waitFor(() => expect(botao).toBeEnabled())
      expect(botao).toHaveAttribute('aria-pressed', 'false')
      expect(motor.marcadoresAtuais).toHaveLength(0)
    })
  })
})

describe('Importar e exportar BCF no painel Issues', () => {
  let baixado: { blob: Blob; nome: string }[]

  beforeEach(() => {
    baixado = []
    let nome = ''
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
      baixado.push({ blob: b as Blob, nome: '' })
      return 'blob:teste'
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      nome = this.download
      baixado[baixado.length - 1].nome = nome
    })
  })
  afterEach(() => vi.restoreAllMocks())

  const arquivo = (dados: Uint8Array, nome = 'issues.bcfzip') => new File([new Uint8Array(dados)], nome, { type: 'application/zip' })

  it('exporta as issues do filtro atual em BCF 2.1 e todas em 3.0', async () => {
    const usuario = userEvent.setup()
    renderizar('/modelos/hto?painel=issues')
    await screen.findByText(/2 abertas de 3/)
    await usuario.click(screen.getByRole('button', { name: 'Exportar BCF' }))
    const form = screen.getByRole('form', { name: 'Exportar BCF' })
    expect(within(form).getByLabelText('Versão do BCF')).toHaveValue('2.1')
    expect(within(form).getByRole('option', { name: 'Do filtro atual (2)' })).toBeInTheDocument()
    await usuario.click(within(form).getByRole('button', { name: 'Baixar .bcfzip' }))
    expect(await screen.findByRole('status', { name: 'Resultado do BCF' })).toHaveTextContent('2 issues exportadas em BCF 2.1')
    expect(baixado[0].nome).toMatch(/^hto-issues-\d{4}-\d{2}-\d{2}\.bcfzip$/)
    const p21 = lerBcf(new Uint8Array(await baixado[0].blob.arrayBuffer()))
    expect(p21.versao).toBe('2.1')
    expect(p21.topicos).toHaveLength(2)

    await usuario.click(screen.getByRole('button', { name: 'Exportar BCF' }))
    await usuario.selectOptions(screen.getByLabelText('Versão do BCF'), '3.0')
    await usuario.selectOptions(screen.getByLabelText('Conjunto'), 'todas')
    await usuario.click(screen.getByRole('button', { name: 'Baixar .bcfzip' }))
    await waitFor(() => expect(baixado).toHaveLength(2))
    const arquivos = unzipSync(new Uint8Array(await baixado[1].blob.arrayBuffer()))
    expect(new TextDecoder().decode(arquivos['bcf.version'])).toContain('VersionId="3.0"')
    expect(Object.keys(arquivos).filter((n) => n.endsWith('markup.bcf'))).toHaveLength(3)
  })

  it('exporta e importa usando a origem de coordenadas do motor', async () => {
    const usuario = userEvent.setup()
    const exportar = async () => {
      await usuario.click(screen.getByRole('button', { name: 'Exportar BCF' }))
      await usuario.selectOptions(screen.getByLabelText('Conjunto'), 'todas')
      await usuario.click(screen.getByRole('button', { name: 'Baixar .bcfzip' }))
      await waitFor(() => expect(baixado.length).toBeGreaterThan(0))
      return lerBcf(new Uint8Array(await baixado[baixado.length - 1].blob.arrayBuffer()))
    }
    const cameras = (p: ReturnType<typeof lerBcf>) =>
      p.topicos.flatMap((t) => t.viewpoints.flatMap((v) => (v.camera ? [v.camera.posicao] : [])))
    renderizar('/modelos/hto?painel=issues')
    await screen.findByText(/2 abertas de 3/)
    const base = cameras(await exportar())
    expect(base.length).toBeGreaterThan(0)
    motor.origemCenaDados = [100, 5, -200]
    const deslocado = cameras(await exportar())
    // mundo(Y-up) = cena + origem; em Z-up o deslocamento é (100, 200, 5).
    expect(deslocado[0][0]).toBeCloseTo(base[0][0] + 100, 6)
    expect(deslocado[0][1]).toBeCloseTo(base[0][1] + 200, 6)
    expect(deslocado[0][2]).toBeCloseTo(base[0][2] + 5, 6)
  })

  it('importa o BCF 2.1: cria a issue, anexa o snapshot e, ao reimportar, só atualiza', async () => {
    const usuario = userEvent.setup()
    renderizar('/modelos/hto?painel=issues')
    await screen.findByText(/2 abertas de 3/)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Importar BCF' })).toBeEnabled())
    const entrada = screen.getByLabelText('Arquivo BCF')
    await usuario.upload(entrada, arquivo(zipDe(BCF21)))
    expect(await screen.findByRole('status', { name: 'Resultado do BCF' })).toHaveTextContent(
      'Importação concluída: 1 criada, 0 atualizadas, 0 elementos não encontrados, 0 imagens não enviadas.',
    )
    expect(await screen.findByText(/3 abertas de 4/)).toBeInTheDocument()
    expect(screen.getByTestId('issue-4')).toHaveTextContent('Viga atravessa o shaft')
    expect(screen.getByTestId('issue-4')).toHaveTextContent('Alta')
    expect(screen.getByTestId('issue-4')).toHaveTextContent('1 comentário')

    await usuario.upload(entrada, arquivo(zipDe(BCF21)))
    await waitFor(() => expect(screen.getByRole('status', { name: 'Resultado do BCF' })).toHaveTextContent('0 criadas, 1 atualizada,'))
    expect(await screen.findByText(/3 abertas de 4/)).toBeInTheDocument()
  })

  it('conta os elementos que nenhuma disciplina carregada contém', async () => {
    const usuario = userEvent.setup()
    motor.globalIdsAusentes.add('0Nj8yW4Tv0H8pQ2dK1x9aB')
    renderizar('/modelos/hto?painel=issues')
    await screen.findByText(/2 abertas de 3/)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Importar BCF' })).toBeEnabled())
    await usuario.upload(screen.getByLabelText('Arquivo BCF'), arquivo(zipDe(BCF21)))
    expect(await screen.findByRole('status', { name: 'Resultado do BCF' })).toHaveTextContent('1 criada, 0 atualizadas, 1 elemento não encontrado, 0 imagens não enviadas')
  })

  it('arquivo inválido ou de versão não suportada mostra a mensagem', async () => {
    const usuario = userEvent.setup()
    renderizar('/modelos/hto?painel=issues')
    await screen.findByText(/2 abertas de 3/)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Importar BCF' })).toBeEnabled())
    await usuario.upload(screen.getByLabelText('Arquivo BCF'), arquivo(new TextEncoder().encode('não sou zip')))
    expect(await screen.findByRole('alert')).toHaveTextContent('não é um .bcfzip')
    await usuario.upload(screen.getByLabelText('Arquivo BCF'), arquivo(zipDe({ 'bcf.version': '<Version VersionId="1.0"/>' })))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Versão BCF 1.0 não suportada'))
  })
})
