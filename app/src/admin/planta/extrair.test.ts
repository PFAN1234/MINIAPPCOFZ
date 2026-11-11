// @vitest-environment node
/** Port de tests/test_revisoes.py e dos casos sintéticos de tests/test_ambientes.py. */
import { describe, expect, it } from 'vitest'
import {
  categoria,
  diferencasVazias,
  extrair,
  LIMIAR_DESLOCAMENTO,
  nomeOperacional,
  parearRotulos,
  slug,
  temDiferencas,
  validarObra,
} from './extrair.ts'
import { obraSintetica, paginaDeSpans, paginas, R01, R02, rotulo } from './sinteticos.ts'
import type { BaseExtracao, ObraConfig, PaginaLida, ResultadoExtracao, Span } from './tipos.ts'

function rodar(obra: ObraConfig, pags: Record<string, PaginaLida>, base: ResultadoExtracao | null = null) {
  validarObra(obra)
  return extrair(obra, pags, base ? (JSON.parse(JSON.stringify(base)) as BaseExtracao) : null)
}

const ids = (r: ResultadoExtracao) => r.ambientes.map((a) => a.id)
const r01 = rodar(obraSintetica(), R01)
const r02 = rodar(obraSintetica('R02'), R02, r01)

describe('revisões (tests/test_revisoes.py)', () => {
  it('sem base: comportamento atual', () => {
    expect(ids(r01)).toEqual(['terreo-copa', 'terreo-dml', 'terreo-recepcao'])
    expect(r01.ambientes_removidos).toEqual([])
    expect(r01.diferencas).toEqual(diferencasVazias())
    expect(temDiferencas(r01.diferencas)).toBe(false)
  })

  it('id igual mantido e idempotente', () => {
    const deNovo = rodar(obraSintetica(), R01, r01)
    expect(ids(deNovo)).toEqual(ids(r01))
    expect(deNovo.ambientes_removidos).toEqual([])
    expect(temDiferencas(deNovo.diferencas)).toBe(false)
    expect(rodar(obraSintetica(), R01, deNovo)).toEqual(deNovo)
  })

  it('nova revisão relata novos, removidos e área', () => {
    const dif = r02.diferencas
    expect(dif.revisao_base).toBe('R01')
    expect(dif.novos.map((n) => n.id)).toEqual(['terreo-cozinha', 'terreo-sala-nova'])
    expect(dif.removidos.map((r) => r.id)).toEqual(['terreo-copa', 'terreo-dml'])
    expect(dif.area_alterada).toEqual([{ id: 'terreo-recepcao', nome_operacional: 'Recepção', antes: 20.49, depois: 21 }])
    expect(dif.herdados).toEqual([])
    expect(dif.nome_alterado).toEqual([])
    expect(dif.marcador_deslocado).toEqual([])
  })

  it('removido entra em ambientes_removidos com sucessor', () => {
    expect(r02.ambientes_removidos).toEqual([
      { id: 'terreo-copa', pavimento: 'terreo', nome_operacional: 'Copa', revisao_ultima: 'R01' },
      { id: 'terreo-dml', pavimento: 'terreo', nome_operacional: 'Dml', revisao_ultima: 'R01' },
    ])
    const [copa, dml] = r02.diferencas.removidos
    expect(copa.sucessor_sugerido?.id).toBe('terreo-cozinha')
    expect(copa.sucessor_sugerido?.motivo).toContain('pino a 0,000')
    expect(copa.sucessor_sugerido?.motivo).toContain('mesma área')
    expect(dml.sucessor_sugerido).toBeNull()
    expect(ids(r02)).toContain('terreo-cozinha')
    expect(ids(r02)).not.toContain('terreo-copa')
  })

  it('nova revisão rodada de novo dá o mesmo resultado', () => {
    expect(rodar(obraSintetica('R02'), R02, r02)).toEqual(r02)
  })

  it('manter_codigo herda o código antigo', () => {
    const obra = obraSintetica('R02', { manter_codigo: { 'terreo-cozinha': 'terreo-copa' } })
    const res = rodar(obra, R02, r02)
    const cozinha = res.ambientes.find((a) => a.nome_planta === 'COZINHA')!
    expect(cozinha.id).toBe('terreo-copa')
    expect(cozinha.nome_operacional).toBe('Cozinha')
    expect(res.ambientes_removidos.map((r) => r.id)).toEqual(['terreo-dml'])
    expect(res.diferencas.herdados).toEqual([
      {
        id: 'terreo-copa',
        id_calculado: 'terreo-cozinha',
        pavimento: 'terreo',
        nome_antes: 'Copa',
        nome_operacional: 'Cozinha',
        reativado: false,
      },
    ])
    expect(res.diferencas.novos.map((n) => n.id)).toEqual(['terreo-sala-nova'])
    expect(res.diferencas.removidos.map((r) => r.id)).toEqual(['terreo-dml'])
    expect(res.diferencas.revisao_base).toBe('R01')
    expect(rodar(obra, R02, r01)).toEqual(res)
    expect(rodar(obra, R02, res)).toEqual(res)
  })

  it('manter_codigo reativa id de removidos', () => {
    const r03 = paginas(
      ['COZINHA', '15.16', 240, 300],
      ['SALA NOVA', '9.00', 100, 50],
      ['RECEPÇÃO', '21.00', 800, 100],
      ['DEPÓSITO', '2.90', 600, 300],
    )
    const obra = obraSintetica('R03', { manter_codigo: { 'terreo-deposito': 'terreo-dml' } })
    const res = rodar(obra, r03, r02)
    expect(ids(res)).toContain('terreo-dml')
    expect(res.ambientes_removidos.map((r) => r.id)).toEqual(['terreo-copa'])
    expect(res.diferencas.herdados).toEqual([
      {
        id: 'terreo-dml',
        id_calculado: 'terreo-deposito',
        pavimento: 'terreo',
        nome_antes: 'Dml',
        nome_operacional: 'Depósito',
        reativado: true,
      },
    ])
    expect(rodar(obra, r03, res)).toEqual(res)
  })

  it.each([
    [{ 'terreo-inexistente': 'terreo-copa' }, 'sem ambiente correspondente'],
    [{ 'terreo-cozinha': 'terreo-nunca-existiu' }, 'não existem na base'],
    [{ 'terreo-cozinha': 'terreo-recepcao' }, 'colide'],
    [{ 'terreo-cozinha': 'terreo-copa', 'terreo-sala-nova': 'terreo-copa' }, 'mesmo id antigo'],
    [{ 'terreo-cozinha': 'terreo-cozinha' }, 'igual ao antigo'],
  ])('manter_codigo inválido falha (%j)', (manter, erro) => {
    expect(() => rodar(obraSintetica('R02', { manter_codigo: manter }), R02, r01)).toThrow(erro)
  })

  it('manter_codigo entre pavimentos falha', () => {
    const base = JSON.parse(JSON.stringify(r01)) as ResultadoExtracao
    base.ambientes_removidos = [{ id: '1pav-copa', pavimento: '1pav', nome_operacional: 'Copa', revisao_ultima: 'R00' }]
    expect(() => rodar(obraSintetica('R02', { manter_codigo: { 'terreo-cozinha': '1pav-copa' } }), R02, base)).toThrow(
      'pavimentos diferentes',
    )
  })

  it('manter_codigo sem base falha e mal formado falha', () => {
    expect(() => rodar(obraSintetica('R02', { manter_codigo: { 'terreo-cozinha': 'terreo-copa' } }), R02)).toThrow('base')
    expect(() => validarObra(obraSintetica('R01', { manter_codigo: ['terreo-copa'] as never }))).toThrow('manter_codigo')
  })

  it('removidos acumulam e ambiente que volta sai', () => {
    const res3 = rodar(obraSintetica('R03'), paginas(['COZINHA', '15.16', 240, 300], ['RECEPÇÃO', '21.00', 800, 100]), r02)
    expect(res3.ambientes_removidos.map((r) => r.id)).toEqual(['terreo-copa', 'terreo-dml', 'terreo-sala-nova'])
    expect(res3.ambientes_removidos.find((r) => r.id === 'terreo-dml')?.revisao_ultima).toBe('R01')
    expect(res3.diferencas.removidos.map((r) => r.id)).toEqual(['terreo-sala-nova'])
    const res4 = rodar(
      obraSintetica('R04'),
      paginas(['COZINHA', '15.16', 240, 300], ['RECEPÇÃO', '21.00', 800, 100], ['DML', '2.90', 600, 300]),
      res3,
    )
    expect(ids(res4)).toContain('terreo-dml')
    expect(res4.ambientes_removidos.map((r) => r.id)).toEqual(['terreo-copa', 'terreo-sala-nova'])
    expect(res4.diferencas.novos.map((n) => n.id)).toEqual(['terreo-dml'])
  })

  it('nome alterado mantendo o código e pino deslocado', () => {
    const pags = paginas(['COPA', '15.16', 240, 300], ['DML', '2.90', 600, 300], ['RECEPÇÃO', '20.49', 850, 150])
    const res = rodar(obraSintetica('R02', { nomes_fixos: { COPA: 'COPA' } }), pags, r01)
    expect(res.diferencas.nome_alterado).toEqual([{ id: 'terreo-copa', antes: 'Copa', depois: 'COPA' }])
    expect(res.diferencas.marcador_deslocado.map((d) => d.id)).toEqual(['terreo-recepcao'])
    expect(res.diferencas.marcador_deslocado[0].distancia!).toBeGreaterThan(LIMIAR_DESLOCAMENTO)
    expect(res.diferencas.novos).toEqual([])
    expect(res.diferencas.removidos).toEqual([])
  })
})

describe('regras do extrator (tests/test_ambientes.py)', () => {
  it.each([
    ['APTO. 101', 'Apto. 101'],
    ['APTO. AUTORIDADES (1)', 'Apto. Autoridades 1'],
    ['BHO AUT. (2)', 'Banheiro Autoridades 2'],
    ['BHO 101', 'Banheiro 101'],
    ['BHO TRIPULAÇÃO', 'Banheiro Tripulação'],
    ['JARDIM', 'Jardim'],
    ['VEST. FEM.', 'Vestiário feminino'],
  ])('nome operacional de %s', (entrada, esperado) => {
    expect(nomeOperacional(entrada, { 'VEST. FEM.': 'Vestiário feminino' })).toBe(esperado)
  })

  it('categorias e slug', () => {
    expect(categoria('APTO. 101')).toBe('apartamento')
    expect(categoria('WC PCD')).toBe('banheiro')
    expect(categoria('VEST. MASC.')).toBe('vestiario')
    expect(categoria('CIRCULAÇÃO')).toBe('circulacao')
    expect(categoria('JARDIM')).toBe('externa')
    expect(categoria('RECEPÇÃO')).toBe('servico')
    expect(categoria('SALA IMERSIVA')).toBe('area_comum')
    expect(categoria('COPA', { COPA: 'area_comum' })).toBe('area_comum')
    expect(slug('Circulação 1')).toBe('circulacao-1')
    expect(slug('DML / Rouparia')).toBe('dml-rouparia')
  })

  it('código de mobiliário colado não vira nome', () => {
    const mo = [
      { text: 'MO3', bbox: [262.0, 107.5, 275.0, 115.7], size: 6.0, direction: [1, 0] },
      { text: 'GD', bbox: [205.0, 104.0, 214.0, 112.2], size: 6.0, direction: [1, 0] },
    ] as never
    const spans = [...rotulo('SALA DE REUNIÕES', '30.77', 240, 100, mo), ...rotulo('COPA', '15.16', 240, 300)]
    const res = rodar(obraSintetica('R01', { nomes_fixos: { 'WC FEM': 'WC feminino' } }), paginaDeSpans(spans))
    expect(res.ambientes.map((a) => a.nome_planta).sort()).toEqual(['COPA', 'SALA DE REUNIÕES'])
  })

  it('nomes repetidos numerados e renomear por área', () => {
    const spans = [
      ...rotulo('CIRCULAÇÃO', '21.47', 100, 100),
      ...rotulo('CIRCULAÇÃO', '8.64', 400, 100),
      ...rotulo('CIRCULAÇÃO', '15.29', 700, 100),
      ...rotulo('WC FEM', '14.12', 100, 300),
    ]
    const fixos = { nomes_fixos: { 'WC FEM': 'WC feminino' } }
    let res = rodar(obraSintetica('R01', fixos), paginaDeSpans(spans))
    const nomes = (r: ResultadoExtracao) => Object.fromEntries(r.ambientes.map((a) => [String(a.area_m2), a.nome_operacional]))
    expect(nomes(res)).toEqual({ '8.64': 'Circulação 1', '15.29': 'Circulação 2', '21.47': 'Circulação 3', '14.12': 'WC feminino' })
    expect(res.ambientes.find((a) => a.nome_planta === 'WC FEM')?.categoria).toBe('banheiro')
    const renomear = [{ pavimento: 'terreo', nome_planta: 'CIRCULAÇÃO', area_m2: 21.47, nome_operacional: 'Corredor oeste' }]
    res = rodar(obraSintetica('R01', { ...fixos, renomear, categorias: { 'WC FEM': 'vestiario' } }), paginaDeSpans(spans))
    expect(nomes(res)).toEqual({ '8.64': 'Circulação 1', '15.29': 'Circulação 2', '21.47': 'Corredor oeste', '14.12': 'WC feminino' })
    expect(ids(res)).toContain('terreo-corredor-oeste')
    expect(res.ambientes.find((a) => a.nome_planta === 'WC FEM')?.categoria).toBe('vestiario')
  })

  it('renomear sem ambiente falha', () => {
    const renomear = [{ pavimento: 'terreo', nome_planta: 'CIRCULAÇÃO', area_m2: 99.0, nome_operacional: 'X' }]
    expect(() => rodar(obraSintetica('R01', { renomear }), paginaDeSpans(rotulo('CIRCULAÇÃO', '8.64', 100, 100)))).toThrow(
      'renomear',
    )
  })

  it('status revisado exige revisão da mesma planta; PDF de outra revisão falha', () => {
    expect(() =>
      validarObra(obraSintetica('R01', { status: 'revisado', revisao_humana: { revisao_planta: 'R00', decisoes: [] } })),
    ).toThrow('revisão humana')
    expect(() =>
      validarObra(obraSintetica('R01', { pavimentos: [{ codigo: 'terreo', nome: 'Térreo', pdf: 'X-R02.pdf' }] })),
    ).toThrow('revisão')
  })

  it('ambiente manual entra na lista ordenado', () => {
    const manuais = [
      { pavimento: 'terreo', nome_operacional: 'Banheiro da copa', categoria: 'banheiro', marcador: { x: 0.5, y: 0.25 } },
    ]
    const spans = [...rotulo('COPA', '15.16', 240, 300), ...rotulo('WC FEM', '14.12', 100, 300)]
    const res = rodar(
      obraSintetica('R01', { ambientes_manuais: manuais, nomes_fixos: { 'WC FEM': 'WC feminino' } }),
      paginaDeSpans(spans),
    )
    expect(res.ambientes.map((a) => a.nome_operacional)).toEqual(['Banheiro da copa', 'Copa', 'WC feminino'])
    const manual = res.ambientes[0]
    expect(manual.id).toBe('terreo-banheiro-da-copa')
    expect(manual.nome_planta).toBeNull()
    expect(manual.area_m2).toBeNull()
    expect(manual.marcadores).toEqual([{ x: 0.5, y: 0.25, rotulo_bbox: [0.5, 0.25, 0.5, 0.25] }])
    expect(res.revisar).toEqual([
      { pavimento: 'terreo', motivo: 'ambiente sem rótulo na planta; pino colocado à mão', nome: 'Banheiro da copa' },
    ])
  })

  it('ambiente manual inválido falha', () => {
    const fora = [{ pavimento: '1pav', nome_operacional: 'X', categoria: 'servico', marcador: { x: 0.5, y: 0.5 } }]
    expect(() => validarObra(obraSintetica('R01', { ambientes_manuais: fora }))).toThrow('pavimento')
    const longe = [{ pavimento: 'terreo', nome_operacional: 'X', categoria: 'servico', marcador: { x: 1.5, y: 0.5 } }]
    expect(() => validarObra(obraSintetica('R01', { ambientes_manuais: longe }))).toThrow('0–1')
  })

  it('rótulo duplo vira um ambiente com dois pinos; "Não incluso" sem área; área órfã', () => {
    const spans = [
      ...rotulo('CIRC. SUL', '30.00', 100, 100),
      ...rotulo('CIRC. SUL', '30.00', 500, 100),
      ...rotulo('JARDIM', 'Não incluso', 300, 300),
      { text: 'A=5.00 m²', bbox: [800, 400, 830, 406.6], size: 5.5, direction: [1, 0] } as Span,
    ]
    const res = rodar(obraSintetica(), paginaDeSpans(spans))
    expect(res.ambientes.map((a) => [a.id, a.marcadores.length, a.area_m2])).toEqual([
      ['terreo-circ-sul', 2, 30],
      ['terreo-jardim', 1, null],
    ])
    expect(res.revisar.map((r) => r.motivo)).toEqual([
      'área sem nome acima',
      'ambiente rotulado mais de uma vez; mantidos todos os pinos',
      "área marcada como 'Não incluso' na planta",
    ])
    expect(parearRotulos(spans).orfas).toEqual(['A=5.00 m²'])
  })

  it('marcadores_ajustados da revisão atual trocam os pinos e levam o rótulo junto', () => {
    const spans = [...rotulo('CIRC. SUL', '30.00', 100, 100), ...rotulo('CIRC. SUL', '30.00', 500, 100)]
    const obra = obraSintetica('R01', {
      marcadores_ajustados: {
        'terreo-circ-sul': { revisao: 'R01', marcadores: [{ x: 0.2, y: 0.3 }] },
        'terreo-outro': { revisao: 'R00', marcadores: [{ x: 0.5, y: 0.5 }] },
      },
    })
    const res = rodar(obra, paginaDeSpans(spans))
    const [a] = res.ambientes
    expect(a.marcadores).toHaveLength(1)
    expect(a.marcadores[0].x).toBe(0.2)
    expect(a.marcadores[0].y).toBe(0.3)
    // o rótulo andou o mesmo que o pino
    const original = rodar(obraSintetica(), paginaDeSpans(spans)).ambientes[0].marcadores[0]
    expect(a.marcadores[0].rotulo_bbox[0] - original.rotulo_bbox[0]).toBeCloseTo(0.2 - original.x, 6)
    expect(res.revisar.at(-1)).toEqual({ pavimento: 'terreo', motivo: 'pinos ajustados no editor', nome: 'Circ. sul' })
  })
})
