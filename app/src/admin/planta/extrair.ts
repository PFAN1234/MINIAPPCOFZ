/**
 * Port de `scripts/extrair_ambientes.py` (mesmas regras, mesmas mensagens de erro).
 *
 * Funções puras: recebem a configuração da obra (formato do `obra.json`), as páginas lidas
 * (`{codigo: {largura, altura, spans}}`) e a base anterior, e devolvem o conteúdo do
 * `ambientes.json`. No site, a base é o estado do banco (ver `baseDoBanco` em `editor.ts`).
 *
 * Único acréscimo em relação ao Python: `marcadores_ajustados` (pinos arrastados ou
 * removidos no editor), aplicado depois dos códigos e antes das diferenças.
 */
import { arredondar } from './spans.ts'
import {
  ErroPlanta,
  type Ambiente,
  type AmbienteManual,
  type BaseExtracao,
  type Diferencas,
  type ItemRevisar,
  type Marcador,
  type ObraConfig,
  type PaginaLida,
  type PavimentoConfig,
  type PontoXY,
  type Removido,
  type ResultadoExtracao,
  type Span,
  type Sucessor,
} from './tipos.ts'

const AREA_RE = /^A=\s*(?<valor>[\d.,]+|Não incluso)\s*m²$/
export const REVISAO_DO_PDF = /-(R\d+)\.pdf$/i
const SLUG_RE = /^[a-z0-9-]+$/
const STATUS_VALIDOS = ['aguardando_revisao_humana', 'revisado']

// Distâncias em pontos PDF: o nome fica colado acima da área (bbox sobrepõe ~1 pt).
export const GAP_MIN = -4.0
export const GAP_MAX = 8.0
export const DESVIO_CENTRO_MAX = 25.0

// Distâncias normalizadas entre pinos de duas versões da lista.
export const LIMIAR_DESLOCAMENTO = 0.01
export const LIMIAR_SUCESSOR = 0.03

/** Categorias que a regra genérica do extrator produz (o campo aceita outras na configuração). */
export const CATEGORIAS_EXTRATOR = [
  'apartamento',
  'banheiro',
  'vestiario',
  'circulacao',
  'externa',
  'servico',
  'area_comum',
] as const

function falhar(mensagem: string): never {
  throw new ErroPlanta(mensagem)
}

/** `repr` curto de lista/valor para as mensagens (como o Python imprime). */
function repr(v: unknown): string {
  if (typeof v === 'string') return `'${v}'`
  if (Array.isArray(v)) return `[${v.map(repr).join(', ')}]`
  if (v === null || v === undefined) return 'None'
  return String(v)
}

// --- Configuração da obra ----------------------------------------------------

export function validarObra(obra: ObraConfig, slug?: string): void {
  for (const campo of ['slug', 'nome', 'status', 'revisao', 'pasta_pdf', 'pavimentos', 'prancha']) {
    if (!(campo in obra)) falhar(`obra.json sem o campo '${campo}'`)
  }
  if (slug !== undefined && obra.slug !== slug) falhar(`obra.json com slug '${obra.slug}', esperado '${slug}'`)
  if (!STATUS_VALIDOS.includes(obra.status)) {
    falhar(`status inválido: '${obra.status}' (use ['aguardando_revisao_humana', 'revisado'])`)
  }
  const codigos = obra.pavimentos.map((p) => p.codigo)
  if (codigos.length !== new Set(codigos).size || codigos.length === 0) {
    falhar(`códigos de pavimento vazios ou repetidos: ${repr(codigos)}`)
  }
  for (const pav of obra.pavimentos) {
    const m = REVISAO_DO_PDF.exec(pav.pdf)
    if (m && m[1].toUpperCase() !== obra.revisao.toUpperCase()) {
      falhar(`PDF ${pav.pdf} é da revisão ${m[1]}, mas obra.json diz ${obra.revisao}`)
    }
  }
  for (const manual of obra.ambientes_manuais ?? []) {
    for (const campo of ['pavimento', 'nome_operacional', 'categoria', 'marcador']) {
      if (!(campo in manual)) falhar(`ambiente manual sem o campo '${campo}': ${JSON.stringify(manual)}`)
    }
    if (!codigos.includes(manual.pavimento)) falhar(`ambiente manual em pavimento desconhecido: '${manual.pavimento}'`)
    const { x, y } = manual.marcador
    if (![x, y].every((v) => typeof v === 'number' && v >= 0 && v <= 1)) {
      falhar(`marcador do ambiente manual fora de 0–1: '${manual.nome_operacional}'`)
    }
  }
  const manter = obra.manter_codigo ?? {}
  if (
    typeof manter !== 'object' ||
    Array.isArray(manter) ||
    !Object.entries(manter).every(([k, v]) => typeof k === 'string' && typeof v === 'string' && k && v)
  ) {
    falhar('\'manter_codigo\' deve ser um objeto {"<id novo calculado>": "<id antigo>"}')
  }
  const revisaoHumana = obra.revisao_humana as { revisao_planta?: string } | null | undefined
  if (obra.status === 'revisado') {
    if (!revisaoHumana) falhar("status 'revisado' exige 'revisao_humana' preenchida")
    if (revisaoHumana.revisao_planta !== obra.revisao) {
      falhar(
        'a revisão humana foi feita em outra revisão da planta: ' +
          "volte o status para 'aguardando_revisao_humana' e confira de novo",
      )
    }
  }
}

export function validarSlug(slug: string): void {
  if (!SLUG_RE.test(slug)) falhar(`slug inválido: '${slug}' (use letras minúsculas, dígitos e hífen)`)
}

export function pavimentosOrdenados(obra: ObraConfig): PavimentoConfig[] {
  return [...obra.pavimentos].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
}

// --- Regras de nome e categoria ----------------------------------------------

export function centroX(b: number[]): number {
  return (b[0] + b[2]) / 2
}

export function parseArea(texto: string): number | null {
  const m = AREA_RE.exec(texto)
  if (!m?.groups) falhar(`rótulo de área inválido: '${texto}'`)
  const valor = m.groups.valor
  if (valor === 'Não incluso') return null
  const n = Number(valor.replace(/,/g, '.'))
  if (!Number.isFinite(n) || !/^\d*\.?\d+$|^\d+\.$/.test(valor.replace(/,/g, '.'))) {
    falhar(`rótulo de área inválido: '${texto}'`)
  }
  return n
}

function capitalizar(s: string): string {
  return s.slice(0, 1).toUpperCase() + s.slice(1).toLowerCase()
}

export function nomeOperacional(nome: string, nomesFixos?: Record<string, string>): string {
  if (nomesFixos && Object.hasOwn(nomesFixos, nome)) return nomesFixos[nome]
  let m = /^APTO\. AUTORIDADES \((\d+)\)$/.exec(nome)
  if (m) return `Apto. Autoridades ${m[1]}`
  m = /^BHO AUT\. \((\d+)\)$/.exec(nome)
  if (m) return `Banheiro Autoridades ${m[1]}`
  m = /^APTO\. (\d+)$/.exec(nome)
  if (m) return `Apto. ${m[1]}`
  m = /^BHO (.+)$/.exec(nome)
  if (m) {
    const resto = m[1]
    return `Banheiro ${/^\d/.test(resto) ? resto : capitalizar(resto)}`
  }
  return capitalizar(nome)
}

export function categoria(nome: string, categorias?: Record<string, string>): string {
  if (categorias && Object.hasOwn(categorias, nome)) return categorias[nome]
  const n = nome.toUpperCase()
  if (n.startsWith('APTO')) return 'apartamento'
  if (n.startsWith('BHO') || n.startsWith('WC')) return 'banheiro'
  if (n.startsWith('VEST')) return 'vestiario'
  if (n.startsWith('CIRC')) return 'circulacao'
  if (n === 'JARDIM' || n === 'PISCINA') return 'externa'
  if (/^(DML|DEPÓSITO|DESPENSA|CPD|LAVAND|COPA|ALOJAMENTO|ADMIN|RECEPÇÃO)/.test(n)) return 'servico'
  return 'area_comum'
}

/** Texto sem acentos e só com ASCII (NFKD + descarte do que não é ASCII, como no Python). */
function semAcento(texto: string): string {
  return [...texto.normalize('NFKD')].filter((c) => c.charCodeAt(0) < 128).join('')
}

export function slug(texto: string): string {
  return semAcento(texto)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Chave de ordenação natural: "Apto. 2" antes de "Apto. 10", sem acento e sem caixa. */
export function chaveNatural(nome: string): (string | number)[] {
  return semAcento(nome)
    .toLowerCase()
    .split(/(\d+)/)
    .map((p) => (/^\d+$/.test(p) ? Number(p) : p))
}

/** Comparação de listas como o Python (elemento a elemento; prefixo menor vem antes). */
export function compararListas(a: readonly (string | number)[], b: readonly (string | number)[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i]
    const y = b[i]
    if (x === y) continue
    return x < y ? -1 : 1
  }
  return a.length - b.length
}

// --- Extração ----------------------------------------------------------------

export interface Par {
  nome: Span
  area: Span
}

/** Pareia cada span de área com o nome logo acima. Retorna os pares e as áreas sem nome. */
export function parearRotulos(spans: Span[]): { pares: Par[]; orfas: string[] } {
  const areas = spans.filter((s) => s.text.startsWith('A='))
  const candidatos = spans.filter(
    (s) => !s.text.startsWith('A=') && (s.direction ?? [1, 0])[0] === 1 && (s.direction ?? [1, 0])[1] === 0,
  )
  const pares: Par[] = []
  const orfas: string[] = []
  const usados = new Set<number>()
  for (const a of areas) {
    const ax = centroX(a.bbox)
    let melhor: { i: number; n: Span; custo: number } | null = null
    candidatos.forEach((n, i) => {
      const gap = a.bbox[1] - n.bbox[3]
      if (!(GAP_MIN < gap && gap < GAP_MAX) || !(Math.abs(centroX(n.bbox) - ax) < DESVIO_CENTRO_MAX) || usados.has(i)) {
        return
      }
      const custo = Math.abs(gap) + Math.abs(centroX(n.bbox) - ax)
      if (melhor === null || custo < melhor.custo) melhor = { i, n, custo }
    })
    if (melhor === null) {
      orfas.push(a.text)
      continue
    }
    const { i, n } = melhor as { i: number; n: Span }
    usados.add(i)
    pares.push({ nome: n, area: a })
  }
  return { pares, orfas }
}

function areaArred(valor: number | null | undefined): number | null {
  return valor === null || valor === undefined ? null : arredondar(Number(valor), 2)
}

function chaveRenomear(pav: string, nome: string, area: number | null | undefined): string {
  return JSON.stringify([pav, nome, areaArred(area)])
}

/** Ambiente sem rótulo na planta, com o pino definido à mão na configuração. */
export function ambienteManual(obra: ObraConfig, pavCfg: PavimentoConfig, manual: AmbienteManual): Omit<Ambiente, 'id'> {
  const x = arredondar(Number(manual.marcador.x), 6)
  const y = arredondar(Number(manual.marcador.y), 6)
  return {
    pavimento: pavCfg.codigo,
    nome_planta: null,
    nome_operacional: manual.nome_operacional,
    categoria: manual.categoria,
    area_m2: null,
    pdf: `${obra.pasta_pdf}/${pavCfg.pdf}`,
    pagina: pavCfg.pagina ?? 1,
    revisao: obra.revisao,
    marcadores: [{ x, y, rotulo_bbox: [x, y, x, y] }],
  }
}

// --- Revisões: códigos estáveis e diferenças em relação à base ---------------

export function idsConhecidos(base: BaseExtracao | null | undefined): Set<string> {
  if (!base) return new Set()
  return new Set([...(base.ambientes ?? []).map((a) => a.id), ...(base.ambientes_removidos ?? []).map((r) => r.id)])
}

type AmbienteTrabalho = Omit<Ambiente, 'id'> & { id: string; _renomeado?: boolean }

/** Troca o id calculado pelo id antigo de `manter_codigo`. Devolve `{id mantido: id calculado}`. */
export function aplicarManterCodigo(
  ambientes: AmbienteTrabalho[],
  manter: Record<string, string>,
  base: BaseExtracao | null | undefined,
): Record<string, string> {
  if (Object.keys(manter).length === 0) return {}
  if (!base) falhar("'manter_codigo' exige o ambientes.json anterior como base, e ele não existe")
  const calculados = new Set(ambientes.map((a) => a.id))
  const ordenar = (l: string[]) => [...l].sort()
  const semAmbiente = ordenar(Object.keys(manter).filter((k) => !calculados.has(k)))
  if (semAmbiente.length) falhar(`'manter_codigo' sem ambiente correspondente na planta: ${repr(semAmbiente)}`)
  const iguais = ordenar(Object.entries(manter).filter(([k, v]) => k === v).map(([k]) => k))
  if (iguais.length) falhar(`'manter_codigo' com id novo igual ao antigo (entrada desnecessária): ${repr(iguais)}`)
  const conhecidos = idsConhecidos(base)
  const desconhecidos = ordenar(Object.values(manter).filter((v) => !conhecidos.has(v)))
  if (desconhecidos.length) {
    falhar(
      "'manter_codigo' aponta para ids que não existem na base nem em " +
        `'ambientes_removidos': ${repr(desconhecidos)}`,
    )
  }
  const valores = Object.values(manter)
  const repetidos = ordenar([...new Set(valores.filter((v) => valores.filter((w) => w === v).length > 1))])
  if (repetidos.length) falhar(`'manter_codigo' com o mesmo id antigo para mais de um ambiente: ${repr(repetidos)}`)
  const colisoes = ordenar(valores.filter((v) => calculados.has(v) && !Object.hasOwn(manter, v)))
  if (colisoes.length) {
    falhar(
      "'manter_codigo' colide com o id de outro ambiente extraído: " +
        `${repr(colisoes)} (esse id continua na planta com outro ambiente)`,
    )
  }
  const pavAntigo = new Map<string, string>()
  for (const r of base.ambientes_removidos ?? []) pavAntigo.set(r.id, r.pavimento)
  for (const a of base.ambientes ?? []) pavAntigo.set(a.id, a.pavimento)
  const outroPav = ordenar(
    ambientes
      .filter((a) => Object.hasOwn(manter, a.id) && pavAntigo.get(manter[a.id]) !== a.pavimento)
      .map((a) => `${a.id} -> ${manter[a.id]}`),
  )
  if (outroPav.length) falhar(`'manter_codigo' entre pavimentos diferentes: ${repr(outroPav)}`)
  const herdados: Record<string, string> = {}
  for (const a of ambientes) {
    if (Object.hasOwn(manter, a.id)) {
      herdados[manter[a.id]] = a.id
      a.id = manter[a.id]
    }
  }
  return herdados
}

interface Resumo {
  id: string
  pavimento: string
  nome_operacional: string
  nome_planta: string | null
  area_m2: number | null
  revisao: string | null
  marcadores: PontoXY[]
}

function resumo(a: {
  id: string
  pavimento: string
  nome_operacional: string
  nome_planta?: string | null
  area_m2?: number | null
  revisao?: string | null
  marcadores?: PontoXY[]
}): Resumo {
  return {
    id: a.id,
    pavimento: a.pavimento,
    nome_operacional: a.nome_operacional,
    nome_planta: a.nome_planta ?? null,
    area_m2: a.area_m2 ?? null,
    revisao: a.revisao ?? null,
    marcadores: (a.marcadores ?? []).map((m) => ({ x: m.x, y: m.y })),
  }
}

function distancia(p: PontoXY, q: PontoXY): number {
  return Math.hypot(p.x - q.x, p.y - q.y)
}

function distanciaMinima(a: PontoXY[], b: PontoXY[]): number | null {
  if (!a.length || !b.length) return null
  return Math.min(...a.flatMap((p) => b.map((q) => distancia(p, q))))
}

/** Maior distância de um pino ao mais próximo na outra versão (Hausdorff). */
export function deslocamento(antes: PontoXY[], depois: PontoXY[]): number | null {
  if (!antes.length && !depois.length) return 0
  if (!antes.length || !depois.length) return null
  const ida = Math.max(...depois.map((p) => Math.min(...antes.map((q) => distancia(p, q)))))
  const volta = Math.max(...antes.map((p) => Math.min(...depois.map((q) => distancia(p, q)))))
  return Math.max(ida, volta)
}

export function decimal(valor: number): string {
  return valor.toFixed(3).replace('.', ',')
}

export function diferencasVazias(revisaoBase: string | null = null): Diferencas {
  return {
    revisao_base: revisaoBase,
    novos: [],
    removidos: [],
    herdados: [],
    nome_alterado: [],
    area_alterada: [],
    marcador_deslocado: [],
  }
}

/** Lista de referência para as diferenças (ver `referencia` no Python). */
export function referencia(
  base: BaseExtracao,
  revisao: string,
): { ref: Map<string, Resumo>; revisaoBase: string | null; removidos: Map<string, Removido> } {
  const ref = new Map<string, Resumo>()
  for (const a of base.ambientes ?? []) ref.set(a.id, resumo(a))
  const revisoes = [...new Set((base.ambientes ?? []).map((a) => a.revisao).filter((r): r is string => !!r))].sort()
  const revisaoBase = revisoes.length === 1 ? revisoes[0] : null
  const removidos = new Map<string, Removido>()
  for (const r of base.ambientes_removidos ?? []) removidos.set(r.id, r)
  const dif = base.diferencas
  if (revisaoBase !== revisao || !dif) return { ref, revisaoBase, removidos }
  for (const n of dif.novos ?? []) ref.delete(n.id)
  for (const h of dif.herdados ?? []) {
    if (h.reativado) {
      ref.delete(h.id)
      if (!removidos.has(h.id)) {
        removidos.set(h.id, { id: h.id, pavimento: h.pavimento, nome_operacional: h.nome_antes ?? '' })
      }
    } else if (ref.has(h.id)) {
      ref.get(h.id)!.nome_operacional = h.nome_antes ?? ''
    }
  }
  for (const n of dif.nome_alterado ?? []) if (ref.has(n.id)) ref.get(n.id)!.nome_operacional = n.antes
  for (const n of dif.area_alterada ?? []) if (ref.has(n.id)) ref.get(n.id)!.area_m2 = n.antes
  for (const n of dif.marcador_deslocado ?? []) if (ref.has(n.id)) ref.get(n.id)!.marcadores = n.antes
  for (const r of dif.removidos ?? []) {
    ref.set(r.id, {
      id: r.id,
      pavimento: r.pavimento,
      nome_operacional: r.nome_operacional,
      nome_planta: r.nome_planta ?? null,
      area_m2: r.area_m2 ?? null,
      revisao: r.revisao_ultima ?? null,
      marcadores: r.marcadores ?? [],
    })
  }
  return { ref, revisaoBase: dif.revisao_base ?? revisaoBase, removidos }
}

function compararTuplas(a: (number | string | boolean)[], b: (number | string | boolean)[]): number {
  for (let i = 0; i < a.length; i++) {
    const x = typeof a[i] === 'boolean' ? Number(a[i]) : a[i]
    const y = typeof b[i] === 'boolean' ? Number(b[i]) : b[i]
    if (x === y) continue
    return x < y ? -1 : 1
  }
  return 0
}

/** Ambiente novo do mesmo pavimento que provavelmente substitui o removido (só relatado). */
export function sugerirSucessor(
  removido: { pavimento: string; marcadores: PontoXY[]; nome_planta: string | null; area_m2: number | null },
  novos: Resumo[],
): Sucessor | null {
  const candidatos: { chave: (number | string | boolean)[]; n: Resumo; motivos: string[] }[] = []
  for (const n of novos) {
    if (n.pavimento !== removido.pavimento) continue
    const d = distanciaMinima(removido.marcadores, n.marcadores)
    const motivos: string[] = []
    const perto = d !== null && d < LIMIAR_SUCESSOR
    if (perto) motivos.push(`pino a ${decimal(d)} do anterior`)
    if (removido.nome_planta && n.nome_planta === removido.nome_planta) motivos.push('mesmo nome na planta')
    if (removido.area_m2 !== null && removido.area_m2 !== undefined && areaArred(n.area_m2) === areaArred(removido.area_m2)) {
      motivos.push('mesma área')
    }
    if (motivos.length) {
      candidatos.push({ chave: [!perto, -motivos.length, d ?? Infinity, n.id], n, motivos })
    }
  }
  if (!candidatos.length) return null
  const melhor = candidatos.reduce((m, c) => (compararTuplas(c.chave, m.chave) < 0 ? c : m))
  return { id: melhor.n.id, nome_operacional: melhor.n.nome_operacional, motivo: melhor.motivos.join('; ') }
}

/** `(ambientes_removidos, diferencas)` da lista nova em relação à base. */
export function compararComBase(
  obra: ObraConfig,
  ambientes: Ambiente[],
  herdados: Record<string, string>,
  base: BaseExtracao | null | undefined,
): { ambientesRemovidos: Removido[]; diferencas: Diferencas } {
  if (!base) return { ambientesRemovidos: [], diferencas: diferencasVazias() }
  const { ref, revisaoBase, removidos: removidosRef } = referencia(base, obra.revisao)
  const novosPorId = new Map(ambientes.map((a) => [a.id, resumo(a)]))
  const removidosBase = new Map((base.ambientes_removidos ?? []).map((r) => [r.id, r]))
  const dif = diferencasVazias(revisaoBase)

  const novos = ambientes.filter((a) => !ref.has(a.id) && !Object.hasOwn(herdados, a.id)).map((a) => novosPorId.get(a.id)!)
  dif.novos = novos.map((n) => ({ id: n.id, pavimento: n.pavimento, nome_operacional: n.nome_operacional, area_m2: n.area_m2 }))

  for (const a of ambientes) {
    const atual = novosPorId.get(a.id)!
    const antes = ref.get(a.id)
    if (Object.hasOwn(herdados, a.id)) {
      if (antes === undefined || antes.nome_operacional !== atual.nome_operacional) {
        const reativado = antes === undefined
        const nomeAntes = reativado ? (removidosRef.get(a.id)?.nome_operacional ?? null) : antes!.nome_operacional
        dif.herdados.push({
          id: a.id,
          id_calculado: herdados[a.id],
          pavimento: atual.pavimento,
          nome_antes: nomeAntes,
          nome_operacional: atual.nome_operacional,
          reativado,
        })
      }
    } else if (antes !== undefined && antes.nome_operacional !== atual.nome_operacional) {
      dif.nome_alterado.push({ id: a.id, antes: antes.nome_operacional, depois: atual.nome_operacional })
    }
    if (antes === undefined) continue
    if (areaArred(antes.area_m2) !== areaArred(atual.area_m2)) {
      dif.area_alterada.push({
        id: a.id,
        nome_operacional: atual.nome_operacional,
        antes: antes.area_m2,
        depois: atual.area_m2,
      })
    }
    const d = deslocamento(antes.marcadores, atual.marcadores)
    if (d === null || d > LIMIAR_DESLOCAMENTO) {
      dif.marcador_deslocado.push({
        id: a.id,
        nome_operacional: atual.nome_operacional,
        distancia: d === null ? null : arredondar(d, 4),
        antes: antes.marcadores,
        depois: atual.marcadores,
      })
    }
  }

  const ordemPav = pavimentosOrdenados(obra).map((p) => p.codigo)
  const chaveRemovido = (r: { pavimento: string; id: string }): [number, string] => {
    const i = ordemPav.indexOf(r.pavimento)
    return [i >= 0 ? i : ordemPav.length, r.id]
  }
  const porChave = (a: { pavimento: string; id: string }, b: { pavimento: string; id: string }) =>
    compararTuplas(chaveRemovido(a), chaveRemovido(b))

  const removidos = [...ref.entries()]
    .filter(([i]) => !novosPorId.has(i))
    .map(([, r]) => r)
    .sort(porChave)
  for (const r of removidos) {
    dif.removidos.push({
      id: r.id,
      pavimento: r.pavimento,
      nome_operacional: r.nome_operacional,
      nome_planta: r.nome_planta,
      area_m2: r.area_m2,
      revisao_ultima: r.revisao,
      marcadores: r.marcadores,
      sucessor_sugerido: sugerirSucessor(r, novos),
    })
  }

  // Acumulativa: os removidos de antes continuam, a menos que o id volte a existir.
  const acumulados = new Map<string, Removido>()
  for (const [i, r] of removidosBase) if (!novosPorId.has(i)) acumulados.set(i, r)
  for (const r of removidos) {
    if (!acumulados.has(r.id)) {
      acumulados.set(r.id, {
        id: r.id,
        pavimento: r.pavimento,
        nome_operacional: r.nome_operacional,
        revisao_ultima: r.revisao,
      })
    }
  }
  return { ambientesRemovidos: [...acumulados.values()].sort(porChave), diferencas: dif }
}

export function temDiferencas(dif: Diferencas): boolean {
  return (['novos', 'removidos', 'herdados', 'nome_alterado', 'area_alterada', 'marcador_deslocado'] as const).some(
    (k) => (dif[k]?.length ?? 0) > 0,
  )
}

/** Aplica `marcadores_ajustados` (pinos do editor) da revisão atual. */
function aplicarAjustes(obra: ObraConfig, ambientes: AmbienteTrabalho[], revisar: ItemRevisar[]): void {
  const ajustes = obra.marcadores_ajustados ?? {}
  const porId = new Map(ambientes.map((a) => [a.id, a]))
  const semAmbiente: string[] = []
  for (const [id, ajuste] of Object.entries(ajustes)) {
    if (ajuste.revisao !== obra.revisao) continue
    const a = porId.get(id)
    if (!a) {
      semAmbiente.push(id)
      continue
    }
    if (!Array.isArray(ajuste.marcadores) || ajuste.marcadores.length === 0) {
      falhar(`'marcadores_ajustados' sem pinos para '${id}': todo ambiente precisa de ao menos um`)
    }
    const originais = a.marcadores
    a.marcadores = ajuste.marcadores.map((p, i): Marcador => {
      const x = arredondar(Number(p.x), 6)
      const y = arredondar(Number(p.y), 6)
      if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) falhar(`pino ajustado fora de 0–1 em '${id}'`)
      const orig = originais[i]
      if (!orig) return { x, y, rotulo_bbox: [x, y, x, y] }
      // O recorte de detalhe acompanha o pino: a caixa do rótulo anda junto.
      const dx = x - orig.x
      const dy = y - orig.y
      const rb = orig.rotulo_bbox
      return {
        x,
        y,
        rotulo_bbox: [
          arredondar(rb[0] + dx, 6),
          arredondar(rb[1] + dy, 6),
          arredondar(rb[2] + dx, 6),
          arredondar(rb[3] + dy, 6),
        ],
      }
    })
    revisar.push({ pavimento: a.pavimento, motivo: 'pinos ajustados no editor', nome: a.nome_operacional })
  }
  if (semAmbiente.length) {
    falhar(`'marcadores_ajustados' sem ambiente correspondente na planta: ${repr(semAmbiente.sort())}`)
  }
}

/**
 * Conteúdo do `ambientes.json` a partir da configuração e dos spans (ver `extrair` no Python).
 * `paginas` mapeia o código do pavimento para `{largura, altura, spans}`.
 */
export function extrair(
  obra: ObraConfig,
  paginas: Record<string, PaginaLida>,
  base: BaseExtracao | null = null,
): ResultadoExtracao {
  const nomesFixos = obra.nomes_fixos ?? {}
  const categorias = obra.categorias ?? {}
  const renomear = new Map<string, string>()
  for (const r of obra.renomear ?? []) {
    const chave = chaveRenomear(r.pavimento, r.nome_planta, r.area_m2)
    if (renomear.has(chave)) falhar(`renomear repetido: ${chave}`)
    renomear.set(chave, r.nome_operacional)
  }
  const renomearUsados = new Set<string>()

  const pavimentos = pavimentosOrdenados(obra)
  const ambientes: AmbienteTrabalho[] = []
  const revisar: ItemRevisar[] = []
  for (const pavCfg of pavimentos) {
    const pav = pavCfg.codigo
    const pdf = `${obra.pasta_pdf}/${pavCfg.pdf}`
    const pagina = paginas[pav]
    if (!pagina) falhar(`sem a página do pavimento '${pav}'`)
    const w = pagina.largura
    const h = pagina.altura
    const { pares, orfas } = parearRotulos(pagina.spans)
    for (const texto of orfas) revisar.push({ pavimento: pav, motivo: 'área sem nome acima', rotulo: texto })

    const porChave = new Map<string, AmbienteTrabalho>()
    for (const par of pares) {
      const nome = par.nome.text
      const area = parseArea(par.area.text)
      const nb = par.nome.bbox
      const ab = par.area.bbox
      const rotulo = [Math.min(nb[0], ab[0]), nb[1], Math.max(nb[2], ab[2]), ab[3]]
      const marcador: Marcador = {
        // Pino acima do nome: x no centro do rótulo, y no topo do nome.
        x: arredondar(centroX(nb) / w, 6),
        y: arredondar(nb[1] / h, 6),
        rotulo_bbox: [
          arredondar(rotulo[0] / w, 6),
          arredondar(rotulo[1] / h, 6),
          arredondar(rotulo[2] / w, 6),
          arredondar(rotulo[3] / h, 6),
        ],
      }
      const chave = JSON.stringify([nome, area])
      const existente = porChave.get(chave)
      if (existente) {
        // Mesmo nome e mesma área: um ambiente rotulado duas vezes.
        existente.marcadores.push(marcador)
        continue
      }
      const item: AmbienteTrabalho = {
        id: '',
        pavimento: pav,
        nome_planta: nome,
        nome_operacional: nomeOperacional(nome, nomesFixos),
        categoria: categoria(nome, categorias),
        area_m2: area,
        pdf,
        pagina: pavCfg.pagina ?? 1,
        revisao: obra.revisao,
        marcadores: [marcador],
      }
      const chaveRen = chaveRenomear(pav, nome, area)
      if (renomear.has(chaveRen)) {
        item.nome_operacional = renomear.get(chaveRen)!
        item._renomeado = true
        renomearUsados.add(chaveRen)
      }
      porChave.set(chave, item)
    }

    const itens = [...porChave.values()]
    // Mesmo nome com áreas diferentes: ambientes distintos que precisam de nome próprio.
    const porNome = new Map<string, AmbienteTrabalho[]>()
    for (const item of itens) {
      const g = porNome.get(item.nome_planta!) ?? []
      g.push(item)
      porNome.set(item.nome_planta!, g)
    }
    for (const grupo of porNome.values()) {
      if (grupo.length <= 1) continue
      grupo.sort((a, b) => {
        const na = a.area_m2 === null ? 1 : 0
        const nb2 = b.area_m2 === null ? 1 : 0
        return na - nb2 || (a.area_m2 ?? 0) - (b.area_m2 ?? 0)
      })
      const semNome = grupo.filter((g) => !g._renomeado)
      if (semNome.length > 1) {
        semNome.forEach((item, k) => {
          item.nome_operacional = `${item.nome_operacional} ${k + 1}`
        })
      }
      revisar.push({
        pavimento: pav,
        motivo: semNome.length
          ? 'mesmo nome em ambientes diferentes; numerados provisoriamente'
          : 'mesmo nome em ambientes diferentes; nomes definidos na configuração',
        nomes: grupo.map((g) => g.nome_operacional),
      })
    }
    for (const item of itens) {
      if (item.marcadores.length > 1) {
        revisar.push({
          pavimento: pav,
          motivo: 'ambiente rotulado mais de uma vez; mantidos todos os pinos',
          nome: item.nome_operacional,
        })
      }
      if (item.area_m2 === null) {
        revisar.push({
          pavimento: pav,
          motivo: "área marcada como 'Não incluso' na planta",
          nome: item.nome_operacional,
        })
      }
    }
    for (const manual of obra.ambientes_manuais ?? []) {
      if (manual.pavimento !== pav) continue
      itens.push({ id: '', ...ambienteManual(obra, pavCfg, manual) })
      revisar.push({
        pavimento: pav,
        motivo: 'ambiente sem rótulo na planta; pino colocado à mão',
        nome: manual.nome_operacional,
      })
    }
    for (const item of itens) item.id = `${pav}-${slug(item.nome_operacional)}`
    ambientes.push(...itens)
  }

  const herdados = aplicarManterCodigo(ambientes, obra.manter_codigo ?? {}, base)

  const naoUsados = [...renomear.keys()].filter((k) => !renomearUsados.has(k)).sort()
  if (naoUsados.length) falhar(`'renomear' sem ambiente correspondente na planta: ${naoUsados.join(', ')}`)

  const ids = ambientes.map((a) => a.id)
  const duplicados = [...new Set(ids.filter((i, k) => ids.indexOf(i) !== k))].sort()
  if (duplicados.length) {
    falhar(`ids duplicados: ${repr(duplicados)}${Object.keys(herdados).length ? " (confira 'manter_codigo')" : ''}`)
  }

  aplicarAjustes(obra, ambientes, revisar)

  const codigos = pavimentos.map((p) => p.codigo)
  // Lista sem grupos: ordem alfabética natural (Apto. 2 antes de Apto. 10), ignorando acentos.
  const ordenados = ambientes
    .map((a, i) => ({ a, i, pav: codigos.indexOf(a.pavimento), nome: chaveNatural(a.nome_operacional) }))
    .sort((x, y) => x.pav - y.pav || compararListas(x.nome, y.nome) || x.i - y.i)
    .map(({ a }): Ambiente => ({
      id: a.id,
      pavimento: a.pavimento,
      nome_operacional: a.nome_operacional,
      nome_planta: a.nome_planta,
      categoria: a.categoria,
      area_m2: a.area_m2,
      pdf: a.pdf,
      pagina: a.pagina,
      revisao: a.revisao,
      marcadores: a.marcadores,
    }))
  const { ambientesRemovidos, diferencas } = compararComBase(obra, ordenados, herdados, base)
  return {
    obra: obra.slug,
    fonte: `${obra.pasta_pdf}/ (configuração em data/${obra.slug}/obra.json)`,
    status: obra.status,
    revisao_humana: obra.revisao_humana ?? null,
    coordenadas:
      'marcadores normalizados na página do PDF (0–1, origem no canto superior esquerdo); ' +
      'x = centro do rótulo, y = topo do nome; o pino é desenhado acima desse ponto',
    pavimentos: pavimentos.map((p) => ({ id: p.codigo, nome: p.nome })),
    ambientes: ordenados,
    revisar,
    ambientes_removidos: ambientesRemovidos,
    diferencas,
  }
}
