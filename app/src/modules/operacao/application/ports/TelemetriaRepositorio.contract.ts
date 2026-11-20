import { describe, expect, it } from 'vitest'
import type { TelemetriaRepositorio } from './TelemetriaRepositorio.port.ts'

/** Contrato reutilizável de `TelemetriaRepositorio`. */
export function contratoTelemetria(nome: string, criar: () => TelemetriaRepositorio) {
  describe(`TelemetriaRepositorio (${nome})`, () => {
    it('lista erros do cliente respeitando o limite', async () => {
      const repo = criar()
      const todos = await repo.listarErrosCliente()
      expect(todos.length).toBeGreaterThan(0)
      const limitado = await repo.listarErrosCliente(1)
      expect(limitado).toHaveLength(1)
    })

    it('devolve resumo de arquivos órfãos por bucket e maiores', async () => {
      const repo = criar()
      const resumo = await repo.resumoOrfaos()
      expect(Array.isArray(resumo.buckets)).toBe(true)
      expect(Array.isArray(resumo.maiores)).toBe(true)
      expect(resumo.buckets.length).toBeGreaterThan(0)
    })
  })
}
