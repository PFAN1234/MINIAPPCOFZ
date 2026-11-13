import type { BoletimEmitido, EstadoEmissao } from '../../dados/tipos.ts'

export const ROTULO_ESTADO: Record<EstadoEmissao, string> = {
  pendente: 'na fila',
  gerando: 'gerando',
  emitido: 'emitido',
  falhou: 'falhou',
}

/** Situação do envio ao Telegram (`publicacao_telegram.estado`). */
export function rotuloPublicacao(b: BoletimEmitido): string {
  if (b.publicado) return 'publicado'
  if (b.publicacao_estado === 'falhou') return 'falhou'
  if (b.publicacao_estado === 'incerto') return 'incerto (conferir no grupo)'
  if (b.publicacao_estado === 'enviando') return 'enviando'
  return 'aguardando'
}

/** Abre a URL numa aba nova; devolve false se o navegador bloquear. */
export function abrir(url: string): boolean {
  const aba = window.open(url, '_blank')
  if (aba) aba.opener = null
  return aba !== null
}
