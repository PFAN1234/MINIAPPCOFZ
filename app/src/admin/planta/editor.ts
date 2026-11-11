/**
 * Regras do editor de planta (sem React): estado das edições, configuração do pavimento,
 * base do banco, extração e a configuração que a publicação grava em `obra_config`.
 *
 * As edições viram campos da configuração, no formato do `obra.json`:
 * - renomear um ambiente rotulado → `renomear` (pavimento + nome na planta + área); se o
 *   ambiente já existe no banco, o código antigo fica em `manter_codigo`;
 * - categoria de um ambiente rotulado → `categorias` (vale para o nome na planta);
 * - ambiente sem rótulo → `ambientes_manuais`;
 * - pino arrastado ou removido → `marcadores_ajustados` (só na revisão em que foi feito);
 * - "é o mesmo ambiente" na nova revisão → `manter_codigo`.
 */
import { extrair, REVISAO_DO_PDF, slug } from './extrair.ts'
import {
  ErroPlanta,
  type AjusteMarcadores,
  type Ambiente,
  type AmbienteManual,
  type BaseExtracao,
  type ObraConfig,
  type PaginaLida,
  type Prancha,
  type Renomear,
  type ResultadoExtracao,
} from './tipos.ts'
import type { ConfigObra, DadosEditorPlanta } from '../dados/tipos.ts'

export const PRANCHA_PADRAO: Prancha = { recorte_edificio: [0.02, 0.02, 0.98, 0.98], mascaras: [] }
export const REVISAO_VALIDA = /^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/

interface PavimentoNaConfig {
  codigo: string
  pdf?: string
  pagina?: number
  revisao?: string
  prancha?: Prancha
  [chave: string]: unknown
}

/** O que o admin muda no editor (campos da configuração de toda a obra). */
export interface EstadoEdicao {
  revisao: string
  pdfNome: string
  pagina: number
  prancha: Prancha
  /** Gravar o recorte e as máscaras para todos os pavimentos (senão, só neste). */
  pranchaParaTodos: boolean
  nomes_fixos: Record<string, string>
  categorias: Record<string, string>
  renomear: Renomear[]
  ambientes_manuais: AmbienteManual[]
  manter_codigo: Record<string, string>
  marcadores_ajustados: Record<string, AjusteMarcadores>
}

function copia<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

function pavimentosDaConfig(config: ConfigObra | null): PavimentoNaConfig[] {
  const l = config?.pavimentos
  return Array.isArray(l) ? (l as PavimentoNaConfig[]) : []
}

export function edicaoInicial(dados: DadosEditorPlanta, pav: string): EstadoEdicao {
  const c = (dados.config ?? {}) as Partial<ObraConfig>
  const entrada = pavimentosDaConfig(dados.config).find((p) => p.codigo === pav)
  const pavDados = dados.pavimentos.find((p) => p.codigo === pav)
  return {
    revisao: pavDados?.planta?.revisao ?? entrada?.revisao ?? (typeof c.revisao === 'string' ? c.revisao : ''),
    pdfNome: entrada?.pdf ?? '',
    pagina: entrada?.pagina ?? 1,
    prancha: copia(entrada?.prancha ?? c.prancha ?? PRANCHA_PADRAO),
    pranchaParaTodos: !entrada?.prancha,
    nomes_fixos: copia(c.nomes_fixos ?? {}),
    categorias: copia(c.categorias ?? {}),
    renomear: copia(c.renomear ?? []),
    ambientes_manuais: copia(c.ambientes_manuais ?? []),
    manter_codigo: copia(c.manter_codigo ?? {}),
    marcadores_ajustados: copia(c.marcadores_ajustados ?? {}),
  }
}

/** Pavimento de cada código conhecido no banco (ativos e inativos). */
function pavimentoNoBanco(dados: DadosEditorPlanta): Map<string, string> {
  return new Map(dados.ambientes.map((a) => [a.codigo, a.pavimento]))
}

/** Pertence ao pavimento: pelo banco, ou pelo prefixo do código quando ainda não existe. */
function doPavimento(dados: DadosEditorPlanta, pav: string, codigo: string): boolean {
  const noBanco = pavimentoNoBanco(dados).get(codigo)
  return noBanco !== undefined ? noBanco === pav : codigo.startsWith(`${pav}-`)
}

/** Base da extração: o estado do banco no pavimento (ativos = lista, inativos = removidos). */
export function baseDoBanco(dados: DadosEditorPlanta, pav: string): BaseExtracao | null {
  const doPav = dados.ambientes.filter((a) => a.pavimento === pav)
  if (doPav.length === 0) return null
  return {
    ambientes: doPav
      .filter((a) => a.ativo)
      .map((a) => ({
        id: a.codigo,
        pavimento: a.pavimento,
        nome_operacional: a.nome_operacional,
        nome_planta: a.nome_planta,
        area_m2: a.area_m2 === null ? null : Number(a.area_m2),
        revisao: a.revisao_planta,
        marcadores: (a.marcadores ?? []).map((m) => ({ x: Number(m.x), y: Number(m.y) })),
      })),
    ambientes_removidos: doPav
      .filter((a) => !a.ativo)
      .map((a) => ({
        id: a.codigo,
        pavimento: a.pavimento,
        nome_operacional: a.nome_operacional,
        revisao_ultima: a.revisao_planta,
      })),
    diferencas: null,
  }
}

/** Configuração reduzida ao pavimento, no formato que o extrator espera. */
export function configDoPavimento(dados: DadosEditorPlanta, pav: string, e: EstadoEdicao): ObraConfig {
  const c = (dados.config ?? {}) as Partial<ObraConfig>
  const pavDados = dados.pavimentos.find((p) => p.codigo === pav)
  if (!pavDados) throw new ErroPlanta(`Pavimento não encontrado: ${pav}`)
  return {
    slug: dados.obra.slug,
    nome: dados.obra.nome,
    status: 'aguardando_revisao_humana',
    revisao: e.revisao,
    pasta_pdf: typeof c.pasta_pdf === 'string' ? c.pasta_pdf : `DOCS ${dados.obra.slug.toUpperCase()}/PDF`,
    pavimentos: [{ codigo: pav, nome: pavDados.nome, ordem: pavDados.ordem, pdf: e.pdfNome || 'planta.pdf', pagina: e.pagina }],
    prancha: e.prancha,
    nomes_fixos: e.nomes_fixos,
    categorias: e.categorias,
    renomear: e.renomear.filter((r) => r.pavimento === pav),
    ambientes_manuais: e.ambientes_manuais.filter((m) => m.pavimento === pav),
    manter_codigo: Object.fromEntries(Object.entries(e.manter_codigo).filter(([, v]) => doPavimento(dados, pav, v))),
    marcadores_ajustados: Object.fromEntries(
      Object.entries(e.marcadores_ajustados).filter(([k]) => doPavimento(dados, pav, k)),
    ),
    revisao_humana: null,
  }
}

export interface Extracao {
  resultado: ResultadoExtracao
  /** Configuração efetiva do pavimento (sem entradas que não valem mais). */
  config: ObraConfig
  /** Entradas da configuração ignoradas por não corresponderem à planta. */
  ignorados: string[]
}

/**
 * Extrai os ambientes do pavimento. Entradas antigas que não batem mais com a planta
 * (`renomear` de outra área, `manter_codigo` de um nome que mudou, pinos de outro código)
 * são ignoradas e relatadas, em vez de travar o editor como no script.
 */
export function extrairPavimento(dados: DadosEditorPlanta, pav: string, e: EstadoEdicao, pagina: PaginaLida): Extracao {
  const base = baseDoBanco(dados, pav)
  const cfg = configDoPavimento(dados, pav, e)
  const ignorados: string[] = []
  // 1) Sem renomear/manter/ajustes: os pares (nome na planta, área) que existem.
  const crua = extrair({ ...cfg, renomear: [], manter_codigo: {}, marcadores_ajustados: {} }, { [pav]: pagina }, null)
  const pares = new Set(crua.ambientes.map((a) => JSON.stringify([a.nome_planta, a.area_m2])))
  const renomear = (cfg.renomear ?? []).filter((r) => {
    const ok = pares.has(JSON.stringify([r.nome_planta, r.area_m2 === null ? null : Number(r.area_m2)]))
    if (!ok) ignorados.push(`Renomear "${r.nome_planta}" (${r.area_m2 ?? 'sem área'} m²) → "${r.nome_operacional}": rótulo não está na planta`)
    return ok
  })
  // 2) Códigos calculados com os nomes finais: o que `manter_codigo` pode usar.
  const calc = extrair({ ...cfg, renomear, manter_codigo: {}, marcadores_ajustados: {} }, { [pav]: pagina }, null)
  const calculados = new Set(calc.ambientes.map((a) => a.id))
  const conhecidos = new Set([...(base?.ambientes ?? []), ...(base?.ambientes_removidos ?? [])].map((a) => a.id))
  const manter = Object.fromEntries(
    Object.entries(cfg.manter_codigo ?? {}).filter(([k, v]) => {
      const ok = calculados.has(k) && conhecidos.has(v) && k !== v
      if (!ok) ignorados.push(`Mesmo ambiente ${k} → ${v}: não vale mais nesta planta`)
      return ok
    }),
  )
  // 3) Final; pinos ajustados de códigos que não existem são ignorados.
  const finais = new Set(
    extrair({ ...cfg, renomear, manter_codigo: manter, marcadores_ajustados: {} }, { [pav]: pagina }, base).ambientes.map(
      (a) => a.id,
    ),
  )
  const ajustes = Object.fromEntries(
    Object.entries(cfg.marcadores_ajustados ?? {}).filter(([k, v]) => {
      if (v.revisao !== cfg.revisao) return false
      const ok = finais.has(k)
      if (!ok) ignorados.push(`Pinos ajustados de ${k}: o ambiente não está mais na planta`)
      return ok
    }),
  )
  const config = { ...cfg, renomear, manter_codigo: manter, marcadores_ajustados: ajustes }
  return { resultado: extrair(config, { [pav]: pagina }, base), config, ignorados }
}

// --- Operações de edição -------------------------------------------------------------------------

export function ehManual(a: Pick<Ambiente, 'nome_planta'>): boolean {
  return a.nome_planta === null
}

function indiceManual(e: EstadoEdicao, a: Pick<Ambiente, 'pavimento' | 'nome_operacional'>): number {
  return e.ambientes_manuais.findIndex((m) => m.pavimento === a.pavimento && m.nome_operacional === a.nome_operacional)
}

/** Código no banco (ativo ou inativo) com esse id? */
function existeNoBanco(dados: DadosEditorPlanta, codigo: string): boolean {
  return dados.ambientes.some((a) => a.codigo === codigo)
}

/** Troca a chave de um ajuste de pinos (o código do ambiente mudou). */
function moverAjuste(e: EstadoEdicao, de: string, para: string): void {
  if (de === para || !e.marcadores_ajustados[de]) return
  e.marcadores_ajustados[para] = e.marcadores_ajustados[de]
  delete e.marcadores_ajustados[de]
}

export function renomearAmbiente(dados: DadosEditorPlanta, e0: EstadoEdicao, a: Ambiente, nome: string): EstadoEdicao {
  const novo = nome.trim()
  if (!novo) throw new ErroPlanta('O nome operacional não pode ficar vazio.')
  if (novo === a.nome_operacional) return e0
  const e = copia(e0)
  const calculado = `${a.pavimento}-${slug(novo)}`
  if (ehManual(a)) {
    const i = indiceManual(e, a)
    if (i < 0) throw new ErroPlanta(`Ambiente manual não encontrado: ${a.nome_operacional}`)
    e.ambientes_manuais[i].nome_operacional = novo
  } else {
    const chave = (r: Renomear) =>
      r.pavimento === a.pavimento && r.nome_planta === a.nome_planta && (r.area_m2 ?? null) === (a.area_m2 ?? null)
    e.renomear = [
      ...e.renomear.filter((r) => !chave(r)),
      { pavimento: a.pavimento, nome_planta: a.nome_planta!, area_m2: a.area_m2, nome_operacional: novo },
    ]
  }
  if (existeNoBanco(dados, a.id)) {
    // Mesmo ambiente com outro nome: o código publicado não muda.
    for (const [k, v] of Object.entries(e.manter_codigo)) if (v === a.id) delete e.manter_codigo[k]
    if (calculado !== a.id) e.manter_codigo[calculado] = a.id
  } else {
    moverAjuste(e, a.id, calculado)
  }
  return e
}

export function mudarCategoria(e0: EstadoEdicao, a: Ambiente, cat: string): EstadoEdicao {
  const e = copia(e0)
  if (ehManual(a)) {
    const i = indiceManual(e, a)
    if (i >= 0) e.ambientes_manuais[i].categoria = cat
  } else {
    e.categorias[a.nome_planta!] = cat
  }
  return e
}

function limitar(v: number): number {
  return Math.min(1, Math.max(0, Math.round(v * 1e6) / 1e6))
}

export function moverPino(e0: EstadoEdicao, a: Ambiente, indice: number, x: number, y: number): EstadoEdicao {
  const e = copia(e0)
  if (ehManual(a)) {
    const i = indiceManual(e, a)
    if (i >= 0) e.ambientes_manuais[i].marcador = { x: limitar(x), y: limitar(y) }
    return e
  }
  const pinos = a.marcadores.map((m) => ({ x: m.x, y: m.y }))
  pinos[indice] = { x: limitar(x), y: limitar(y) }
  e.marcadores_ajustados[a.id] = { revisao: e.revisao, marcadores: pinos }
  return e
}

export function removerPino(e0: EstadoEdicao, a: Ambiente, indice: number): EstadoEdicao {
  if (a.marcadores.length <= 1) throw new ErroPlanta('Todo ambiente precisa de ao menos um pino.')
  const e = copia(e0)
  e.marcadores_ajustados[a.id] = {
    revisao: e.revisao,
    marcadores: a.marcadores.filter((_, i) => i !== indice).map((m) => ({ x: m.x, y: m.y })),
  }
  return e
}

/** Volta os pinos do ambiente para os do rótulo. */
export function restaurarPinos(e0: EstadoEdicao, a: Ambiente): EstadoEdicao {
  const e = copia(e0)
  delete e.marcadores_ajustados[a.id]
  return e
}

export function incluirManual(
  e0: EstadoEdicao,
  pav: string,
  nome: string,
  categoria: string,
  x: number,
  y: number,
): EstadoEdicao {
  const n = nome.trim()
  if (!n) throw new ErroPlanta('Informe o nome do ambiente.')
  const e = copia(e0)
  e.ambientes_manuais.push({ pavimento: pav, nome_operacional: n, categoria, marcador: { x: limitar(x), y: limitar(y) } })
  return e
}

export function removerManual(e0: EstadoEdicao, a: Ambiente): EstadoEdicao {
  const e = copia(e0)
  const i = indiceManual(e, a)
  if (i >= 0) e.ambientes_manuais.splice(i, 1)
  return e
}

/** "É o mesmo ambiente": o novo (código calculado) herda o código antigo. */
export function confirmarMesmo(e0: EstadoEdicao, idNovo: string, idAntigo: string): EstadoEdicao {
  const e = copia(e0)
  for (const [k, v] of Object.entries(e.manter_codigo)) if (v === idAntigo || k === idNovo) delete e.manter_codigo[k]
  e.manter_codigo[idNovo] = idAntigo
  moverAjuste(e, idNovo, idAntigo)
  return e
}

export function desfazerMesmo(e0: EstadoEdicao, idAntigo: string): EstadoEdicao {
  const e = copia(e0)
  for (const [k, v] of Object.entries(e.manter_codigo)) if (v === idAntigo) delete e.manter_codigo[k]
  return e
}

// --- Validações do envio ------------------------------------------------------------------------

/** Problema com a revisão informada (ou null). */
export function problemaRevisao(revisao: string, pdfNome: string): string | null {
  if (!revisao.trim()) return 'Informe a revisão da planta (ex.: R07).'
  if (!REVISAO_VALIDA.test(revisao)) return 'Revisão inválida: use letras, dígitos, ponto, hífen ou sublinhado (ex.: R07).'
  const m = REVISAO_DO_PDF.exec(pdfNome)
  if (m && m[1].toUpperCase() !== revisao.toUpperCase()) {
    return `O arquivo ${pdfNome} é da revisão ${m[1]}, mas você informou ${revisao}.`
  }
  return null
}

/** Revisão no nome do arquivo (`...-R07.pdf`), se houver. */
export function revisaoDoNome(nome: string): string | null {
  return REVISAO_DO_PDF.exec(nome)?.[1].toUpperCase() ?? null
}

// --- Configuração gravada na publicação ---------------------------------------------------------

/** `obra_config` depois da publicação do pavimento (o resto da obra fica como estava). */
export function configParaSalvar(dados: DadosEditorPlanta, pav: string, e: EstadoEdicao, efetiva: ObraConfig): ConfigObra {
  const c: ConfigObra = copia(dados.config ?? {})
  c.status = 'aguardando_revisao_humana'
  c.revisao = e.revisao
  if (typeof c.pasta_pdf !== 'string') c.pasta_pdf = efetiva.pasta_pdf
  const pavimentos = pavimentosDaConfig(c)
  let entrada = pavimentos.find((p) => p.codigo === pav)
  if (!entrada) {
    entrada = { codigo: pav }
    pavimentos.push(entrada)
  }
  entrada.pdf = e.pdfNome
  entrada.pagina = e.pagina
  entrada.revisao = e.revisao
  if (e.pranchaParaTodos) {
    c.prancha = copia(e.prancha)
    delete entrada.prancha
  } else {
    entrada.prancha = copia(e.prancha)
    if (!c.prancha) c.prancha = copia(e.prancha)
  }
  c.pavimentos = pavimentos
  c.nomes_fixos = copia(e.nomes_fixos)
  c.categorias = copia(e.categorias)
  c.renomear = [...e.renomear.filter((r) => r.pavimento !== pav), ...copia(efetiva.renomear ?? [])]
  c.ambientes_manuais = copia(e.ambientes_manuais)
  c.manter_codigo = {
    ...Object.fromEntries(Object.entries(e.manter_codigo).filter(([, v]) => !doPavimento(dados, pav, v))),
    ...copia(efetiva.manter_codigo ?? {}),
  }
  c.marcadores_ajustados = {
    ...Object.fromEntries(Object.entries(e.marcadores_ajustados).filter(([k]) => !doPavimento(dados, pav, k))),
    ...copia(efetiva.marcadores_ajustados ?? {}),
  }
  return c
}
