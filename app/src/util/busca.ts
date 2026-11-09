/** Minúsculas e sem acento, para comparar buscas. */
export function normalizarTexto(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
}

/** Ambientes cujo nome operacional ou nome na planta contém a busca (sem acento, sem caixa). */
export function filtrarAmbientes<
  T extends { nome_operacional: string; nome_planta: string },
>(ambientes: readonly T[], busca: string): T[] {
  const termo = normalizarTexto(busca)
  if (!termo) return [...ambientes]
  return ambientes.filter(
    (a) =>
      normalizarTexto(a.nome_operacional).includes(termo) ||
      normalizarTexto(a.nome_planta).includes(termo),
  )
}
