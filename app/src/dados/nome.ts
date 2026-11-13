/** Nome mostrado de uma pessoa: o de exibição (definido pelo admin) ou, sem ele, o do Telegram. */
export function nomeMostrado(
  u: { nome?: unknown; nome_exibicao?: unknown } | null | undefined,
): string | null {
  const exibicao = typeof u?.nome_exibicao === 'string' ? u.nome_exibicao.trim() : ''
  if (exibicao) return exibicao
  const nome = typeof u?.nome === 'string' ? u.nome.trim() : ''
  return nome || null
}
