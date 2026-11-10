import { formatarDataHora, formatarRelativo } from '../util/formato.ts'

export function Horario({ iso }: { iso: string }) {
  const relativo = formatarRelativo(iso)
  return (
    <time dateTime={iso}>
      {formatarDataHora(iso)}
      {relativo && ` (${relativo})`}
    </time>
  )
}
