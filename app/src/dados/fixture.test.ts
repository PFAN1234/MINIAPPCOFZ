import { describe, expect, it } from 'vitest'
import { criarRepositorioFixture, urlLocalDaImagem } from './fixture.ts'

const repo = criarRepositorioFixture()

describe('repositório fixture', () => {
  it('lista duas obras, a segunda vazia', async () => {
    const obras = await repo.listarObras()
    expect(obras.map((o) => o.slug)).toEqual(['hto', 'aurora'])
    const vazia = await repo.obterObra('aurora')
    expect(vazia.ambientes).toEqual([])
  })

  it('HTO tem 2 pavimentos com planta, 87 ambientes e 3 pendências abertas', async () => {
    const { pavimentos, ambientes } = await repo.obterObra('hto')
    expect(pavimentos.map((p) => p.planta?.revisao)).toEqual(['R05', 'R05'])
    expect(ambientes).toHaveLength(87)
    const abertas = ambientes.reduce((s, a) => s + a.pendencias_abertas, 0)
    expect(abertas).toBe(3)
  })

  it('obterAmbiente traz pavimento, planta e detalhe', async () => {
    const d = await repo.obterAmbiente('hto', 'terreo-apto-101')
    expect(d.ambiente.nome_operacional).toBe('Apto. 101')
    expect(d.pavimento.codigo).toBe('terreo')
    expect(d.planta?.imagem.path).toMatch(/\/R05\/terreo\/planta\.webp$/)
    expect(d.detalhe?.imagem.path).toMatch(/ambientes\/terreo-apto-101\.webp$/)
    await expect(repo.obterAmbiente('hto', 'nao-existe')).rejects.toThrow()
  })

  it('filtra registros e ordena do mais recente', async () => {
    const abertas = await repo.listarRegistros({ tipo: 'pendencia', situacao: 'aberta' })
    expect(abertas).toHaveLength(3)
    const todos = await repo.listarRegistros({})
    expect(todos).toHaveLength(6)
    const datas = todos.map((r) => r.recebido_em)
    expect(datas).toEqual([...datas].sort().reverse())
    expect(await repo.listarRegistros({ limite: 5 })).toHaveLength(5)
  })

  it('mapeia caminhos do bucket para a URL local', async () => {
    const path = 'obra-id/R05/terreo/planta.webp'
    expect(urlLocalDaImagem(path)).toBe('/__plantas/R05/terreo/planta.webp')
    expect(await repo.urlsImagens([path])).toEqual({ [path]: '/__plantas/R05/terreo/planta.webp' })
  })
})
