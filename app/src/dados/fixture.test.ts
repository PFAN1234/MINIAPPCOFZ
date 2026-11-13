import { describe, expect, it } from 'vitest'
import { criarRepositorioFixture, urlLocalDaImagem } from './fixture.ts'

const repo = criarRepositorioFixture()

describe('repositório fixture', () => {
  it('geometria da RA traz contornoPagina com os mesmos cantos do contorno, de 0 a 1', async () => {
    const g = await repo.obterGeometria({ id: 'o', slug: 'hto' }, { id: 'a', codigo: 'terreo-apto-101' })
    const pagina = g?.contornoPagina
    expect(pagina).toHaveLength(g!.contorno.length)
    for (const [x, y] of pagina!) {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(1)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(1)
    }
  })

  it('lista três obras em duas etapas; só a HTO tem ambientes', async () => {
    const obras = await repo.listarObras()
    expect(obras.map((o) => [o.slug, o.etapa.nome])).toEqual([
      ['hto', '2ª ETAPA'],
      ['aurora', '2ª ETAPA'],
      ['alojamentos', '3ª ETAPA'],
    ])
    const vazia = await repo.obterObra('aurora')
    expect(vazia.ambientes).toEqual([])
    expect((await repo.obterObra('alojamentos')).obra).toEqual({
      id: obras[2].id,
      slug: 'alojamentos',
      nome: 'Bloco de Alojamentos',
    })
  })

  it('organização "CO-FZ" sem logo por padrão; com logo quando pedido', async () => {
    expect(await repo.organizacao()).toEqual({ nome: 'CO-FZ', logo_url: null })
    expect(await criarRepositorioFixture({ logo: '/logo.png' }).organizacao()).toEqual({
      nome: 'CO-FZ',
      logo_url: '/logo.png',
    })
  })

  it('HTO tem 2 pavimentos com planta, 87 ambientes e 3 pendências abertas', async () => {
    const { pavimentos, ambientes } = await repo.obterObra('hto')
    expect(pavimentos.map((p) => p.planta?.revisao)).toEqual(['R05', 'R05'])
    expect(ambientes).toHaveLength(87)
    // A HTO não tem ambientes removidos (data/hto/ambientes.json): todos ativos.
    expect(ambientes.every((a) => a.ativo)).toBe(true)
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

describe('fixture: acesso', () => {
  it('há uma obra disponível e um pedido pendente da Maria na HTO', async () => {
    const r = criarRepositorioFixture()
    const [demo] = await r.obrasDisponiveis()
    expect(demo).toMatchObject({ nome: 'Obra Demonstração', solicitacao: null, etapa_nome: '2ª ETAPA' })
    expect((await r.obterObra('hto')).papel).toBe('gestor')
    const pedidos = await r.listarSolicitacoes((await r.obterObra('hto')).obra.id)
    expect(pedidos.map((p) => p.username)).toEqual(['maria'])
  })

  it('solicitar, decidir e localizar registro; decisão contrária conflita', async () => {
    const r = criarRepositorioFixture()
    const [demo] = await r.obrasDisponiveis()
    await r.solicitarAcesso(demo.id)
    expect((await r.obrasDisponiveis())[0].solicitacao).toBe('pendente')

    const hto = (await r.obterObra('hto')).obra.id
    const [pedido] = await r.listarSolicitacoes(hto)
    await r.decidirSolicitacao(pedido.id, true)
    await r.decidirSolicitacao(pedido.id, true)
    await expect(r.decidirSolicitacao(pedido.id, false)).rejects.toThrow('Pedido já decidido.')
    expect(await r.listarSolicitacoes(hto)).toEqual([])

    expect(await r.localizarRegistro('00000000-0000-4000-8000-000000000101')).toEqual({
      slug: 'hto',
      codigo: 'terreo-apto-101',
      tipo: 'pendencia',
    })
    expect(await r.localizarRegistro('inexistente')).toBeNull()
  })
})
