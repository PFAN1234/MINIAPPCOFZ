const colador = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' })

/** Comparação alfabética natural: "Apto. 101" < "Apto. 102" < "Apto. 110". */
export function compararNatural(a: string, b: string): number {
  return colador.compare(a, b)
}

export function ordenarNatural<T>(itens: readonly T[], chave: (item: T) => string): T[] {
  return [...itens].sort((a, b) => compararNatural(chave(a), chave(b)))
}
