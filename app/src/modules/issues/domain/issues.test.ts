import { describe, expect, it } from 'vitest'
import {
  caminhoImagemVista,
  contarPorStatus,
  filtrarPorStatus,
  ordenarIssues,
  problemaComentario,
  problemaImagemVista,
  problemaIssue,
  problemaPrazo,
  problemaTitulo,
  ROTULO_PRIORIDADE,
  ROTULO_STATUS,
  ROTULO_TIPO,
  type Issue,
} from './issues.ts'

const i = (numero: number, extra: Partial<Issue> = {}) =>
  ({ numero, status: 'aberta', prioridade: 'normal', prazo: null, atualizadoEm: '2026-11-01T00:00:00Z', ...extra }) as Issue

describe('rótulos', () => {
  it('em português', () => {
    expect(ROTULO_STATUS.em_andamento).toBe('Em andamento')
    expect(ROTULO_PRIORIDADE.critica).toBe('Crítica')
    expect(ROTULO_TIPO.duvida).toBe('Dúvida')
  })
})

describe('validações', () => {
  it('título: 1 a 200 após aparar', () => {
    expect(problemaTitulo('   ')).not.toBeNull()
    expect(problemaTitulo(' ok ')).toBeNull()
    expect(problemaTitulo('a'.repeat(200))).toBeNull()
    expect(problemaTitulo('a'.repeat(201))).not.toBeNull()
  })
  it('comentário: 1 a 5000', () => {
    expect(problemaComentario('')).not.toBeNull()
    expect(problemaComentario('x'.repeat(5000))).toBeNull()
    expect(problemaComentario('x'.repeat(5001))).not.toBeNull()
  })
  it('prazo: vazio ou data real', () => {
    expect(problemaPrazo(null)).toBeNull()
    expect(problemaPrazo('2026-12-31')).toBeNull()
    expect(problemaPrazo('2026-02-30')).not.toBeNull()
    expect(problemaPrazo('31/12/2026')).not.toBeNull()
  })
  it('problemaIssue só confere o que veio', () => {
    expect(problemaIssue({})).toBeNull()
    expect(problemaIssue({ titulo: '' })).not.toBeNull()
    expect(problemaIssue({ status: 'x' as never })).not.toBeNull()
    expect(problemaIssue({ prazo: 'ontem' })).not.toBeNull()
  })
  it('imagem da vista: PNG até 5 MB', () => {
    expect(problemaImagemVista(new Blob([new Uint8Array(3)], { type: 'image/png' }))).toBeNull()
    expect(problemaImagemVista(new Blob([new Uint8Array(3)], { type: 'image/jpeg' }))).not.toBeNull()
    expect(problemaImagemVista(new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: 'image/png' }))).not.toBeNull()
  })
  it('caminho da imagem', () => {
    expect(caminhoImagemVista('o', 'i', 'v')).toBe('o/i/v.png')
  })
})

describe('filtro, ordem e contagem', () => {
  const lista = [
    i(1, { status: 'fechada', prioridade: 'baixa', prazo: '2026-12-01' }),
    i(2, { status: 'em_andamento', prioridade: 'critica' }),
    i(3, { status: 'aberta', prioridade: 'alta', prazo: '2026-11-30', atualizadoEm: '2026-11-05T00:00:00Z' }),
    i(4, { status: 'resolvida' }),
  ]
  it('filtra', () => {
    expect(filtrarPorStatus(lista, 'todas')).toHaveLength(4)
    expect(filtrarPorStatus(lista, 'abertas').map((x) => x.numero)).toEqual([2, 3])
    expect(filtrarPorStatus(lista, 'fechada').map((x) => x.numero)).toEqual([1])
  })
  it('ordena sem alterar a original', () => {
    expect(ordenarIssues(lista, 'numero').map((x) => x.numero)).toEqual([4, 3, 2, 1])
    expect(ordenarIssues(lista, 'prioridade').map((x) => x.numero)).toEqual([2, 3, 4, 1])
    expect(ordenarIssues(lista, 'prazo').map((x) => x.numero)).toEqual([3, 1, 4, 2])
    expect(ordenarIssues(lista, 'atualizacao')[0].numero).toBe(3)
    expect(lista[0].numero).toBe(1)
  })
  it('conta por status', () => {
    expect(contarPorStatus(lista)).toEqual({ aberta: 1, em_andamento: 1, resolvida: 1, fechada: 1 })
  })
})
