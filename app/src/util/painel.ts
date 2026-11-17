import type { ObraPainel, PainelRelatorios } from '../dados/tipos.ts'

export interface PontoSerie {
  dia: string
  servicos: number
  pendencias: number
  resolvidas: number
}

export interface TotalObra {
  obra: ObraPainel
  servicos: number
  abertas: number
  resolvidas: number
}

function somarDia(dia: string, n: number): string {
  return new Date(new Date(`${dia}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10)
}

/**
 * Série acumulada: um ponto por dia, do primeiro dia com movimento até `hoje` (inclusive),
 * preenchendo os dias sem movimento. `obraId` nulo soma todas as obras. Painel sem movimento → [].
 */
export function serieAcumulada(painel: PainelRelatorios, obraId: string | null): PontoSerie[] {
  const dias = painel.dias.filter((d) => obraId === null || d.obra_id === obraId)
  if (dias.length === 0) return []
  const porDia = new Map<string, { s: number; p: number; r: number }>()
  for (const d of dias) {
    const a = porDia.get(d.dia) ?? { s: 0, p: 0, r: 0 }
    a.s += d.servicos
    a.p += d.pendencias
    a.r += d.resolvidas
    porDia.set(d.dia, a)
  }
  const primeiro = [...porDia.keys()].sort()[0]
  const ultimo = [...porDia.keys(), painel.etapa.hoje].sort().at(-1) as string
  const serie: PontoSerie[] = []
  let s = 0
  let p = 0
  let r = 0
  for (let dia = primeiro; dia <= ultimo; dia = somarDia(dia, 1)) {
    const m = porDia.get(dia)
    if (m) {
      s += m.s
      p += m.p
      r += m.r
    }
    serie.push({ dia, servicos: s, pendencias: p, resolvidas: r })
  }
  return serie
}

/** Totais por obra (na ordem de `painel.obras`): serviços, pendências abertas e resolvidas. */
export function totaisPorObra(painel: PainelRelatorios): TotalObra[] {
  return painel.obras.map((obra) => {
    let servicos = 0
    let pendencias = 0
    let resolvidas = 0
    for (const d of painel.dias) {
      if (d.obra_id !== obra.id) continue
      servicos += d.servicos
      pendencias += d.pendencias
      resolvidas += d.resolvidas
    }
    return { obra, servicos, abertas: pendencias - resolvidas, resolvidas }
  })
}
