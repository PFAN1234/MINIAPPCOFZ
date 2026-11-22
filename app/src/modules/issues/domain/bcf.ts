/**
 * Mapeamento Issue ↔ tópico BCF (etapa 7D). Funções puras, sem `three` nem DOM: o zip e o XML ficam
 * em `infra/bcf/`. O modelo `PacoteBcf` abaixo é neutro quanto à versão (2.1 ou 3.0).
 *
 * EIXOS. A cena 3D é three.js (Y para cima); o IFC e o BCF são Z para cima. O `.frag` sai do
 * web-ifc já em Y-up: (x, y, z)ifc → (x, z, -y)cena, ou seja, o inverso é (x, y, z)cena → (x, -z, y)ifc.
 * É a mesma troca que o `Viewpoint.serialize` do `@thatopen/components` 3.6 faz na câmera
 * (`<Y>${-z}</Y><Z>${y}</Z>`). Direções (câmera, normais dos cortes) usam só a rotação.
 *
 * DESLOCAMENTO DE COORDENAÇÃO. O Fragments grava no `.frag` as coordenadas do modelo (`getCoordinates()`)
 * e, ao carregar, move a cena para que o primeiro modelo fique na origem (`baseCoordinationMatrix`).
 * Logo mundo(Y-up) = cena + coordenadas do modelo-base. `origemCena` é esse vetor (as 3 primeiras
 * posições de `getCoordinates()` do modelo-base, em metros, Y-up). A porta do motor ainda não o expõe,
 * então o painel usa [0, 0, 0]: ida e volta no próprio app é exata, mas outra ferramenta vê as
 * posições relativas ao modelo-base, sem a coordenada de mundo.
 */
import type { Ponto3, RefElemento, Vista } from '../../modelos/domain/central.ts'
import {
  COMENTARIO_MAX,
  TITULO_MAX,
  type Issue,
  type IssueComentario,
  type IssueVista,
  type PrioridadeIssue,
  type StatusIssue,
  type TipoIssue,
  type TopicoBcf,
} from './issues.ts'

export type VersaoBcf = '2.1' | '3.0'
export const VERSOES_BCF: readonly VersaoBcf[] = ['2.1', '3.0']

export interface BcfCamera {
  projecao: 'perspectiva' | 'ortografica'
  /** IFC, Z para cima, metros. */
  posicao: Ponto3
  direcao: Ponto3
  cima: Ponto3
  proporcao: number
  /** FieldOfView (graus) na perspectiva; ViewToWorldScale (altura visível, m) na ortográfica. */
  campo: number
}

export interface BcfViewpoint {
  guid: string
  camera: BcfCamera | null
  planos: { origem: Ponto3; direcao: Ponto3 }[]
  /** GlobalIds IFC. */
  selecionados: string[]
  /** `DefaultVisibility`: true = tudo visível salvo as exceções (ocultas); false = tudo oculto salvo as exceções. */
  visibilidadePadrao: boolean
  excecoes: string[]
  /** PNG ou JPEG do snapshot, se houver. */
  snapshot: Uint8Array | null
}

export interface BcfComentario {
  guid: string
  data: string | null
  autor: string | null
  texto: string
  viewpointGuid: string | null
}

export interface BcfTopico {
  guid: string
  tipo: string | null
  status: string | null
  prioridade: string | null
  titulo: string
  descricao: string | null
  criadoEm: string | null
  autor: string | null
  modificadoEm: string | null
  modificadoPor: string | null
  prazo: string | null
  responsavel: string | null
  etiquetas: string[]
  etapa: string | null
  viewpoints: BcfViewpoint[]
  comentarios: BcfComentario[]
}

export interface PacoteBcf {
  versao: VersaoBcf
  projeto: { id: string; nome: string } | null
  topicos: BcfTopico[]
}

/** Autor que o arquivo leva quando o app não sabe (o BCF exige o campo); ignorado ao importar. */
export const AUTOR_DESCONHECIDO = 'desconhecido'
/** Distância (m) do alvo à câmera ao importar: o BCF guarda a direção, não o ponto de interesse. */
export const DISTANCIA_ALVO = 10
const PROPORCAO_PADRAO = 16 / 9

// --- Eixos --------------------------------------------------------------------------------------

const ZERO: Ponto3 = [0, 0, 0]
/** `-0` vira `0` (só estética no XML e nas comparações). */
const n0 = (n: number) => (n === 0 ? 0 : n)

/** Ponto da cena (Y-up) → IFC (Z-up), somando o deslocamento de coordenação. */
export function pontoCenaParaIfc(p: Ponto3, origemCena: Ponto3 = ZERO): Ponto3 {
  return [n0(p[0] + origemCena[0]), n0(-(p[2] + origemCena[2])), n0(p[1] + origemCena[1])]
}

/** Ponto IFC (Z-up) → cena (Y-up), tirando o deslocamento de coordenação. */
export function pontoIfcParaCena(p: Ponto3, origemCena: Ponto3 = ZERO): Ponto3 {
  return [n0(p[0] - origemCena[0]), n0(p[2] - origemCena[1]), n0(-p[1] - origemCena[2])]
}

/** Direção da cena → IFC (só a rotação). */
export function direcaoCenaParaIfc(d: Ponto3): Ponto3 {
  return [n0(d[0]), n0(-d[2]), n0(d[1])]
}

/** Direção IFC → cena. */
export function direcaoIfcParaCena(d: Ponto3): Ponto3 {
  return [n0(d[0]), n0(d[2]), n0(-d[1])]
}

function normalizar(v: Ponto3): Ponto3 | null {
  const n = Math.hypot(v[0], v[1], v[2])
  return n < 1e-9 || !Number.isFinite(n) ? null : [v[0] / n, v[1] / n, v[2] / n]
}
const ponto3Finito = (v: Ponto3) => v.every((n) => Number.isFinite(n))

/** "Para cima" do IFC (+Z) sem a componente ao longo da direção; olhando na vertical, usa +Y. */
function cimaIfc(d: Ponto3): Ponto3 {
  const proj = (z: Ponto3): Ponto3 | null => {
    const k = z[0] * d[0] + z[1] * d[1] + z[2] * d[2]
    return normalizar([z[0] - k * d[0], z[1] - k * d[1], z[2] - k * d[2]])
  }
  return proj([0, 0, 1]) ?? proj([0, 1, 0]) ?? [0, 1, 0]
}

// --- Enumerações --------------------------------------------------------------------------------

const chave = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z0-9]/g, '')

const STATUS_PARA_BCF: Record<StatusIssue, string> = {
  aberta: 'Open',
  em_andamento: 'In Progress',
  resolvida: 'Resolved',
  fechada: 'Closed',
}
const STATUS_DE_BCF: Record<string, StatusIssue> = {
  open: 'aberta',
  aberta: 'aberta',
  new: 'aberta',
  active: 'aberta',
  inprogress: 'em_andamento',
  emandamento: 'em_andamento',
  assigned: 'em_andamento',
  resolved: 'resolvida',
  solved: 'resolvida',
  resolvida: 'resolvida',
  closed: 'fechada',
  done: 'fechada',
  fechada: 'fechada',
}

const PRIORIDADE_PARA_BCF: Record<PrioridadeIssue, string> = {
  baixa: 'Low',
  normal: 'Normal',
  alta: 'High',
  critica: 'Critical',
}
const PRIORIDADE_DE_BCF: Record<string, PrioridadeIssue> = {
  low: 'baixa',
  minor: 'baixa',
  baixa: 'baixa',
  normal: 'normal',
  medium: 'normal',
  media: 'normal',
  high: 'alta',
  major: 'alta',
  alta: 'alta',
  critical: 'critica',
  urgent: 'critica',
  blocker: 'critica',
  critica: 'critica',
}

const TIPO_PARA_BCF: Record<TipoIssue, string> = {
  problema: 'Issue',
  duvida: 'Request',
  conflito: 'Clash',
  pendencia: 'Todo',
}
const TIPO_DE_BCF: Record<string, TipoIssue> = {
  issue: 'problema',
  error: 'problema',
  fault: 'problema',
  defect: 'problema',
  problem: 'problema',
  warning: 'problema',
  problema: 'problema',
  request: 'duvida',
  question: 'duvida',
  query: 'duvida',
  info: 'duvida',
  remark: 'duvida',
  duvida: 'duvida',
  clash: 'conflito',
  clashing: 'conflito',
  conflict: 'conflito',
  collision: 'conflito',
  conflito: 'conflito',
  todo: 'pendencia',
  task: 'pendencia',
  pending: 'pendencia',
  pendencia: 'pendencia',
}

export const statusParaBcf = (s: StatusIssue) => STATUS_PARA_BCF[s] ?? 'Open'
export const prioridadeParaBcf = (p: PrioridadeIssue) => PRIORIDADE_PARA_BCF[p] ?? 'Normal'
export const tipoParaBcf = (t: TipoIssue) => TIPO_PARA_BCF[t] ?? 'Issue'
/** Status desconhecido ou ausente vira `aberta`. */
export const statusDeBcf = (s: string | null | undefined): StatusIssue => STATUS_DE_BCF[chave(s ?? '')] ?? 'aberta'
/** Prioridade desconhecida ou ausente vira `normal`. */
export const prioridadeDeBcf = (p: string | null | undefined): PrioridadeIssue => PRIORIDADE_DE_BCF[chave(p ?? '')] ?? 'normal'
/** Tipo desconhecido ou ausente vira `problema`. */
export const tipoDeBcf = (t: string | null | undefined): TipoIssue => TIPO_DE_BCF[chave(t ?? '')] ?? 'problema'

// --- Campos sem equivalente: prefixo legível na descrição / no comentário ------------------------

export const PREFIXO_BCF = '[BCF]'
const ROTULO_RESPONSAVEL = 'Responsável'
const ROTULO_ETIQUETAS = 'Etiquetas'
const ROTULO_ETAPA = 'Etapa'
const ROTULO_AUTOR = 'Autor'
const ROTULOS_DESCRICAO = [ROTULO_RESPONSAVEL, ROTULO_ETIQUETAS, ROTULO_ETAPA, ROTULO_AUTOR] as const
export type ExtrasBcf = Partial<Record<(typeof ROTULOS_DESCRICAO)[number], string>>

const RE_LINHA_EXTRA = new RegExp(`^\\[BCF\\] (${ROTULOS_DESCRICAO.join('|')}): (.*)$`)

/** Separa as linhas "[BCF] Rótulo: valor" do texto livre da descrição (a última de cada rótulo vence). */
export function separarExtras(descricao: string | null | undefined): { texto: string; extras: ExtrasBcf } {
  const extras: ExtrasBcf = {}
  const resto: string[] = []
  for (const linha of (descricao ?? '').split(/\r?\n/)) {
    const m = RE_LINHA_EXTRA.exec(linha.trimEnd())
    if (m) {
      const v = m[2].trim()
      if (v) extras[m[1] as keyof ExtrasBcf] = v
    } else resto.push(linha)
  }
  return { texto: resto.join('\n').trim(), extras }
}

/** Texto livre seguido das linhas de extras (quem chama já separou o que havia, então não repete). */
export function juntarExtras(texto: string, extras: ExtrasBcf): string | null {
  const linhas = ROTULOS_DESCRICAO.filter((r) => extras[r]).map((r) => `${PREFIXO_BCF} ${r}: ${extras[r]}`)
  const todo = [texto.trim(), linhas.join('\n')].filter(Boolean).join('\n\n')
  return todo || null
}

const RE_AUTOR_COMENTARIO = /^\[BCF\] Autor: ([^\n]*)(?:\n|$)/

function separarAutorComentario(texto: string): { autor: string | null; texto: string } {
  const m = RE_AUTOR_COMENTARIO.exec(texto)
  if (!m) return { autor: null, texto: texto.trim() }
  return { autor: m[1].trim() || null, texto: texto.slice(m[0].length).trim() }
}

const naoVazio = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null)

// --- Vista ↔ viewpoint --------------------------------------------------------------------------

const unicos = (xs: string[]) => [...new Set(xs)]

export function vistaParaViewpoint(vista: Vista, guid: string, origemCena: Ponto3 = ZERO): BcfViewpoint {
  const { camera } = vista
  const dir =
    normalizar([
      camera.alvo[0] - camera.posicao[0],
      camera.alvo[1] - camera.posicao[1],
      camera.alvo[2] - camera.posicao[2],
    ]) ?? [0, 0, -1]
  const direcao = direcaoCenaParaIfc(dir)
  const ortografica = camera.projecao === 'ortografica'
  const isolados = vista.isolados && vista.isolados.length > 0 ? vista.isolados : null
  const ids = (refs: RefElemento[]) => unicos(refs.map((r) => r.globalId))
  return {
    guid,
    camera: {
      projecao: camera.projecao,
      posicao: pontoCenaParaIfc(camera.posicao, origemCena),
      direcao,
      cima: cimaIfc(direcao),
      proporcao: PROPORCAO_PADRAO,
      campo: camera.campo && camera.campo > 0 ? camera.campo : ortografica ? 10 : 50,
    },
    planos: vista.cortes.map((c) => ({
      origem: pontoCenaParaIfc(c.origem, origemCena),
      direcao: direcaoCenaParaIfc(c.normal),
    })),
    selecionados: ids(vista.selecionados),
    // Isolar = tudo oculto menos as exceções; senão, tudo visível menos os ocultos.
    visibilidadePadrao: isolados === null,
    excecoes: isolados
      ? ids(isolados.filter((r) => !vista.ocultos.some((o) => o.globalId === r.globalId)))
      : ids(vista.ocultos),
    snapshot: null,
  }
}

/** Todos os GlobalIds citados pelos viewpoints do tópico (seleção e exceções), sem repetir. */
export function globalIdsDoTopico(t: BcfTopico): string[] {
  return unicos(t.viewpoints.flatMap((vp) => [...vp.selecionados, ...vp.excecoes]))
}

/**
 * Viewpoint → vista. `siglaDe` dá a disciplina carregada que contém o GlobalId (`null` = não achou:
 * o elemento é descartado e contado). Sem câmera válida não há vista (`null`).
 */
export function viewpointParaVista(
  vp: BcfViewpoint,
  siglaDe: (globalId: string) => string | null,
  origemCena: Ponto3 = ZERO,
): { vista: Vista; descartados: number } | null {
  const cam = vp.camera
  if (!cam || !ponto3Finito(cam.posicao) || !ponto3Finito(cam.direcao)) return null
  const dirIfc = normalizar(cam.direcao)
  if (!dirIfc) return null
  const ausentes = new Set<string>()
  const refs = (ids: string[]): RefElemento[] =>
    unicos(ids).flatMap((globalId) => {
      const sigla = siglaDe(globalId)
      if (sigla === null) {
        ausentes.add(globalId)
        return []
      }
      return [{ sigla, globalId }]
    })
  const posicao = pontoIfcParaCena(cam.posicao, origemCena)
  const d = direcaoIfcParaCena(dirIfc)
  const alvo: Ponto3 = [
    posicao[0] + d[0] * DISTANCIA_ALVO,
    posicao[1] + d[1] * DISTANCIA_ALVO,
    posicao[2] + d[2] * DISTANCIA_ALVO,
  ]
  const selecionados = refs(vp.selecionados)
  const excecoes = refs(vp.excecoes)
  const vista: Vista = {
    camera: {
      posicao,
      alvo,
      projecao: cam.projecao,
      ...(Number.isFinite(cam.campo) && cam.campo > 0 ? { campo: cam.campo } : {}),
    },
    cortes: vp.planos
      .filter((p) => ponto3Finito(p.origem) && ponto3Finito(p.direcao) && normalizar(p.direcao))
      .map((p) => ({
        origem: pontoIfcParaCena(p.origem, origemCena),
        normal: direcaoIfcParaCena(normalizar(p.direcao) as Ponto3),
      })),
    selecionados,
    ocultos: vp.visibilidadePadrao ? excecoes : [],
    isolados: !vp.visibilidadePadrao && excecoes.length > 0 ? excecoes : null,
  }
  return { vista, descartados: ausentes.size }
}

// --- Issue → tópico -----------------------------------------------------------------------------

export interface OpcoesParaBcf {
  origemCena?: Ponto3
  /** Snapshot de cada vista, por `guid` da vista. */
  imagens?: ReadonlyMap<string, Uint8Array | null>
}

export function issueParaTopicoBcf(issue: Issue, opcoes: OpcoesParaBcf = {}): BcfTopico {
  const { texto, extras } = separarExtras(issue.descricao)
  const vistasPorId = new Map(issue.vistas.map((v) => [v.id, v]))
  return {
    guid: issue.guid,
    tipo: tipoParaBcf(issue.tipo),
    status: statusParaBcf(issue.status),
    prioridade: prioridadeParaBcf(issue.prioridade),
    titulo: issue.titulo,
    descricao: texto || null,
    criadoEm: issue.criadoEm,
    autor: naoVazio(issue.criadoPorNome) ?? extras[ROTULO_AUTOR] ?? AUTOR_DESCONHECIDO,
    modificadoEm: issue.atualizadoEm,
    modificadoPor: null,
    prazo: issue.prazo,
    responsavel: naoVazio(issue.responsavelNome) ?? extras[ROTULO_RESPONSAVEL] ?? null,
    etiquetas: (extras[ROTULO_ETIQUETAS] ?? '')
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean),
    etapa: extras[ROTULO_ETAPA] ?? null,
    viewpoints: issue.vistas.map((v: IssueVista) => ({
      ...vistaParaViewpoint(v.vista, v.guid, opcoes.origemCena),
      snapshot: opcoes.imagens?.get(v.guid) ?? null,
    })),
    comentarios: issue.comentarios.map((c: IssueComentario) => {
      const { autor, texto: t } = separarAutorComentario(c.texto)
      return {
        guid: c.guid,
        data: c.criadoEm,
        autor: naoVazio(c.autorNome) ?? autor ?? AUTOR_DESCONHECIDO,
        texto: t || c.texto,
        viewpointGuid: (c.vistaId && vistasPorId.get(c.vistaId)?.guid) || null,
      }
    }),
  }
}

// --- Tópico BCF → TopicoBcf (porta de importação) -----------------------------------------------

export interface ResultadoTopico {
  topico: TopicoBcf
  /** GlobalIds sem disciplina carregada que os contenha (somados nas vistas). */
  descartados: number
}

function dataIso(s: string | null): string | null {
  if (!s) return null
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

/** Prazo AAAA-MM-DD a partir do `DueDate` (usa a data como escrita no arquivo, sem mudar de fuso). */
export function prazoDeBcf(s: string | null | undefined): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec((s ?? '').trim())
  if (!m) return null
  const d = new Date(`${m[1]}T00:00:00Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== m[1] ? null : m[1]
}

export function topicoBcfParaTopico(
  t: BcfTopico,
  opcoes: { siglaDe: (globalId: string) => string | null; origemCena?: Ponto3 },
): ResultadoTopico {
  const { texto, extras } = separarExtras(t.descricao)
  const novos: ExtrasBcf = { ...extras }
  const real = (s: string | null) => (s && s.trim() !== AUTOR_DESCONHECIDO ? naoVazio(s) : null)
  const responsavel = naoVazio(t.responsavel)
  if (responsavel) novos[ROTULO_RESPONSAVEL] = responsavel
  const etiquetas = t.etiquetas.map((e) => e.trim()).filter(Boolean)
  if (etiquetas.length) novos[ROTULO_ETIQUETAS] = etiquetas.join(', ')
  const etapa = naoVazio(t.etapa)
  if (etapa) novos[ROTULO_ETAPA] = etapa
  const autor = real(t.autor)
  if (autor) novos[ROTULO_AUTOR] = autor

  let descartados = 0
  const vistas: NonNullable<TopicoBcf['vistas']> = []
  for (const vp of t.viewpoints) {
    const r = viewpointParaVista(vp, opcoes.siglaDe, opcoes.origemCena)
    if (!r) continue
    descartados += r.descartados
    vistas.push({ guid: vp.guid, vista: r.vista })
  }
  const guidsVista = new Set(vistas.map((v) => v.guid))

  const comentarios: NonNullable<TopicoBcf['comentarios']> = []
  for (const c of t.comentarios) {
    const corpo = separarAutorComentario(c.texto).texto
    if (!corpo) continue
    const autorC = real(c.autor)
    comentarios.push({
      guid: c.guid,
      texto: (autorC ? `${PREFIXO_BCF} ${ROTULO_AUTOR}: ${autorC}\n${corpo}` : corpo).slice(0, COMENTARIO_MAX),
      criadoEm: dataIso(c.data),
      vistaGuid: c.viewpointGuid && guidsVista.has(c.viewpointGuid) ? c.viewpointGuid : null,
    })
  }

  return {
    topico: {
      guid: t.guid,
      titulo: t.titulo.trim().slice(0, TITULO_MAX).trim() || 'Sem título',
      descricao: juntarExtras(texto, novos),
      tipo: tipoDeBcf(t.tipo),
      prioridade: prioridadeDeBcf(t.prioridade),
      status: statusDeBcf(t.status),
      prazo: prazoDeBcf(t.prazo),
      criadoEm: dataIso(t.criadoEm),
      vistas,
      comentarios,
    },
    descartados,
  }
}
