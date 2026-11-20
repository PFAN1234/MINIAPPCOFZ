/**
 * Tipos e regras puras da Central de modelos (visualizador do admin): referência a elementos,
 * árvore de itens, categorias, vistas salvas. Sem three nem That Open: o motor 3D fica em
 * `infra/thatopen/` atrás da porta `MotorVisualizador`.
 */

export type Ponto3 = [number, number, number]

/** Elemento IFC de uma disciplina: `sigla` + GlobalId (estável entre revisões). */
export interface RefElemento {
  sigla: string
  globalId: string
  classe?: string
  nome?: string
}

export type Projecao = 'perspectiva' | 'ortografica'

export interface CorteVista {
  origem: Ponto3
  normal: Ponto3
}

/** Estado da câmera e da visibilidade: base das vistas salvas e dos marcadores de issue. */
export interface Vista {
  camera: { posicao: Ponto3; alvo: Ponto3; projecao: Projecao; campo?: number }
  cortes: CorteVista[]
  selecionados: RefElemento[]
  ocultos: RefElemento[]
  isolados: RefElemento[] | null
  cores?: { refs: RefElemento[]; cor: string }[]
}

export type NivelArvore = 'projeto' | 'edificio' | 'pavimento' | 'elemento' | 'outro'

/** Nó da árvore projeto › edifício › pavimento › elementos. Só os elementos têm `ref`. */
export interface NoArvore {
  id: string
  rotulo: string
  nivel: NivelArvore
  classe: string | null
  sigla: string
  ref?: RefElemento
  filhos: NoArvore[]
}

export interface GrupoPropriedades {
  nome: string
  itens: { nome: string; valor: string }[]
}

export interface FiltroAtributo {
  classe?: string
  grupo?: string
  atributo?: string
  operador: 'contem' | 'igual' | 'diferente' | 'existe'
  valor?: string
}

export interface Corte {
  id: string
  origem: Ponto3
  normal: Ponto3
}

export interface Medida {
  id: string
  tipo: 'distancia' | 'area' | 'volume' | 'angulo'
  valor: number
  unidade: string
  pontos: Ponto3[]
}

export interface CategoriaTotal {
  classe: string
  total: number
}

/** Falha de carga de uma ou mais disciplinas (as demais carregaram normalmente). */
export class ErroCarregamento extends Error {
  readonly siglas: string[]
  constructor(siglas: string[], detalhe?: string) {
    super(`Falha ao carregar: ${siglas.join(', ')}${detalhe ? ` (${detalhe})` : ''}`)
    this.name = 'ErroCarregamento'
    this.siglas = siglas
  }
}

/** Nó da estrutura espacial do `.frag` (classe IFC e id local no modelo). */
export interface NoEstrutura {
  category: string | null
  localId: number | null
  children?: NoEstrutura[]
}

export interface DadosArvore {
  /** Nome do elemento pelo id local (atributo Name do IFC). */
  nomes: ReadonlyMap<number, string>
  /** GlobalId pelo id local. */
  guids: ReadonlyMap<number, string>
}

export function nivelDaClasse(classe: string | null): NivelArvore {
  switch (classe?.toUpperCase()) {
    case 'IFCPROJECT':
      return 'projeto'
    case 'IFCBUILDING':
      return 'edificio'
    case 'IFCBUILDINGSTOREY':
      return 'pavimento'
    case 'IFCSITE':
      return 'outro'
    default:
      return 'elemento'
  }
}

function rotuloDe(classe: string | null, nome: string | undefined, localId: number | null): string {
  if (nome) return nome
  return `${classe ?? 'Item'}${localId === null ? '' : ` #${localId}`}`
}

/**
 * Converte a estrutura espacial de um modelo em `NoArvore`. Nós sem id local (agrupadores)
 * viram nós `outro`. Os elementos ganham `ref` quando o GlobalId é conhecido.
 */
export function montarArvore(sigla: string, estrutura: NoEstrutura, dados: DadosArvore): NoArvore {
  const converter = (n: NoEstrutura, caminho: string): NoArvore => {
    const nivel = nivelDaClasse(n.category)
    const nome = n.localId === null ? undefined : dados.nomes.get(n.localId)
    const guid = n.localId === null ? undefined : dados.guids.get(n.localId)
    const id = `${caminho}/${n.localId ?? n.category ?? 'x'}`
    const no: NoArvore = {
      id,
      rotulo: nivel === 'projeto' ? (nome ? `${sigla} — ${nome}` : sigla) : rotuloDe(n.category, nome, n.localId),
      nivel: n.localId === null ? 'outro' : nivel,
      classe: n.category,
      sigla,
      filhos: (n.children ?? []).map((f, i) => converter(f, `${id}.${i}`)),
    }
    if (no.nivel === 'elemento' && guid) {
      no.ref = { sigla, globalId: guid, ...(n.category ? { classe: n.category } : {}), ...(nome ? { nome } : {}) }
    }
    return no
  }
  return converter(estrutura, sigla)
}

/**
 * Classe IFC que descreve um elemento construtivo (parede, laje, porta…). Ficam de fora os tipos
 * (`*TYPE`), propriedades, quantidades, materiais, unidades, relações e demais entidades abstratas.
 */
export function ehClasseDeElemento(classe: string): boolean {
  const c = classe.toUpperCase()
  if (!c.startsWith('IFC')) return false
  if (c.endsWith('TYPE')) return false
  return !CLASSES_ESTRUTURAIS.has(c) && !PREFIXOS_ABSTRATOS.some((p) => c.startsWith(p))
}

const CLASSES_ESTRUTURAIS = new Set(['IFCPROJECT', 'IFCSITE', 'IFCBUILDING', 'IFCBUILDINGSTOREY', 'IFCGRID', 'IFCOPENINGELEMENT'])

const PREFIXOS_ABSTRATOS = [
  'IFCPROPERTY',
  'IFCQUANTITY',
  'IFCMATERIAL',
  'IFCREL',
  'IFCUNIT',
  'IFCSIUNIT',
  'IFCDERIVEDUNIT',
  'IFCMEASURE',
  'IFCOWNERHISTORY',
  'IFCPERSON',
  'IFCORGANIZATION',
  'IFCAPPLICATION',
  'IFCPOSTALADDRESS',
  'IFCLOCALPLACEMENT',
  'IFCAXIS2PLACEMENT',
  'IFCCARTESIANPOINT',
  'IFCDIRECTION',
  'IFCGEOMETRIC',
  'IFCPRESENTATION',
  'IFCSTYLE',
  'IFCSURFACESTYLE',
  'IFCCOLOUR',
  'IFCCLASSIFICATION',
  'IFCDOCUMENT',
  'IFCCONSTRAINT',
  'IFCACTORROLE',
  'IFCCONNECTION',
  'IFCSHAPE',
  'IFCPRODUCTDEFINITIONSHAPE',
  'IFCPROJECTLIBRARY',
]

/**
 * Soma as contagens por classe de vários modelos, da maior para a menor (empate: nome).
 * Só entram classes de elementos (ver `ehClasseDeElemento`).
 */
export function agregarCategorias(listas: readonly (readonly CategoriaTotal[])[]): CategoriaTotal[] {
  const soma = new Map<string, number>()
  for (const lista of listas) {
    for (const c of lista) if (c.total > 0 && ehClasseDeElemento(c.classe)) soma.set(c.classe, (soma.get(c.classe) ?? 0) + c.total)
  }
  return [...soma]
    .map(([classe, total]) => ({ classe, total }))
    .sort((a, b) => b.total - a.total || a.classe.localeCompare(b.classe))
}

export type ModoCor = 'nenhum' | 'categoria' | 'disciplina'

const PALETA_CATEGORICA = [
  '#e6550d',
  '#3182bd',
  '#31a354',
  '#756bb1',
  '#d6a31b',
  '#e7298a',
  '#17a2b8',
  '#8c6d31',
  '#636363',
  '#b5cf33',
  '#d94a4a',
  '#2f9e8f',
]

/** Cor categórica (hex) estável para uma chave (classe ou sigla): a mesma chave dá sempre a mesma cor. */
export function corCategorica(chave: string): string {
  let h = 2166136261
  for (const ch of chave.toUpperCase()) {
    h ^= ch.codePointAt(0) ?? 0
    h = Math.imul(h, 16777619) >>> 0
  }
  return PALETA_CATEGORICA[h % PALETA_CATEGORICA.length]
}

const escaparRegex = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Expressão do valor para a busca por atributo; `undefined` quando o operador não compara valor. */
export function expressaoDoFiltro(f: Pick<FiltroAtributo, 'operador' | 'valor'>): RegExp | undefined {
  if (f.operador === 'existe') return undefined
  const v = escaparRegex(f.valor ?? '')
  return f.operador === 'contem' ? new RegExp(v, 'i') : new RegExp(`^${v}$`, 'i')
}

/** Quantos filhos de um nó a lista mostra de cada vez. */
export const LIMITE_FILHOS = 200

/** Fatia os filhos de um nó para a tela, com "mostrar mais" de 200 em 200. */
export function filhosVisiveis<T>(filhos: readonly T[], paginas: number): { itens: T[]; restantes: number } {
  const n = Math.max(1, paginas) * LIMITE_FILHOS
  return { itens: filhos.slice(0, n), restantes: Math.max(0, filhos.length - n) }
}

/** Média ponderada do progresso de várias etapas (cada fração entre 0 e 1). */
export function progressoAgregado(partes: readonly { peso: number; fracao: number }[]): number {
  const total = partes.reduce((s, p) => s + p.peso, 0)
  if (total === 0) return 0
  const feito = partes.reduce((s, p) => s + p.peso * Math.min(1, Math.max(0, p.fracao)), 0)
  return feito / total
}
