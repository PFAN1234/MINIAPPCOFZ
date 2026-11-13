import { describe, expect, it } from 'vitest'
import { aplicarEdicao, validarEdicao } from './edicao.js'
import type { Snapshot } from './tipos.js'

const foto = (path: string) => ({ path, largura: 10, altura: 10 })
const base = (): Snapshot =>
  ({
    versao: 1,
    data: '2026-11-10',
    fuso: 'America/Fortaleza',
    organizacao: { nome: 'x', cabecalho: [], logo_path: null },
    etapa: {} as Snapshot['etapa'],
    responsaveis: [],
    indicadores: {} as Snapshot['indicadores'],
    clima: { indisponivel: true, motivo: 'm' },
    obras: [
      {
        id: 'o1',
        nome: 'Obra',
        slug: 'obra',
        servicos: [
          { id: 's1', pavimento: 'T', ambiente: 'A', hora: '08:00', autor: 'a', legenda: 'um', fotos: [foto('f1'), foto('f2')] },
          { id: 's2', pavimento: 'T', ambiente: 'A', hora: '09:00', autor: 'a', legenda: 'dois', fotos: [] },
        ],
        pendencias_abertas: [{ id: 'a1', pavimento: 'T', ambiente: 'A', hora: '08:00', autor: 'a', legenda: 'ab', fotos: [] }],
        pendencias_encerradas: [
          {
            id: 'e1',
            pavimento: 'T',
            ambiente: 'A',
            aberta_em: '2026-11-01',
            dias_aberta: 9,
            legenda: 'enc',
            fotos_registro: [foto('f3')],
            encerramento: { hora: '10:00', autor: 'b', observacao: 'obs', fotos: [foto('f4'), foto('f1')] },
          },
        ],
        observacoes: [
          { hora: '08:00', autor: 'a', texto: 'o0', editada: false },
          { hora: '09:00', autor: 'a', texto: 'o1', editada: false },
        ],
      },
    ],
    tardios: [
      { id: 't1', tipo: 'servico', data: '2026-11-10', hora: null, recebido_em: null, obra: 'Obra', ambiente: null, autor: 'a', texto: 'tarde' },
      { id: 't2', tipo: 'servico', data: '2026-11-10', hora: null, recebido_em: null, obra: 'Obra', ambiente: null, autor: 'a', texto: 'tarde2' },
    ],
  }) as Snapshot

describe('aplicarEdicao', () => {
  it('edição vazia mantém o conteúdo e não altera o original', () => {
    const s = base()
    const copia = structuredClone(s)
    expect(aplicarEdicao(s, {})).toEqual(copia)
    aplicarEdicao(s, { textos: { 'servico:s1': 'x' }, ocultos: ['servico:s2'], fotos_ocultas: ['f1'] })
    expect(s).toEqual(copia)
  })

  it('troca textos com trim e vazio vira null nas legendas e no encerramento', () => {
    const r = aplicarEdicao(base(), {
      textos: { 'servico:s1': '  novo  ', 'aberta:a1': '   ', 'encerrada:e1': 'x', 'encerramento:e1': '' },
    })
    const o = r.obras[0]!
    expect(o.servicos[0]!.legenda).toBe('novo')
    expect(o.pendencias_abertas[0]!.legenda).toBeNull()
    expect(o.pendencias_encerradas[0]!.legenda).toBe('x')
    expect(o.pendencias_encerradas[0]!.encerramento.observacao).toBeNull()
  })

  it('troca ou oculta observações (por índice) e tardios', () => {
    const r = aplicarEdicao(base(), { textos: { 'observacao:o1:0': ' n ', 'observacao:o1:1': ' ', 'tardio:t1': 'y', 'tardio:t2': '' } })
    expect(r.obras[0]!.observacoes.map((o) => o.texto)).toEqual(['n'])
    expect(r.tardios.map((t) => t.texto)).toEqual(['y'])
    const r2 = aplicarEdicao(base(), { ocultos: ['observacao:o1:0', 'tardio:t1'] })
    expect(r2.obras[0]!.observacoes.map((o) => o.texto)).toEqual(['o1'])
    expect(r2.tardios.map((t) => t.id)).toEqual(['t2'])
  })

  it('oculta registros e o encerramento não pode ser ocultado', () => {
    const r = aplicarEdicao(base(), { ocultos: ['servico:s1', 'aberta:a1', 'encerramento:e1'] })
    expect(r.obras[0]!.servicos.map((s) => s.id)).toEqual(['s2'])
    expect(r.obras[0]!.pendencias_abertas).toEqual([])
    expect(r.obras[0]!.pendencias_encerradas).toHaveLength(1)
    expect(aplicarEdicao(base(), { ocultos: ['encerrada:e1'] }).obras[0]!.pendencias_encerradas).toEqual([])
  })

  it('oculta fotos em todos os lugares e ignora chaves inexistentes', () => {
    const r = aplicarEdicao(base(), { fotos_ocultas: ['f1', 'f3'], textos: { 'servico:zz': 'x' }, ocultos: ['tardio:zz'] })
    const o = r.obras[0]!
    expect(o.servicos[0]!.fotos.map((f) => f.path)).toEqual(['f2'])
    expect(o.pendencias_encerradas[0]!.fotos_registro).toEqual([])
    expect(o.pendencias_encerradas[0]!.encerramento.fotos.map((f) => f.path)).toEqual(['f4'])
    expect(r.tardios).toHaveLength(2)
    expect(r.clima).toEqual(base().clima)
  })
})

describe('validarEdicao', () => {
  it('aceita formato válido e recusa inválidos', () => {
    expect(validarEdicao({ textos: { a: 'b' }, ocultos: ['x'] })).toEqual({ textos: { a: 'b' }, ocultos: ['x'] })
    for (const ruim of [null, [], 'x', { outra: 1 }, { textos: { a: 1 } }, { textos: [] }, { ocultos: 'x' }, { fotos_ocultas: [1] }, { textos: { a: 'x'.repeat(2001) } }]) {
      expect(() => validarEdicao(ruim)).toThrow('Edição do boletim inválida')
    }
  })
})
