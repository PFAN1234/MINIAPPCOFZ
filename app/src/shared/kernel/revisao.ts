/** Revisão de planta/modelo: letras, dígitos, ponto, hífen ou sublinhado (ex.: R07), até 20 caracteres. */
export const REVISAO_VALIDA = /^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/
