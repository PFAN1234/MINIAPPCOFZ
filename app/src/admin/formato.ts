/** Formatação e leitura de números, datas e máscaras no padrão brasileiro (site de administração). */

/** "AAAA-MM-DD" (ou timestamp ISO) → "dd/mm/aaaa", sem passar por fuso. */
export function dataBr(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}

const dois = (n: number) => String(n).padStart(2, '0')

/** Data local de hoje como "AAAA-MM-DD". */
export function hojeIso(agora = new Date()): string {
  return `${agora.getFullYear()}-${dois(agora.getMonth() + 1)}-${dois(agora.getDate())}`
}

/** Data de hoje no fuso IANA (ex.: `America/Fortaleza`) como "AAAA-MM-DD". */
export function hojeNoFuso(fuso: string, agora = new Date()): string {
  // en-CA formata como AAAA-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora)
}

/** Instante ISO → "dd/mm/aaaa às HH:MM" no fuso dado (padrão: o do navegador). */
export function dataHoraBr(iso: string, fuso?: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('pt-BR', {
      timeZone: fuso,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  )
  return `${p.day}/${p.month}/${p.year} às ${p.hour}:${p.minute}`
}

function decimais(n: number, casas: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })
}

/** 79499000 → "R$ 79.499.000,00" (negativo: "-R$ 1.000,00"). */
export function moeda(n: number): string {
  return `${n < 0 ? '-' : ''}R$ ${decimais(Math.abs(n), 2)}`
}

/** 86102.17 → "86.102,17 m²". */
export function areaM2(n: number): string {
  return `${decimais(n, 2)} m²`
}

/** -3.761 → "-3,7610" (4 casas, vírgula decimal). */
export function coordenada(n: number): string {
  return decimais(n, 4).replace(/^-0,0000$/, '0,0000')
}

/** Número de dias com sinal: "+30 dias", "-10 dias". */
export function diasComSinal(n: number): string {
  return `${n > 0 ? '+' : ''}${n.toLocaleString('pt-BR')} ${Math.abs(n) === 1 ? 'dia' : 'dias'}`
}

/** Valor da máscara de moeda ("79.499.000,00") a partir de um número; vazio sem valor. */
export function textoMoeda(n: number | null | undefined): string {
  return n == null ? '' : `${n < 0 ? '-' : ''}${decimais(Math.abs(n), 2)}`
}

/**
 * Máscara de moeda digitada da direita para a esquerda: só os dígitos contam, os dois últimos são
 * os centavos. `negativo` deixa o "-" no começo (aditivo de supressão).
 */
export function mascaraMoeda(texto: string, negativo = false): string {
  const digitos = texto.replace(/\D/g, '').replace(/^0+(?=\d)/, '')
  if (!digitos) return negativo && texto.trim().startsWith('-') ? '-' : ''
  const centavos = digitos.padStart(3, '0')
  const inteiro = centavos.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${negativo && texto.trim().startsWith('-') ? '-' : ''}${inteiro},${centavos.slice(-2)}`
}

/** "79.499.000,00" → 79499000; texto vazio ou inválido → null. */
export function lerMoeda(texto: string): number | null {
  const t = texto.trim()
  if (!/^-?\d{1,3}(\.\d{3})*,\d{2}$|^-?\d+,\d{2}$/.test(t)) return null
  return Number(t.replace(/\./g, '').replace(',', '.'))
}

/** Número digitado no padrão brasileiro ("86.102,17") ou com ponto decimal ("86102.17"); inválido → null. */
export function lerDecimal(texto: string): number | null {
  const t = texto.trim().replace('−', '-')
  if (!t) return null
  let normal: string
  if (t.includes(',')) normal = t.replace(/\./g, '').replace(',', '.')
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) normal = t.replace(/\./g, '')
  else normal = t
  return /^-?\d+(\.\d+)?$/.test(normal) ? Number(normal) : null
}

/** Número para o campo de texto, com vírgula decimal e sem milhar. */
export function textoDecimal(n: number | null | undefined): string {
  return n == null ? '' : String(n).replace('.', ',')
}

/** Número do campo de área: "86.102,17". */
export function textoArea(n: number | null | undefined): string {
  return n == null ? '' : decimais(n, 2)
}

/** Máscara do CNPJ: 12345678000195 → "12.345.678/0001-95" (aceita digitação parcial). */
export function mascaraCnpj(texto: string): string {
  const d = texto.replace(/\D/g, '').slice(0, 14)
  let r = d.slice(0, 2)
  if (d.length > 2) r += `.${d.slice(2, 5)}`
  if (d.length > 5) r += `.${d.slice(5, 8)}`
  if (d.length > 8) r += `/${d.slice(8, 12)}`
  if (d.length > 12) r += `-${d.slice(12, 14)}`
  return r
}

export const CNPJ = /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/

/**
 * Lê "−3.7610, −38.5297" (ponto decimal, vírgula separando) ou "-3,7610; -38,5297" (vírgula decimal,
 * ponto e vírgula ou espaço separando). Devolve null se não houver exatamente dois números.
 */
export function lerCoordenadas(texto: string): { latitude: number; longitude: number } | null {
  const t = texto.replace(/[\u2212\u2013]/g, '-').trim()
  // "-3,7610" sozinho é um número com vírgula decimal; só vira par com ponto decimal na latitude ou com espaço depois da vírgula.
  const pontos =
    /^(-?\d+\.\d+)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(t) ??
    /^(-?\d+(?:\.\d+)?),\s+(-?\d+(?:\.\d+)?)$/.exec(t) ??
    /^(-?\d+(?:\.\d+)?)(?:\s*;\s*|\s+)(-?\d+(?:\.\d+)?)$/.exec(t)
  const virgulas = /^(-?\d+(?:,\d+)?)\s*(?:;|\s)\s*(-?\d+(?:,\d+)?)$/.exec(t)
  const m = pontos ?? virgulas
  if (!m) return null
  const [a, b] = [m[1], m[2]].map((x) => Number(x.replace(',', '.')))
  return Number.isFinite(a) && Number.isFinite(b) ? { latitude: a, longitude: b } : null
}

/** Código da OM no número do boletim: maiúsculas, sem acentos, só letras e dígitos ("CO-FZ" → "COFZ"). */
export function codigoOm(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

/** "BA2/261111/COFZ" para a sigla, a data "AAAA-MM-DD" e o nome da OM. */
/** Soma (ou subtrai) dias a uma data "AAAA-MM-DD". */
export function somarDiasIso(iso: string, dias: number): string {
  const [a, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10)
}

export function numeroBoletim(sigla: string, dataIso: string, nomeOm: string): string {
  return `BA${sigla}/${dataIso.slice(2, 4)}${dataIso.slice(5, 7)}${dataIso.slice(8, 10)}/${codigoOm(nomeOm)}`
}
