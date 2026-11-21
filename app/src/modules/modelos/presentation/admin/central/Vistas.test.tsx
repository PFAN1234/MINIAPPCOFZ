import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RepositorioAdminProvider } from '../../../../../admin/dados/contexto.tsx'
import { criarRepositorioAdminFixture } from '../../../../../admin/dados/fixture.ts'
import type { Medida, NoArvore } from '../../../domain/central.ts'
import type { ModeloFrag } from '../../../domain/modelos.ts'
import { MotorVisualizadorFalso } from '../../../infra/MotorVisualizadorFalso.ts'
import { temWebGL } from '../../../infra/modelosLocais.ts'
import CentralObra from './CentralObra.tsx'
import { FabricaMotorProvider } from './motorContexto.tsx'
import { OBRAS } from './obrasDeTeste.ts'

vi.mock('../../../infra/modelosLocais.ts', async (original) => ({
  ...(await original<typeof import('../../../infra/modelosLocais.ts')>()),
  temWebGL: vi.fn(() => true),
}))

const frag = (sigla: string): ModeloFrag => ({ sigla, revisao: 'R01', arquivo: `${sigla}.frag`, bytes: 3, hash: `h${sigla}` })
const parede = { sigla: 'ARQ', globalId: 'G10', classe: 'IFCWALL', nome: 'Parede 1' }

const arvore: NoArvore[] = [
  {
    id: 'ARQ/1',
    rotulo: 'ARQ — Hospital',
    nivel: 'projeto',
    classe: 'IFCPROJECT',
    sigla: 'ARQ',
    filhos: [
      {
        id: 'ARQ/1.0',
        rotulo: 'Edifício',
        nivel: 'edificio',
        classe: 'IFCBUILDING',
        sigla: 'ARQ',
        filhos: [
          { id: 'ARQ/1.0.0', rotulo: 'Térreo', nivel: 'pavimento', classe: 'IFCBUILDINGSTOREY', sigla: 'ARQ', filhos: [] },
          { id: 'ARQ/1.0.1', rotulo: '1º Pavimento', nivel: 'pavimento', classe: 'IFCBUILDINGSTOREY', sigla: 'ARQ', filhos: [] },
        ],
      },
    ],
  },
]

let motor: MotorVisualizadorFalso

beforeEach(() => {
  motor = new MotorVisualizadorFalso()
  motor.arvoreDados = arvore
  vi.mocked(temWebGL).mockReturnValue(true)
})

async function pronto() {
  const usuario = userEvent.setup()
  const repo = {
    ...criarRepositorioAdminFixture(),
    listarObrasCentral: async () => OBRAS,
    listarModelos: async () => [frag('ARQ')],
    baixarModelo: async () => new ArrayBuffer(3),
  }
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <RepositorioAdminProvider repositorio={repo}>
        <FabricaMotorProvider fabrica={async () => motor}>
          <MemoryRouter initialEntries={['/modelos/hto']}>
            <Routes>
              <Route path="/modelos/:slug" element={<CentralObra />} />
            </Routes>
          </MemoryRouter>
        </FabricaMotorProvider>
      </RepositorioAdminProvider>
    </QueryClientProvider>,
  )
  await waitFor(() => expect(screen.getByRole('button', { name: 'Enquadrar' })).toBeEnabled())
  await waitFor(() => expect(screen.getByRole('option', { name: 'Térreo' })).toBeInTheDocument())
  return usuario
}

describe('Vista: planta, elevação e 3D', () => {
  it('lista os pavimentos da árvore e alterna entre planta, elevação e 3D', async () => {
    const usuario = await pronto()
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(expect.arrayContaining(['Térreo', '1º Pavimento']))
    const v3d = screen.getByRole('button', { name: 'Vista 3D' })
    expect(v3d).toHaveAttribute('aria-pressed', 'true')

    await usuario.selectOptions(screen.getByRole('combobox', { name: 'Pavimento' }), '1º Pavimento')
    await usuario.click(screen.getByRole('button', { name: 'Planta' }))
    expect(motor.vista).toEqual({ tipo: 'planta', pavimento: '1º Pavimento' })
    expect(screen.getByRole('button', { name: 'Planta' })).toHaveAttribute('aria-pressed', 'true')
    expect(v3d).toHaveAttribute('aria-pressed', 'false')

    await usuario.click(screen.getByRole('button', { name: 'Elevação L' }))
    expect(motor.vista).toEqual({ tipo: 'elevacao', lado: 'L' })
    expect(screen.getByRole('button', { name: 'Elevação L' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Planta' })).toHaveAttribute('aria-pressed', 'false')

    await usuario.click(v3d)
    expect(motor.vista).toEqual({ tipo: '3d' })
    expect(v3d).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('Cortes', () => {
  it('cria, marca, apaga um e apaga todos', async () => {
    const usuario = await pronto()
    expect(screen.queryByRole('list', { name: 'Lista de cortes' })).not.toBeInTheDocument()
    await usuario.click(screen.getByRole('button', { name: 'Cortar' }))
    await usuario.click(screen.getByRole('button', { name: 'Cortar' }))
    const lista = await screen.findByRole('list', { name: 'Lista de cortes' })
    expect(lista.children).toHaveLength(2)

    await usuario.click(screen.getByRole('button', { name: 'Apagar corte 1' }))
    expect(motor.chamadasDe('cortes.apagar')).toEqual([['corte-1']])
    expect(screen.getByRole('list', { name: 'Lista de cortes' }).children).toHaveLength(1)

    await usuario.click(screen.getByRole('button', { name: 'Cortar' }))
    await usuario.click(screen.getByRole('button', { name: 'Apagar todos os cortes' }))
    expect(motor.cortesLista).toEqual([])
    expect(screen.queryByRole('list', { name: 'Lista de cortes' })).not.toBeInTheDocument()
  })

  it('Del apaga o corte marcado na lista', async () => {
    const usuario = await pronto()
    await usuario.click(screen.getByRole('button', { name: 'Cortar' }))
    await usuario.click(screen.getByRole('button', { name: 'Cortar' }))
    await usuario.keyboard('{Delete}')
    expect(motor.cortesLista).toHaveLength(2) // nada marcado
    await usuario.click(await screen.findByRole('button', { name: 'Corte 2' }))
    await usuario.keyboard('{Delete}')
    expect(motor.cortesLista.map((c) => c.id)).toEqual(['corte-1'])
  })
})

describe('Caminhar e minimapa', () => {
  it('Caminhar liga e desliga', async () => {
    const usuario = await pronto()
    const caminhar = screen.getByRole('button', { name: 'Caminhar' })
    await usuario.click(caminhar)
    expect(motor.caminhando).toBe(true)
    expect(caminhar).toHaveAttribute('aria-pressed', 'true')
    await usuario.click(caminhar)
    expect(motor.caminhando).toBe(false)
    expect(caminhar).toHaveAttribute('aria-pressed', 'false')
  })

  it('Minimapa liga e desliga, contando as ligações', async () => {
    const usuario = await pronto()
    const botao = screen.getByRole('button', { name: 'Minimapa' })
    await usuario.click(botao)
    expect(motor.minimapaLigado).toBe(true)
    expect(motor.minimapaLigacoes).toBe(1)
    expect(botao).toHaveAttribute('aria-pressed', 'true')
    await usuario.click(botao)
    expect(motor.minimapaLigado).toBe(false)
    expect(motor.minimapaLigacoes).toBe(1)
  })
})

describe('Isolar resultados do Filtro', () => {
  it('passa pelo caminho da barra e marca "Isolar" como pressionado', async () => {
    const usuario = await pronto()
    motor.buscaDados = [parede]
    await usuario.click(screen.getByRole('tab', { name: 'Filtro' }))
    await usuario.selectOptions(screen.getByLabelText('Operador'), 'existe')
    await usuario.click(screen.getByRole('button', { name: 'Buscar' }))
    await usuario.click(await screen.findByRole('button', { name: 'Isolar resultados' }))
    expect(motor.chamadasDe('isolar')).toEqual([[[parede]]])
    const isolar = screen.getByRole('button', { name: 'Isolar' })
    expect(isolar).toHaveAttribute('aria-pressed', 'true')
    // Alternar na barra desfaz o isolamento, como se tivesse sido feito por ela.
    await usuario.click(isolar)
    expect(motor.chamadasDe('mostrarTudo')).toHaveLength(1)
    expect(isolar).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('Medições', () => {
  const dist: Medida = { id: 'm1', tipo: 'distancia', valor: 12.3456, unidade: 'm', pontos: [] }
  const area: Medida = { id: 'm2', tipo: 'area', valor: 4, unidade: 'm²', pontos: [] }

  async function abrirMedicoes() {
    const usuario = await pronto()
    await usuario.click(screen.getByRole('tab', { name: 'Medições' }))
    return usuario
  }

  it('liga e desliga os modos pela barra, com aria-pressed', async () => {
    const usuario = await abrirMedicoes()
    expect(screen.getByText('Nenhuma medição.')).toBeInTheDocument()
    const medir = screen.getByRole('button', { name: 'Medir' })
    expect(medir).toHaveAttribute('aria-pressed', 'false')
    await usuario.click(medir)
    await usuario.click(screen.getByRole('button', { name: 'Distância' }))
    expect(motor.chamadasDe('medir.modo')).toEqual([['distancia']])
    expect(screen.getByRole('button', { name: 'Distância' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Área' })).toHaveAttribute('aria-pressed', 'false')
    expect(medir).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/Clique em dois pontos/)).toBeInTheDocument()

    await usuario.click(screen.getByRole('button', { name: 'Área' }))
    expect(motor.chamadasDe('medir.modo')).toEqual([['distancia'], ['area']])
    await usuario.click(screen.getByRole('button', { name: 'Área' }))
    expect(motor.chamadasDe('medir.modo')[2]).toEqual([null])
    expect(medir).toHaveAttribute('aria-pressed', 'false')
  })

  it('Esc sai do modo de medição', async () => {
    const usuario = await abrirMedicoes()
    await usuario.click(screen.getByRole('button', { name: 'Medir' }))
    await usuario.click(screen.getByRole('button', { name: 'Ângulo' }))
    await usuario.keyboard('{Escape}')
    expect(motor.chamadasDe('medir.modo')).toEqual([['angulo'], [null]])
    expect(screen.getByRole('button', { name: 'Medir' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('lista formatada, apaga uma, apaga todas e Del apaga a marcada', async () => {
    const usuario = await abrirMedicoes()
    act(() => {
      motor.adicionarMedida(dist)
      motor.adicionarMedida(area)
    })
    const lista = await screen.findByRole('list', { name: 'Lista de medições' })
    expect(lista).toHaveTextContent('Distância: 12,35 m')
    expect(lista).toHaveTextContent('Área: 4,00 m²')

    await usuario.keyboard('{Delete}')
    expect(motor.medidasLista).toHaveLength(2) // nada marcado
    await usuario.click(screen.getByRole('button', { name: /^Área 2/ }))
    await usuario.keyboard('{Delete}')
    expect(motor.medidasLista.map((m) => m.id)).toEqual(['m1'])

    act(() => motor.adicionarMedida(area))
    await usuario.click(await screen.findByRole('button', { name: 'Apagar medição 1' }))
    expect(motor.chamadasDe('medir.apagar')).toContainEqual(['m1'])
    expect(motor.medidasLista.map((m) => m.id)).toEqual(['m2'])

    act(() => motor.adicionarMedida(dist))
    await usuario.click(await screen.findByRole('button', { name: 'Apagar todas as medições' }))
    expect(motor.medidasLista).toEqual([])
    expect(await screen.findByText('Nenhuma medição.')).toBeInTheDocument()
  })
})
