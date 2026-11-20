import type { ObraCentral } from '../../../domain/tipos.ts'

/** Obras usadas nos testes da central: uma com arquivos e uma sem. */
export const OBRAS: ObraCentral[] = [
  { obra_id: 'o1', slug: 'hto', nome: 'HTO', disciplinas: 1, documentos: 2, issues_abertas: 3, atualizado_em: '2026-11-10T12:00:00Z' },
  { obra_id: 'o2', slug: 'cofz', nome: 'COFZ', disciplinas: 0, documentos: 0, issues_abertas: 0, atualizado_em: null },
]
