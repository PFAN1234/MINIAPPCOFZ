import { describe, expect, it } from 'vitest'
import { agregarCategorias, filhosVisiveis, montarArvore, nivelDaClasse, progressoAgregado, type NoEstrutura } from './central.ts'

const ESTRUTURA: NoEstrutura = {
  category: 'IFCPROJECT',
  localId: 1,
  children: [
    {
      category: 'IFCSITE',
      localId: 2,
      children: [
        {
          category: 'IFCBUILDING',
          localId: 3,
          children: [
            {
              category: 'IFCBUILDINGSTOREY',
              localId: 4,
              children: [
                { category: 'IFCWALL', localId: 10 },
                { category: 'IFCDOOR', localId: 11 },
                { category: null, localId: null, children: [{ category: 'IFCSLAB', localId: 12 }] },
              ],
            },
          ],
        },
      ],
    },
  ],
}

describe('nivelDaClasse', () => {
  it('reconhece a hierarquia espacial e trata o resto como elemento', () => {
    expect(nivelDaClasse('IfcProject')).toBe('projeto')
    expect(nivelDaClasse('IFCBUILDING')).toBe('edificio')
    expect(nivelDaClasse('IFCBUILDINGSTOREY')).toBe('pavimento')
    expect(nivelDaClasse('IFCSITE')).toBe('outro')
    expect(nivelDaClasse('IFCWALL')).toBe('elemento')
  })
})

describe('montarArvore', () => {
  const dados = {
    nomes: new Map([
      [1, 'Hospital'],
      [4, 'Térreo'],
      [10, 'Parede 1'],
    ]),
    guids: new Map([
      [10, 'G10'],
      [11, 'G11'],
      [12, 'G12'],
    ]),
  }
  const raiz = montarArvore('ARQ', ESTRUTURA, dados)

  it('monta projeto › sítio › edifício › pavimento › elementos', () => {
    expect(raiz.nivel).toBe('projeto')
    expect(raiz.rotulo).toBe('ARQ — Hospital')
    const pav = raiz.filhos[0].filhos[0].filhos[0]
    expect(pav.nivel).toBe('pavimento')
    expect(pav.rotulo).toBe('Térreo')
    expect(pav.filhos).toHaveLength(3)
  })

  it('elementos levam a referência com sigla, GlobalId, classe e nome', () => {
    const pav = raiz.filhos[0].filhos[0].filhos[0]
    expect(pav.filhos[0].ref).toEqual({ sigla: 'ARQ', globalId: 'G10', classe: 'IFCWALL', nome: 'Parede 1' })
    expect(pav.filhos[1].rotulo).toBe('IFCDOOR #11')
    expect(pav.filhos[1].ref).toEqual({ sigla: 'ARQ', globalId: 'G11', classe: 'IFCDOOR' })
    expect(raiz.ref).toBeUndefined()
  })

  it('nó sem id local vira agrupador sem ref e os ids são únicos', () => {
    const pav = raiz.filhos[0].filhos[0].filhos[0]
    const grupo = pav.filhos[2]
    expect(grupo.nivel).toBe('outro')
    expect(grupo.ref).toBeUndefined()
    expect(grupo.filhos[0].ref?.globalId).toBe('G12')
    const ids: string[] = []
    const visitar = (n: typeof raiz) => (ids.push(n.id), n.filhos.forEach(visitar))
    visitar(raiz)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('sem nome no projeto, o rótulo é a sigla', () => {
    expect(montarArvore('EST', ESTRUTURA, { nomes: new Map(), guids: new Map() }).rotulo).toBe('EST')
  })
})

describe('agregarCategorias', () => {
  it('soma entre modelos e ordena por total', () => {
    const r = agregarCategorias([
      [
        { classe: 'IFCWALL', total: 5 },
        { classe: 'IFCDOOR', total: 2 },
      ],
      [
        { classe: 'IFCDOOR', total: 4 },
        { classe: 'IFCSLAB', total: 6 },
      ],
    ])
    expect(r).toEqual([
      { classe: 'IFCSLAB', total: 6 },
      { classe: 'IFCDOOR', total: 6 },
      { classe: 'IFCWALL', total: 5 },
    ].sort((a, b) => b.total - a.total || a.classe.localeCompare(b.classe)))
  })
})

describe('filhosVisiveis', () => {
  const lista = Array.from({ length: 450 }, (_, i) => i)
  it('mostra 200 por vez', () => {
    expect(filhosVisiveis(lista, 1)).toMatchObject({ restantes: 250 })
    expect(filhosVisiveis(lista, 1).itens).toHaveLength(200)
    expect(filhosVisiveis(lista, 3)).toMatchObject({ restantes: 0 })
    expect(filhosVisiveis(lista, 3).itens).toHaveLength(450)
  })
})

describe('progressoAgregado', () => {
  it('pondera as etapas e limita a 0..1', () => {
    expect(progressoAgregado([{ peso: 1, fracao: 1 }, { peso: 1, fracao: 0 }])).toBe(0.5)
    expect(progressoAgregado([{ peso: 1, fracao: 3 }])).toBe(1)
    expect(progressoAgregado([])).toBe(0)
  })
})
