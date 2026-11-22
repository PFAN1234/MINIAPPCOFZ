import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MotorVisualizadorFalso } from '../../../../infra/MotorVisualizadorFalso.ts'
import type { RefElemento } from '../../../../domain/central.ts'
import Filtro from './Filtro.tsx'
import Propriedades from './Propriedades.tsx'

const parede: RefElemento = { sigla: 'ARQ', globalId: '3cUkl32yn9qRSPvBJVyWYp', classe: 'IFCWALL', nome: 'Parede 1' }
const laje: RefElemento = { sigla: 'ARQ', globalId: 'outro', classe: 'IFCSLAB', nome: 'Laje' }

describe('Propriedades', () => {
  it('sem seleção pede para selecionar', () => {
    render(<Propriedades motor={new MotorVisualizadorFalso()} selecao={[]} />)
    expect(screen.getByText(/Selecione um elemento/)).toBeInTheDocument()
  })

  it('mostra os grupos, com Atributos aberto, e avisa que não há quantidades', async () => {
    const motor = new MotorVisualizadorFalso()
    render(<Propriedades motor={motor} selecao={[parede]} />)
    expect(await screen.findByText('3cUkl32yn9qRSPvBJVyWYp')).toBeInTheDocument()
    expect(screen.getByText('Atributos').closest('details')).toHaveAttribute('open')
    expect(screen.getByText('Pset_WallCommon').closest('details')).not.toHaveAttribute('open')
    expect(screen.getByText('Sem quantidades no IFC')).toBeInTheDocument()
    expect(motor.chamadasDe('propriedades')).toHaveLength(1)
  })

  it('não avisa quando há grupo de quantidades', async () => {
    const motor = new MotorVisualizadorFalso()
    motor.propriedadesDados = [{ nome: 'Qto', itens: [{ nome: 'Length', valor: '3' }], quantidades: true }]
    render(<Propriedades motor={motor} selecao={[parede]} />)
    expect(await screen.findByText('Qto')).toBeInTheDocument()
    expect(screen.queryByText('Sem quantidades no IFC')).not.toBeInTheDocument()
  })

  it('filtra as propriedades pelo texto', async () => {
    const usuario = userEvent.setup()
    render(<Propriedades motor={new MotorVisualizadorFalso()} selecao={[parede]} />)
    await screen.findByText('Pset_WallCommon')
    await usuario.type(screen.getByRole('searchbox', { name: 'Filtrar propriedades' }), 'isext')
    expect(screen.getByText('IsExternal')).toBeInTheDocument()
    expect(screen.queryByText('Atributos')).not.toBeInTheDocument()
  })

  it('copia o GlobalId', async () => {
    const usuario = userEvent.setup()
    const escrever = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    render(<Propriedades motor={new MotorVisualizadorFalso()} selecao={[parede]} />)
    await screen.findByText('Pset_WallCommon')
    await usuario.click(screen.getByRole('button', { name: 'Copiar GlobalId' }))
    expect(escrever).toHaveBeenCalledWith('3cUkl32yn9qRSPvBJVyWYp')
  })

  it('trata erro de leitura', async () => {
    const motor = new MotorVisualizadorFalso()
    motor.propriedadesErro = true
    render(<Propriedades motor={motor} selecao={[parede]} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível ler as propriedades')
  })

  it('seleção múltipla mostra a contagem por classe', () => {
    render(<Propriedades motor={new MotorVisualizadorFalso()} selecao={[parede, laje, { ...parede, globalId: 'x' }]} />)
    expect(screen.getByText('3 elementos selecionados')).toBeInTheDocument()
    const lista = screen.getByRole('list', { name: 'Contagem por classe' })
    expect(lista.children[0]).toHaveTextContent('IFCWALL 2')
    expect(lista.children[1]).toHaveTextContent('IFCSLAB 1')
  })
})

describe('Filtro', () => {
  it('busca por classe, atributo e valor e oferece as ações', async () => {
    const usuario = userEvent.setup()
    const motor = new MotorVisualizadorFalso()
    motor.categoriasDados = [{ classe: 'IFCWALL', total: 5 }]
    motor.buscaDados = [parede, laje]
    const aoSelecionar = vi.fn()
    render(<Filtro motor={motor} versao={1} onSelecionar={aoSelecionar} onIsolar={(r) => motor.isolar(r)} />)
    await waitFor(() => expect(screen.getByRole('option', { name: 'IFCWALL (5)' })).toBeInTheDocument())
    await usuario.selectOptions(screen.getByLabelText('Classe'), 'IFCWALL')
    await usuario.selectOptions(screen.getByLabelText('Atributo'), 'Tag')
    await usuario.selectOptions(screen.getByLabelText('Operador'), 'igual')
    await usuario.type(screen.getByLabelText('Valor'), 'T-1')
    await usuario.click(screen.getByRole('button', { name: 'Buscar' }))
    expect(await screen.findByText('2 resultados')).toBeInTheDocument()
    expect(motor.chamadasDe('buscar')[0][0]).toEqual({
      operador: 'igual',
      classe: 'IFCWALL',
      atributo: 'Tag',
      valor: 'T-1',
    })
    await usuario.click(screen.getByRole('button', { name: 'Selecionar' }))
    expect(aoSelecionar).toHaveBeenCalledWith([parede, laje])
    await usuario.click(screen.getByRole('button', { name: 'Isolar resultados' }))
    expect(motor.chamadasDe('isolar')[0][0]).toEqual([parede, laje])
    await usuario.click(screen.getByRole('button', { name: 'Enquadrar' }))
    expect(motor.chamadasDe('enquadrar')[0][0]).toEqual([parede, laje])
  })

  it('operador "existe" esconde o valor e avisa quando não há resultados', async () => {
    const usuario = userEvent.setup()
    render(<Filtro motor={new MotorVisualizadorFalso()} versao={1} onSelecionar={() => {}} onIsolar={() => {}} />)
    await usuario.selectOptions(screen.getByLabelText('Operador'), 'existe')
    expect(screen.queryByLabelText('Valor')).not.toBeInTheDocument()
    await usuario.click(screen.getByRole('button', { name: 'Buscar' }))
    expect(await screen.findByText('0 resultados')).toBeInTheDocument()
  })

  it('origem "Propriedade (pset)" monta o filtro com grupo e atributo', async () => {
    const usuario = userEvent.setup()
    const motor = new MotorVisualizadorFalso()
    motor.buscaDados = [parede]
    render(<Filtro motor={motor} versao={1} onSelecionar={() => {}} onIsolar={() => {}} />)
    await usuario.selectOptions(screen.getByLabelText('Origem'), 'pset')
    expect(screen.queryByLabelText('Atributo')).not.toBeInTheDocument()
    await usuario.type(screen.getByLabelText('Pset'), 'Pset_WallCommon')
    await usuario.type(screen.getByLabelText('Propriedade'), 'IsExternal')
    await usuario.selectOptions(screen.getByLabelText('Operador'), 'igual')
    await usuario.type(screen.getByLabelText('Valor'), 'Sim')
    await usuario.click(screen.getByRole('button', { name: 'Buscar' }))
    expect(await screen.findByText('1 resultado')).toBeInTheDocument()
    expect(motor.chamadasDe('buscar')[0][0]).toEqual({
      operador: 'igual',
      grupo: 'Pset_WallCommon',
      atributo: 'IsExternal',
      valor: 'Sim',
    })
  })

  it('motor falso filtra por pset (grupo, propriedade e valor)', async () => {
    const motor = new MotorVisualizadorFalso()
    motor.buscaDados = [parede]
    const base = { operador: 'igual', grupo: 'Pset_WallCommon', atributo: 'IsExternal', valor: 'Sim' } as const
    expect(await motor.buscar(base)).toEqual([parede])
    expect(await motor.buscar({ ...base, valor: 'Não' })).toEqual([])
    expect(await motor.buscar({ ...base, operador: 'existe' })).toEqual([parede])
    expect(await motor.buscar({ ...base, grupo: 'Pset_Outro' })).toEqual([])
    expect(await motor.buscar({ ...base, atributo: 'Nada', operador: 'existe' })).toEqual([])
  })
})
