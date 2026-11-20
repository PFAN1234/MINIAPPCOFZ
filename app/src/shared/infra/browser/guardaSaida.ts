/**
 * Guarda de saída: uma tela com alterações não salvas registra uma função que
 * decide se a navegação para trás pode seguir (normalmente, pedindo confirmação).
 * `useVoltar` consulta a guarda tanto para o Voltar do cabeçalho quanto para o
 * BackButton do Telegram.
 */
let guarda: (() => boolean) | null = null

/** Registra a guarda; devolve a função que a remove. */
export function registrarGuardaSaida(fn: () => boolean): () => void {
  guarda = fn
  return () => {
    if (guarda === fn) guarda = null
  }
}

/** True quando não há guarda ou quando ela autoriza a saída. */
export function podeSair(): boolean {
  return guarda ? guarda() : true
}
