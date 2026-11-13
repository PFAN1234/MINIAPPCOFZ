/**
 * Regras do cadastro do boletim na fixture: as mesmas validações de `admin_salvar_etapa` e os
 * cálculos de `prazo` e `faltando` de `admin_obter_etapa` (docs/contrato-boletim.md). Nunca entra
 * no build de produção (só é importado por `fixture.ts`).
 */
import { CNPJ } from '../formato.ts'
import { ErroAdmin, ESTACAO_PADRAO, ESTACAO_RESERVA_PADRAO, FUSOS, type Aditivo, type CamposEtapa, type DadosEtapa, type PrazoEtapa } from './tipos.ts'

export const CAMPOS_VAZIOS: CamposEtapa = {
  sigla: null,
  endereco: null,
  latitude: null,
  longitude: null,
  fuso: 'America/Sao_Paulo',
  estacao: null,
  estacao_reserva: null,
  boletim_horario: '23:30',
  objeto: null,
  local: null,
  contratante: null,
  contrato: null,
  contratada: null,
  contratada_cnpj: null,
  os_numero: null,
  os_data: null,
  vigencia_meses: null,
  valor_original: null,
  area_construida_m2: null,
}

const CHAVES = Object.keys(CAMPOS_VAZIOS) as (keyof CamposEtapa)[]
const TEXTOS: [keyof CamposEtapa, string, number][] = [
  ['endereco', 'O endereço', 300],
  ['objeto', 'A obra/serviço', 600],
  ['local', 'O local', 300],
  ['contratante', 'O contratante', 200],
  ['contrato', 'O contrato', 60],
  ['contratada', 'A contratada', 200],
  ['os_numero', 'O número da OS', 40],
]

const invalido = (msg: string) => new ErroAdmin(msg)

/** `btrim`, vazio vira null. */
function limpo(v: unknown): string | null {
  if (v == null) return null
  const t = String(v).trim()
  return t === '' ? null : t
}

function numero(v: unknown, rotulo: string): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) throw invalido(`${rotulo} precisa ser um número`)
  return n
}

export function dataValida(iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.toISOString().slice(0, 10) === iso
}

/**
 * Aplica `d` sobre `atual` (ou sobre os padrões, na criação): chave ausente mantém, `null` apaga.
 * `siglasDeOutras` são as siglas das demais etapas (unicidade).
 */
export function aplicarCampos(
  atual: CamposEtapa | null,
  d: DadosEtapa,
  siglasDeOutras: string[],
): CamposEtapa {
  const criacao = atual === null
  const novo: CamposEtapa = { ...(atual ?? CAMPOS_VAZIOS) }
  const veio = (k: keyof CamposEtapa) => Object.prototype.hasOwnProperty.call(d, k) && d[k] !== undefined

  if (criacao) {
    for (const k of ['sigla', 'latitude', 'longitude', 'fuso'] as const) {
      if (!veio(k) || d[k] == null || d[k] === '') throw invalido(`O campo ${k} é obrigatório na criação da etapa`)
    }
  }

  if (veio('sigla')) {
    const s = limpo(d.sigla)
    if (s === null) throw invalido('A sigla não pode ser apagada')
    if (!/^[A-Z0-9]{1,10}$/.test(s)) throw invalido('Sigla inválida: use de 1 a 10 letras maiúsculas ou dígitos')
    if (siglasDeOutras.includes(s)) throw invalido(`Já existe uma etapa com a sigla ${s}`)
    novo.sigla = s
  }

  for (const [k, rotulo, max] of TEXTOS) {
    if (!veio(k)) continue
    const t = limpo(d[k])
    if (t !== null && t.length > max) throw invalido(`${rotulo} pode ter até ${max} caracteres`)
    ;(novo as unknown as Record<string, unknown>)[k] = t
  }

  if (veio('latitude')) novo.latitude = numero(d.latitude, 'A latitude')
  if (veio('longitude')) novo.longitude = numero(d.longitude, 'A longitude')
  if ((novo.latitude === null) !== (novo.longitude === null)) {
    throw invalido('Informe latitude e longitude juntas (ou nenhuma)')
  }
  if (novo.latitude !== null && (novo.latitude < -34 || novo.latitude > 6)) {
    throw invalido('Latitude fora do Brasil: use um valor entre -34 e 6')
  }
  if (novo.longitude !== null && (novo.longitude < -74 || novo.longitude > -28)) {
    throw invalido('Longitude fora do Brasil: use um valor entre -74 e -28')
  }

  if (veio('fuso')) {
    if (d.fuso == null) throw invalido('O fuso não pode ser apagado')
    if (!FUSOS.some((f) => f.valor === d.fuso)) throw invalido(`Fuso inválido: ${String(d.fuso)}`)
    novo.fuso = String(d.fuso)
  }

  if (criacao) {
    // Na criação, sem estação informada, Montese e Benfica.
    if (!veio('estacao')) novo.estacao = ESTACAO_PADRAO
    if (!veio('estacao_reserva')) novo.estacao_reserva = ESTACAO_RESERVA_PADRAO
  }
  for (const k of ['estacao', 'estacao_reserva'] as const) {
    if (!veio(k)) continue
    const t = limpo(d[k])
    if (t !== null && !/^[0-9]{3,6}$/.test(t)) throw invalido('Código de estação inválido: use de 3 a 6 dígitos, como 8836')
    novo[k] = t
  }
  if (novo.estacao !== null && novo.estacao === novo.estacao_reserva) {
    throw invalido('A estação de reserva precisa ser diferente da principal')
  }

  if (veio('boletim_horario')) {
    if (d.boletim_horario == null) throw invalido('O horário do boletim não pode ser apagado')
    const h = String(d.boletim_horario).trim()
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(h)) throw invalido('Horário do boletim inválido: use HH:MM')
    novo.boletim_horario = h
  }

  if (veio('contratada_cnpj')) {
    const t = limpo(d.contratada_cnpj)
    if (t !== null && !CNPJ.test(t)) throw invalido('CNPJ inválido: use o formato 00.000.000/0000-00')
    novo.contratada_cnpj = t
  }

  if (veio('os_data')) {
    const t = limpo(d.os_data)
    if (t !== null && !dataValida(t)) throw invalido('Data da OS inválida: use AAAA-MM-DD')
    novo.os_data = t
  }

  if (veio('vigencia_meses')) {
    const n = numero(d.vigencia_meses, 'A vigência')
    if (n !== null && (!Number.isInteger(n) || n < 1 || n > 240)) throw invalido('A vigência precisa estar entre 1 e 240 meses')
    novo.vigencia_meses = n
  }
  if (veio('valor_original')) {
    const n = numero(d.valor_original, 'O valor original')
    if (n !== null && n < 0) throw invalido('O valor original não pode ser negativo')
    novo.valor_original = n === null ? null : Math.round(n * 100) / 100
  }
  if (veio('area_construida_m2')) {
    const n = numero(d.area_construida_m2, 'A área construída')
    if (n !== null && n <= 0) throw invalido('A área construída precisa ser maior que zero')
    novo.area_construida_m2 = n === null ? null : Math.round(n * 100) / 100
  }
  return novo
}

/** Soma `meses` a uma data "AAAA-MM-DD" (como `date + interval`: o dia se ajusta ao fim do mês). */
export function somarMeses(iso: string, meses: number): string {
  const [a, m, d] = iso.split('-').map(Number)
  const total = m - 1 + meses
  const ano = a + Math.floor(total / 12)
  const mes = ((total % 12) + 12) % 12
  const ultimo = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate()
  return new Date(Date.UTC(ano, mes, Math.min(d, ultimo))).toISOString().slice(0, 10)
}

export function somarDias(iso: string, dias: number): string {
  const [a, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10)
}

/** `prazo` de `admin_obter_etapa`: só com data da OS e vigência. */
export function calcularPrazo(c: CamposEtapa, aditivos: Aditivo[]): PrazoEtapa | null {
  if (c.os_data === null || c.vigencia_meses === null) return null
  const original = somarMeses(c.os_data, c.vigencia_meses)
  const dias = aditivos.reduce((s, a) => s + a.prazo_dias, 0)
  const soma = aditivos.reduce((s, a) => s + a.valor, 0)
  return {
    termino_original: original,
    prazo_aditivos_dias: dias,
    termino_atual: somarDias(original, dias),
    valor_atual: c.valor_original === null ? null : Math.round((c.valor_original + soma) * 100) / 100,
  }
}

/** `faltando` de `admin_obter_etapa`: nomes dos campos vazios, na ordem do contrato. */
export function calcularFaltando(c: CamposEtapa, responsaveis: number): string[] {
  const f: string[] = []
  if (c.sigla === null) f.push('sigla')
  if (c.latitude === null || c.longitude === null) f.push('localizacao')
  for (const k of [
    'estacao',
    'objeto',
    'local',
    'contratante',
    'contrato',
    'contratada',
    'contratada_cnpj',
    'os_numero',
    'os_data',
    'vigencia_meses',
    'valor_original',
    'area_construida_m2',
  ] as const) {
    if (c[k] === null) f.push(k)
  }
  if (responsaveis === 0) f.push('responsaveis')
  return f
}

/** Só os campos do cadastro (sem identidade) de um objeto qualquer. */
export function camposDe(e: CamposEtapa): CamposEtapa {
  const r = {} as Record<string, unknown>
  for (const k of CHAVES) r[k] = e[k]
  return r as unknown as CamposEtapa
}
