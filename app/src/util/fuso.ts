/** Datas e horas no fuso da etapa (observações do dia). */

/** Fuso usado quando a etapa não informa o dela (o mesmo das datas do app). */
export const FUSO_PADRAO = 'America/Sao_Paulo'

function formatador(fuso: string, opcoes: Intl.DateTimeFormatOptions, local = 'pt-BR') {
  try {
    return new Intl.DateTimeFormat(local, { ...opcoes, timeZone: fuso })
  } catch {
    return new Intl.DateTimeFormat(local, { ...opcoes, timeZone: FUSO_PADRAO })
  }
}

/** Dia local (`AAAA-MM-DD`) de um instante num fuso IANA. */
export function dataNoFuso(instante: Date, fuso: string): string {
  return formatador(fuso, { year: 'numeric', month: '2-digit', day: '2-digit' }, 'en-CA').format(instante)
}

/** "14:32" no fuso. */
export function horaNoFuso(iso: string, fuso: string): string {
  return formatador(fuso, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso))
}

/** `AAAA-MM-DD` → `dd/mm/aaaa`. */
export function formatarDia(data: string): string {
  const [a, m, d] = data.split('-')
  return a && m && d ? `${d}/${m}/${a}` : data
}
