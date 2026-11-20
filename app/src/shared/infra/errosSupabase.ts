/** Códigos do PostgREST/Postgres para tabela ou coluna inexistente (banco sem a migration). */
export function erroDeEsquemaAusente(err: { code?: string } | null): boolean {
  return Boolean(err && (err.code === '42P01' || err.code === '42703' || err.code === 'PGRST204' || err.code === 'PGRST205'))
}

export function erroDeColunaAusente(err: { code?: string } | null): boolean {
  return Boolean(err && (err.code === '42703' || err.code === 'PGRST204'))
}
