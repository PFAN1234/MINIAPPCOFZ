/** Formatos do boletim (padrão brasileiro) e escape de HTML. */

export function escapar(texto: unknown): string {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Texto com quebras de linha como `<br>`. */
export function comQuebras(texto: unknown): string {
  return escapar(texto).replace(/\r?\n/g, '<br>')
}

/** Partes de um instante no fuso. */
export function partesNoFuso(instante: Date, fuso: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: fuso,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(instante)
      .map((x) => [x.type, x.value]),
  )
  return { ano: p.year, mes: p.month, dia: p.day, hora: p.hour, minuto: p.minute }
}

/** "AAAA-MM-DD" (ou ISO) → "dd/mm/aaaa"; instante ISO com hora é levado ao fuso. */
export function dataBr(valor: string | null | undefined, fuso?: string): string {
  if (!valor) return ''
  if (fuso && /T\d{2}:\d{2}/.test(valor)) {
    const d = new Date(valor)
    if (!Number.isNaN(d.getTime())) {
      const p = partesNoFuso(d, fuso)
      return `${p.dia}/${p.mes}/${p.ano}`
    }
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(valor)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : valor
}

/** "dd/mm" de uma data. */
export function diaMesBr(valor: string, fuso?: string): string {
  return dataBr(valor, fuso).slice(0, 5)
}

/** "HH:MM" ou instante ISO → "HH:MM" no fuso. */
export function horaBr(valor: string | null | undefined, fuso: string): string {
  if (!valor) return ''
  if (/^\d{1,2}:\d{2}/.test(valor)) return valor.slice(0, 5).padStart(5, '0')
  const d = new Date(valor)
  if (Number.isNaN(d.getTime())) return valor
  const p = partesNoFuso(d, fuso)
  return `${p.hora}:${p.minuto}`
}

/** Instante → "dd/mm/aaaa às HH:MM" no fuso. */
export function dataHoraBr(instante: Date, fuso: string): string {
  const p = partesNoFuso(instante, fuso)
  return `${p.dia}/${p.mes}/${p.ano} às ${p.hora}:${p.minuto}`
}

/** Instante → "dd/mm/aa · HH:MM" (campo EXPEDIÇÃO). */
export function expedicao(instante: Date, fuso: string): string {
  const p = partesNoFuso(instante, fuso)
  return `${p.dia}/${p.mes}/${p.ano.slice(2)} · ${p.hora}:${p.minuto}`
}

function decimais(n: number, casas: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })
}

export function moeda(n: number): string {
  return `${n < 0 ? '-' : ''}R$ ${decimais(Math.abs(n), 2)}`
}

export function areaM2(n: number): string {
  return `${decimais(n, 2)} m²`
}

export function numeroBr(n: number, casas = 0): string {
  return decimais(n, casas)
}

export function diasComSinal(n: number): string {
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('pt-BR')} ${Math.abs(n) === 1 ? 'dia' : 'dias'}`
}

/** Cidade do fuso para "horário de Fortaleza". */
const CIDADE: Record<string, string> = {
  'America/Noronha': 'Fernando de Noronha',
  'America/Belem': 'Belém',
  'America/Fortaleza': 'Fortaleza',
  'America/Recife': 'Recife',
  'America/Araguaina': 'Araguaína',
  'America/Maceio': 'Maceió',
  'America/Bahia': 'Salvador',
  'America/Sao_Paulo': 'Brasília',
  'America/Campo_Grande': 'Campo Grande',
  'America/Cuiaba': 'Cuiabá',
  'America/Santarem': 'Santarém',
  'America/Porto_Velho': 'Porto Velho',
  'America/Boa_Vista': 'Boa Vista',
  'America/Manaus': 'Manaus',
  'America/Eirunepe': 'Eirunepé',
  'America/Rio_Branco': 'Rio Branco',
}

export function cidadeDoFuso(fuso: string): string {
  return CIDADE[fuso] ?? fuso.replace(/^.*\//, '').replace(/_/g, ' ')
}

/** "BA2/261113/COFZ-R1" → "BA2261113COFZ-R1" (nome do arquivo no bucket). */
export function numeroSemBarras(numero: string): string {
  return numero.replace(/\//g, '')
}
