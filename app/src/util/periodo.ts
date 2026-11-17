/** Período dos filtros de data, no fuso fixo de Fortaleza (−03:00), sem depender do fuso do aparelho. */
const DESLOCAMENTO = '-03:00'
const DATA = /^(\d{4})-(\d{2})-(\d{2})$/

/** Dia seguinte (`AAAA-MM-DD`) por aritmética de calendário em UTC. */
export function diaSeguinte(data: string): string {
  const m = DATA.exec(data)
  if (!m) return data
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + 1)).toISOString().slice(0, 10)
}

/** `de` vira o início do dia; `ate`, o início do dia seguinte (limite exclusivo). Data inválida é ignorada. */
export function limitesPeriodo(de?: string, ate?: string): { desde?: string; antes?: string } {
  return {
    desde: de && DATA.test(de) ? `${de}T00:00:00${DESLOCAMENTO}` : undefined,
    antes: ate && DATA.test(ate) ? `${diaSeguinte(ate)}T00:00:00${DESLOCAMENTO}` : undefined,
  }
}

/** O instante (ISO) cai dentro do período? */
export function dentroDoPeriodo(iso: string, de?: string, ate?: string): boolean {
  const { desde, antes } = limitesPeriodo(de, ate)
  const t = Date.parse(iso)
  return (!desde || t >= Date.parse(desde)) && (!antes || t < Date.parse(antes))
}
