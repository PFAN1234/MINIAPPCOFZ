export type Tema = 'escuro' | 'claro'

export const CHAVE_TEMA = 'central.tema'

/** Tema salvo; escuro quando não há preferência ou o armazenamento falha. */
export function lerTema(): Tema {
  try {
    return localStorage.getItem(CHAVE_TEMA) === 'claro' ? 'claro' : 'escuro'
  } catch {
    return 'escuro'
  }
}

/** Grava a preferência; falha de armazenamento é ignorada. */
export function gravarTema(tema: Tema): void {
  try {
    localStorage.setItem(CHAVE_TEMA, tema)
  } catch {
    // sem localStorage: vale só nesta sessão
  }
}
