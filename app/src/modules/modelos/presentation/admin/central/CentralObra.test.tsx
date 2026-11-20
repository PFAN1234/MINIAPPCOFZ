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
import type { NoArvore } from '../../../domain/central.ts'
import CentralObra from './CentralObra.tsx'
import { FabricaMotorProvider } from './motorContexto.tsx'
import { OBRAS } from './obrasDeTeste.ts'

vi.mock('../../../infra/modelosLocais.ts', async (original) => ({
  ...(await original<typeof import('../../../infra/modelosLocais.ts')>()),
  temWebGL: vi.fn(() => true),
}))

const frag = (sigla: string): ModeloFrag => ({ sigla, revisao: 'R01', arquivo: `${sigla}.frag`, bytes: 3, hash: `h${sigla}` })
let motor: MotorVisualizadorFalso
let modelos: ModeloFrag[]
let portao: Promise<void>

beforeEach(() => {
  motor = new MotorVisualizadorFalso()
  modelos = [frag('ARQ'), frag('EST')]
  portao = Promise.resolve()
  vi.mocked(temWebGL).mockReturnValue(true)
})
afterEach(() => localStorage.clear())

function Url() {
  const l = useLocation()
  return <output data-testid="url">{l.pathname + l.search}</output>
}

function renderizar(rota: string) {
  return renderizar2(rota)
}

function renderizar2(rota: string) {
  const repo = {
    ...criarRepositorioAdminFixture(),
    listarObrasCentral: async () => OBRAS,
    listarModelos: async () => modelos,
    baixarModelo: async () => {
      await portao
      return new ArrayBuffer(3)
    },
  }
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <RepositorioAdminProvider repositorio={repo}>
        <FabricaMotorProvider fabrica={async () => motor}>
          <MemoryRouter initialEntries={[rota]}>
            <Routes>
              <Route path="/modelos/:slug" element={<CentralObra />} />
            </Routes>
            <Url />
          </MemoryRouter>
        </FabricaMotorProvider>
      </RepositorioAdminProvider>
    </QueryClientProvider>,
  )
}

describe('CentralObra', () => {
  it('abre em Itens por padrão e mostra o nome da obra e o canvas', async () => {
    renderizar('/modelos/hto')
    expect(await screen.findByRole('tab', { name: 'Itens', selected: true })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Árvore' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'HTO' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Todas as obras' })).toHaveAttribute('href', '/modelos')
    expect(screen.getByTestId('canvas-central')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Medir' })).toBeDisabled()
  })

  it('a aba vem da query string e a troca atualiza a URL', async () => {
    const usuario = userEvent.setup()
    renderizar('/modelos/hto?painel=gestao')
    expect(await screen.findByRole('tab', { name: 'Gestão', selected: true })).toBeInTheDocument()
    expect(screen.getByText('Disponível na etapa 5')).toBeInTheDocument()
    await usuario.click(screen.getByRole('tab', { name: 'Issues' }))
    expect(screen.getByTestId('url')).toHaveTextContent('/modelos/hto?painel=issues')
    expect(screen.getByRole('tab', { name: 'Issues', selected: true })).toBeInTheDocument()
    expect(screen.getByText('Disponível na etapa 7')).toBeInTheDocument()
  })

  it('alternar o tema persiste a preferência', async () => {
    const usuario = userEvent.setup()
    renderizar('/modelos/hto')
    const raiz = (await screen.findByTestId('canvas-central')).closest('.central')!
    expect(raiz).toHaveAttribute('data-tema', 'escuro')
    await usuario.click(screen.getByRole('button', { name: /Configurações/ }))
    expect(raiz).toHaveAttribute('data-tema', 'claro')
    expect(localStorage.getItem('central.tema')).toBe('claro')
  })

  it('recolhe e reabre o painel', async () => {
    const usuario = userEvent.setup()
    renderizar('/modelos/hto')
    await usuario.click(await screen.findByRole('button', { name: 'Recolher painel' }))
    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument()
    await usuario.click(screen.getByRole('button', { name: 'Abrir painel' }))
    expect(screen.getByRole('tabpanel')).toBeInTheDocument()
  })

  it('redimensiona pelo teclado dentro dos limites', async () => {
    const usuario = userEvent.setup()
    renderizar('/modelos/hto')
    const borda = await screen.findByRole('separator')
    borda.focus()
    for (let i = 0; i < 40; i++) await usuario.keyboard('{ArrowRight}')
    expect(borda).toHaveAttribute('aria-valuenow', '520')
    for (let i = 0; i < 40; i++) await usuario.keyboard('{ArrowLeft}')
    expect(borda).toHaveAttribute('aria-valuenow', '240')
  })

  it('obra desconhecida', async () => {
    renderizar('/modelos/nada')
    expect(await screen.findByText('Obra não encontrada.')).toBeInTheDocument()
  })

  describe('motor 3D', () => {
    const arvore: NoArvore[] = [
      {
        id: 'ARQ/1',
        rotulo: 'ARQ — Hospital',
        nivel: 'projeto',
        classe: 'IFCPROJECT',
        sigla: 'ARQ',
        filhos: [
          {
            id: 'ARQ/1.0/10',
            rotulo: 'Parede 1',
            nivel: 'elemento',
            classe: 'IFCWALL',
            sigla: 'ARQ',
            ref: { sigla: 'ARQ', globalId: 'G10', classe: 'IFCWALL', nome: 'Parede 1' },
            filhos: [],
          },
        ],
      },
    ]

    it('monta, carrega as siglas publicadas e libera ao desmontar', async () => {
      motor.arvoreDados = arvore
      const { unmount } = renderizar2('/modelos/hto')
      await waitFor(() => expect(motor.chamadasDe('carregar')).toEqual([[['ARQ', 'EST']]]))
      expect(motor.chamadasDe('montar')).toHaveLength(1)
      expect(motor.chamadasDe('montar')[0][1]).toBe('escuro')
      await waitFor(() => expect(motor.chamadasDe('enquadrar')).toHaveLength(1))
      unmount()
      expect(motor.liberado).toBe(true)
    })

    it('mostra a pílula de carregamento e depois some', async () => {
      let abrir = () => {}
      portao = new Promise<void>((r) => (abrir = r))
      renderizar('/modelos/hto')
      expect(await screen.findByText(/Carregando modelos…/)).toBeInTheDocument()
      abrir()
      await waitFor(() => expect(screen.queryByText(/Carregando modelos…/)).not.toBeInTheDocument())
    })

    it('sem WebGL avisa e não monta o motor', async () => {
      vi.mocked(temWebGL).mockReturnValue(false)
      renderizar('/modelos/hto')
      expect(await screen.findByText(/não permite exibir o modelo 3D/)).toBeInTheDocument()
      expect(motor.chamadas).toHaveLength(0)
    })

    it('obra sem modelos publicados', async () => {
      modelos = []
      renderizar('/modelos/hto')
      expect(await screen.findByText('Sem modelos publicados — envie pela aba Gestão')).toBeInTheDocument()
      expect(motor.chamadasDe('montar')).toHaveLength(0)
    })

    it('erro em uma disciplina avisa as siglas e mantém as outras', async () => {
      motor.siglasComFalha.add('EST')
      renderizar('/modelos/hto')
      expect(await screen.findByText('Não carregaram: EST')).toBeInTheDocument()
      expect(motor.carregadas).toEqual(['ARQ'])
      expect(screen.getByRole('button', { name: 'Enquadrar' })).toBeEnabled()
    })

    it('árvore: clique no elemento seleciona no 3D e o contexto mostra a seleção', async () => {
      const usuario = userEvent.setup()
      motor.arvoreDados = arvore
      renderizar('/modelos/hto')
      await usuario.click(await screen.findByRole('button', { name: 'Parede 1' }))
      expect(motor.chamadasDe('selecionar').at(-1)).toEqual([[{ sigla: 'ARQ', globalId: 'G10', classe: 'IFCWALL', nome: 'Parede 1' }]])
      const contexto = screen.getByRole('region', { name: 'Contexto' })
      expect(within(contexto).getByText('G10')).toBeInTheDocument()
      expect(within(contexto).getByText('IFCWALL')).toBeInTheDocument()
    })

    it('evento de seleção do motor atualiza o contexto', async () => {
      renderizar('/modelos/hto')
      await screen.findByRole('button', { name: 'Enquadrar' })
      await waitFor(() => expect(motor.chamadasDe('carregar')).toHaveLength(1))
      act(() => motor.emitir('selecao', [{ sigla: 'EST', globalId: 'GX', classe: 'IFCBEAM', nome: 'Viga' }]))
      const contexto = screen.getByRole('region', { name: 'Contexto' })
      expect(within(contexto).getByText('GX')).toBeInTheDocument()
      expect(within(contexto).getByText('EST')).toBeInTheDocument()
    })

    it('categorias vêm do motor, na ordem recebida', async () => {
      const usuario = userEvent.setup()
      motor.categoriasDados = [
        { classe: 'IFCWALL', total: 9 },
        { classe: 'IFCDOOR', total: 2 },
      ]
      renderizar('/modelos/hto')
      await waitFor(() => expect(screen.getByRole('button', { name: 'Enquadrar' })).toBeEnabled())
      await usuario.click(screen.getByRole('tab', { name: 'Categorias' }))
      const itens = within(await screen.findByRole('list', { name: 'Categorias IFC' })).getAllByRole('listitem')
      expect(itens[0]).toHaveTextContent('IFCWALL9')
      expect(itens[1]).toHaveTextContent('IFCDOOR2')
    })

    it('modelos: desligar descarrega e religar carrega de novo', async () => {
      const usuario = userEvent.setup()
      renderizar('/modelos/hto')
      await waitFor(() => expect(screen.getByRole('button', { name: 'Enquadrar' })).toBeEnabled())
      await usuario.click(screen.getByRole('tab', { name: 'Modelos' }))
      const caixa = screen.getByRole('checkbox', { name: /EST/ })
      expect(caixa).toBeChecked()
      await usuario.click(caixa)
      expect(motor.chamadasDe('descarregar')).toEqual([['EST']])
      expect(caixa).not.toBeChecked()
      await usuario.click(caixa)
      await waitFor(() => expect(motor.chamadasDe('carregar').at(-1)).toEqual([['EST']]))
      expect(caixa).toBeChecked()
    })

    it('barra e atalhos: enquadrar, projeção, F e Esc', async () => {
      const usuario = userEvent.setup()
      renderizar('/modelos/hto')
      await waitFor(() => expect(screen.getByRole('button', { name: 'Enquadrar' })).toBeEnabled())
      const antes = motor.chamadasDe('enquadrar').length
      await usuario.click(screen.getByRole('button', { name: 'Enquadrar' }))
      await usuario.keyboard('f')
      expect(motor.chamadasDe('enquadrar')).toHaveLength(antes + 2)
      const proj = screen.getByRole('button', { name: 'Projeção' })
      expect(proj).toHaveAttribute('aria-pressed', 'false')
      await usuario.click(proj)
      expect(proj).toHaveAttribute('aria-pressed', 'true')
      expect(motor.chamadasDe('projecao').at(-1)).toEqual(['ortografica'])
      act(() => motor.emitir('selecao', [{ sigla: 'ARQ', globalId: 'G1' }]))
      await usuario.keyboard('{Escape}')
      expect(motor.chamadasDe('selecionar').at(-1)).toEqual([[]])
      expect(screen.getByText('Nenhuma seleção.')).toBeInTheDocument()
    })

    describe('visibilidade, cor, grade e busca', () => {
      const parede = { sigla: 'ARQ', globalId: 'G10', classe: 'IFCWALL', nome: 'Parede 1' }

      async function pronto() {
        const usuario = userEvent.setup()
        renderizar('/modelos/hto')
        await waitFor(() => expect(screen.getByRole('button', { name: 'Enquadrar' })).toBeEnabled())
        return usuario
      }

      it('sem seleção, Ocultar, Isolar, Fantasma e Limpar ficam desabilitados', async () => {
        await pronto()
        expect(screen.getByText('Selecionado (0)')).toBeInTheDocument()
        for (const nome of ['Ocultar', 'Isolar', 'Fantasma', 'Limpar seleção']) {
          expect(screen.getByRole('button', { name: nome })).toBeDisabled()
        }
        expect(screen.getByRole('button', { name: 'Mostrar tudo' })).toBeEnabled()
      })

      it('a barra chama ocultar, isolar (alterna), fantasma, mostrar tudo e limpar', async () => {
        const usuario = await pronto()
        act(() => motor.emitir('selecao', [parede]))
        expect(screen.getByText('Selecionado (1)')).toBeInTheDocument()

        const isolar = screen.getByRole('button', { name: 'Isolar' })
        await usuario.click(isolar)
        expect(motor.chamadasDe('isolar')).toEqual([[[parede]]])
        expect(isolar).toHaveAttribute('aria-pressed', 'true')
        await usuario.click(isolar)
        expect(motor.chamadasDe('mostrarTudo')).toHaveLength(1)
        expect(isolar).toHaveAttribute('aria-pressed', 'false')

        const fantasma = screen.getByRole('button', { name: 'Fantasma' })
        await usuario.click(fantasma)
        expect(motor.chamadasDe('fantasma').at(-1)).toEqual([true])
        expect(fantasma).toHaveAttribute('aria-pressed', 'true')

        await usuario.click(screen.getByRole('button', { name: 'Mostrar tudo' }))
        expect(motor.chamadasDe('mostrarTudo')).toHaveLength(2)

        await usuario.click(screen.getByRole('button', { name: 'Ocultar' }))
        expect(motor.chamadasDe('ocultar')).toEqual([[[parede]]])
        expect(motor.chamadasDe('selecionar').at(-1)).toEqual([[]])

        act(() => motor.emitir('selecao', [parede]))
        await usuario.click(screen.getByRole('button', { name: 'Limpar seleção' }))
        expect(motor.chamadasDe('selecionar').at(-1)).toEqual([[]])
      })

      it('atalhos H e I agem sobre a seleção e são ignorados em campos de texto', async () => {
        const usuario = await pronto()
        act(() => motor.emitir('selecao', [parede]))
        await usuario.keyboard('i')
        expect(motor.chamadasDe('isolar')).toHaveLength(1)
        await usuario.keyboard('h')
        expect(motor.chamadasDe('ocultar')).toEqual([[[parede]]])

        act(() => motor.emitir('selecao', [parede]))
        await usuario.click(screen.getByRole('searchbox', { name: 'Buscar itens' }))
        await usuario.keyboard('hi')
        expect(motor.chamadasDe('ocultar')).toHaveLength(1)
        expect(motor.chamadasDe('isolar')).toHaveLength(1)
      })

      it('menu Cor: Categoria e Disciplina chamam colorirPor', async () => {
        const usuario = await pronto()
        const cor = screen.getByRole('button', { name: 'Cor' })
        await usuario.click(cor)
        await usuario.click(screen.getByRole('menuitemradio', { name: 'Categoria' }))
        expect(motor.chamadasDe('colorirPor').at(-1)).toEqual(['categoria'])
        expect(screen.queryByRole('menu')).not.toBeInTheDocument()
        await usuario.click(cor)
        expect(screen.getByRole('menuitemradio', { name: 'Categoria' })).toHaveAttribute('aria-checked', 'true')
        await usuario.click(screen.getByRole('menuitemradio', { name: 'Disciplina' }))
        expect(motor.chamadasDe('colorirPor').at(-1)).toEqual(['disciplina'])
        await usuario.click(cor)
        await usuario.click(screen.getByRole('menuitemradio', { name: 'Nenhuma' }))
        expect(motor.chamadasDe('colorirPor').at(-1)).toEqual(['nenhum'])
      })

      it('Grade e Realce alternam no motor', async () => {
        const usuario = await pronto()
        const grade = screen.getByRole('button', { name: 'Grade' })
        expect(grade).toHaveAttribute('aria-pressed', 'true')
        await usuario.click(grade)
        expect(motor.chamadasDe('grade').at(-1)).toEqual([false])
        expect(grade).toHaveAttribute('aria-pressed', 'false')
        await usuario.click(screen.getByRole('button', { name: 'Realce ao passar' }))
        expect(motor.chamadasDe('hover').at(-1)).toEqual([false])
      })

      it('busca com debounce de 300 ms: o resultado seleciona e enquadra', async () => {
        const usuario = await pronto()
        motor.buscaDados = [parede]
        await usuario.type(screen.getByRole('searchbox', { name: 'Buscar itens' }), 'Parede')
        expect(motor.chamadasDe('buscar')).toHaveLength(0)
        const resultados = await screen.findByRole('list', { name: 'Resultados da busca' })
        expect(motor.chamadasDe('buscar')).toEqual([[{ operador: 'contem', valor: 'Parede' }]])
        await usuario.click(within(resultados).getByRole('button', { name: /Parede 1/ }))
        expect(motor.chamadasDe('selecionar').at(-1)).toEqual([[parede]])
        expect(motor.chamadasDe('enquadrar').at(-1)).toEqual([[parede]])
      })

      it('busca sem resultado avisa', async () => {
        const usuario = await pronto()
        await usuario.type(screen.getByRole('searchbox', { name: 'Buscar itens' }), 'xyz')
        expect(await screen.findByText('Nenhum item encontrado.')).toBeInTheDocument()
      })

      it('categorias: clicar seleciona a classe toda e o olho oculta e mostra', async () => {
        const usuario = await pronto()
        motor.categoriasDados = [{ classe: 'IFCWALL', total: 9 }]
        motor.buscaDados = [parede]
        await usuario.click(screen.getByRole('tab', { name: 'Categorias' }))
        await screen.findByRole('list', { name: 'Categorias IFC' })

        await usuario.click(screen.getByRole('button', { name: 'Selecionar IFCWALL' }))
        await waitFor(() => expect(motor.chamadasDe('selecionar').at(-1)).toEqual([[parede]]))
        expect(motor.chamadasDe('buscar').at(-1)).toEqual([{ classe: 'IFCWALL', operador: 'existe' }])

        await usuario.click(screen.getByRole('button', { name: 'Ocultar IFCWALL' }))
        await waitFor(() => expect(motor.chamadasDe('ocultar')).toEqual([[[parede]]]))
        const olho = await screen.findByRole('button', { name: 'Mostrar IFCWALL' })
        await usuario.click(olho)
        await waitFor(() => expect(motor.chamadasDe('mostrar')).toEqual([[[parede]]]))
        expect(await screen.findByRole('button', { name: 'Ocultar IFCWALL' })).toBeInTheDocument()
      })
    })

    it('trocar o tema repassa ao motor sem remontar', async () => {
      const usuario = userEvent.setup()
      renderizar('/modelos/hto')
      await waitFor(() => expect(screen.getByRole('button', { name: 'Enquadrar' })).toBeEnabled())
      await usuario.click(screen.getByRole('button', { name: /Configurações/ }))
      expect(motor.chamadasDe('tema').at(-1)).toEqual(['claro'])
      expect(motor.chamadasDe('montar')).toHaveLength(1)
    })
  })
})
