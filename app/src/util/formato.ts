const dataHora = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
})

const numeroArea = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** "09/11, 10:20" (horário de Brasília). */
export function formatarDataHora(iso: string): string {
  return dataHora.format(new Date(iso))
}

/** "agora", "há 5 min", "há 3 h", "há 2 d"; vazio depois de 7 dias. */
export function formatarRelativo(iso: string, agora: number = Date.now()): string {
  const min = Math.floor((agora - new Date(iso).getTime()) / 60_000)
  if (min < 0) return ''
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.floor(h / 24)
  return d < 7 ? `há ${d} d` : ''
}

/** "23,88 m²" ou `null` sem área. */
export function formatarArea(area: number | null): string | null {
  return area === null ? null : `${numeroArea.format(area)} m²`
}

export function textoServicos(n: number): string {
  return n === 1 ? '1 serviço' : `${n} serviços`
}

export function textoPendenciasResolvidas(n: number): string {
  return n === 1 ? '1 pendência resolvida' : `${n} pendências resolvidas`
}

export function textoPendencias(n: number): string {
  return n === 1 ? '1 pendência aberta' : `${n} pendências abertas`
}
