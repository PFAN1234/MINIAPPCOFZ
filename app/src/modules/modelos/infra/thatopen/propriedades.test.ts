import { describe, expect, it } from 'vitest'
import { gruposDeDados, type DadosBrutos } from './propriedades.ts'

const v = (value: unknown, type = 'IFCLABEL') => ({ value, type })

const exemplo: DadosBrutos = {
  _category: v('IFCWALL'),
  _guid: v('3cUkl32yn9qRSPvBJVyWYp'),
  Name: v('Parede 1'),
  Tag: v('T-1'),
  Vazio: v(''),
  IsDefinedBy: [
    {
      _category: v('IFCPROPERTYSET'),
      Name: v('Pset_WallCommon'),
      HasProperties: [
        { Name: v('IsExternal'), NominalValue: v(true, 'IFCBOOLEAN') },
        { Name: v('FireRating'), NominalValue: v('') },
        { Name: v('Espessura'), NominalValue: v(0.15, 'IFCLENGTHMEASURE') },
      ],
    },
    {
      _category: v('IFCELEMENTQUANTITY'),
      Name: v('Qto_WallBaseQuantities'),
      Quantities: [{ Name: v('Length'), LengthValue: v(3) }],
    },
  ],
  IsTypedBy: [{ _category: v('IFCWALLTYPE'), Name: v('Parede 15cm') }],
  HasAssociations: [
    { _category: v('IFCMATERIAL'), Name: v('Concreto') },
    { _category: v('IFCCLASSIFICATIONREFERENCE'), Name: v('Ignorar') },
  ],
  ContainedInStructure: [{ _category: v('IFCBUILDINGSTOREY'), Name: v('Térreo') }],
}

describe('gruposDeDados', () => {
  const grupos = gruposDeDados(exemplo)
  const por = (nome: string) => grupos.find((g) => g.nome === nome)

  it('monta os atributos diretos com classe e GlobalId', () => {
    expect(por('Atributos')?.itens).toEqual([
      { nome: 'Classe', valor: 'IFCWALL' },
      { nome: 'GlobalId', valor: '3cUkl32yn9qRSPvBJVyWYp' },
      { nome: 'Name', valor: 'Parede 1' },
      { nome: 'Tag', valor: 'T-1' },
    ])
  })
  it('um grupo por pset, ignorando valores vazios e formatando números e booleanos', () => {
    expect(por('Pset_WallCommon')?.itens).toEqual([
      { nome: 'IsExternal', valor: 'Sim' },
      { nome: 'Espessura', valor: '0,15' },
    ])
  })
  it('quantidades, tipo, material e localização', () => {
    expect(por('Qto_WallBaseQuantities')).toMatchObject({ quantidades: true, itens: [{ nome: 'Length', valor: '3' }] })
    expect(por('Tipo')?.itens[0]).toEqual({ nome: 'Nome', valor: 'Parede 15cm' })
    expect(por('Material')?.itens).toEqual([{ nome: 'Material', valor: 'Concreto' }])
    expect(por('Localização')?.itens).toEqual([{ nome: 'Pavimento', valor: 'Térreo' }])
  })
  it('sem relações devolve só os atributos', () => {
    expect(gruposDeDados({ _category: v('IFCSLAB') }).map((g) => g.nome)).toEqual(['Atributos'])
  })
})
