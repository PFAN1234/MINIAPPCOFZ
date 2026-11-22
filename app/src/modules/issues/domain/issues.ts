import type { Vista } from '../../modelos/domain/central.ts'

export const TIPOS_ISSUE = ['problema', 'duvida', 'conflito', 'pendencia'] as const
export type TipoIssue = (typeof TIPOS_ISSUE)[number]

export const PRIORIDADES_ISSUE = ['baixa', 'normal', 'alta', 'critica'] as const
export type PrioridadeIssue = (typeof PRIORIDADES_ISSUE)[number]

export const STATUS_ISSUE = ['aberta', 'em_andamento', 'resolvida', 'fechada'] as const
export type StatusIssue = (typeof STATUS_ISSUE)[number]

export const ROTULO_TIPO: Record<TipoIssue, string> = {
  problema: 'Problema',
  duvida: 'Dúvida',
  conflito: 'Conflito',
  pendencia: 'Pendência',
}

export const ROTULO_PRIORIDADE: Record<PrioridadeIssue, string> = {
  baixa: 'Baixa',
  normal: 'Normal',
  alta: 'Alta',
  critica: 'Crítica',
}

export const ROTULO_STATUS: Record<StatusIssue, string> = {
  aberta: 'Aberta',
  em_andamento: 'Em andamento',
  resolvida: 'Resolvida',
  fechada: 'Fechada',
}

export const TITULO_MAX = 200
export const COMENTARIO_MAX = 5000
/** Limite do PNG da vista no bucket `issues`. */
export const IMAGEM_VISTA_MAX_BYTES = 5 * 1024 * 1024

export interface IssueVista {
  id: string
  guid: string
  vista: Vista
  /** Caminho no bucket `issues`; `null` se a imagem não foi enviada. */
  imagemPath: string | null
  criadoEm: string
}

export interface IssueComentario {
  id: string
  guid: string
  autorId: string | null
  autorNome: string | null
  texto: string
  vistaId: string | null
  criadoEm: string
}

export interface Issue {
  id: string
  numero: number
  guid: string
  titulo: string
  descricao: string | null
  tipo: TipoIssue
  prioridade: PrioridadeIssue
  status: StatusIssue
  responsavelId: string | null
  responsavelNome: string | null
  /** AAAA-MM-DD. */
  prazo: string | null
  criadoPor: string | null
  criadoPorNome: string | null
  criadoEm: string
  atualizadoEm: string
  vistas: IssueVista[]
  comentarios: IssueComentario[]
}

/** Dados editáveis ao criar ou atualizar; na atualização só as chaves presentes mudam (`null` limpa). */
export interface DadosIssue {
  titulo?: string
  descricao?: string | null
  tipo?: TipoIssue
  prioridade?: PrioridadeIssue
  status?: StatusIssue
  responsavelId?: string | null
  prazo?: string | null
}

/** Tópico BCF já mapeado, enviado a `admin_importar_bcf` (o mapeamento é da etapa 7D). Reimportar o mesmo `guid` atualiza. */
export interface TopicoBcf {
  guid: string
  titulo: string
  descricao?: string | null
  tipo?: TipoIssue
  prioridade?: PrioridadeIssue
  status?: StatusIssue
  /** AAAA-MM-DD. */
  prazo?: string | null
  criadoEm?: string | null
  vistas?: { guid: string; vista: Vista; criadoEm?: string | null; imagemPath?: string | null }[]
  /** `vistaGuid` aponta para uma vista do mesmo tópico. */
  comentarios?: { guid: string; texto: string; criadoEm?: string | null; vistaGuid?: string | null }[]
}

export interface ResultadoImportacaoBcf {
  criadas: number
  atualizadas: number
}

export function problemaTitulo(titulo: string): string | null {
  const t = titulo.trim()
  if (!t) return 'Informe o título da issue.'
  if (t.length > TITULO_MAX) return `O título deve ter até ${TITULO_MAX} caracteres.`
  return null
}

export function problemaComentario(texto: string): string | null {
  const t = texto.trim()
  if (!t) return 'Escreva o comentário.'
  if (t.length > COMENTARIO_MAX) return `O comentário deve ter até ${COMENTARIO_MAX} caracteres.`
  return null
}

/** Prazo vazio é válido (sem prazo); senão precisa ser uma data real AAAA-MM-DD. */
export function problemaPrazo(prazo: string | null | undefined): string | null {
  if (prazo == null || prazo === '') return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(prazo)) return 'Prazo inválido: use AAAA-MM-DD.'
  const d = new Date(`${prazo}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== prazo) return 'Prazo inválido: a data não existe.'
  return null
}

/** Primeiro problema dos dados informados (só confere o que veio). */
export function problemaIssue(d: DadosIssue): string | null {
  if (d.titulo !== undefined) {
    const p = problemaTitulo(d.titulo)
    if (p) return p
  }
  if (d.tipo !== undefined && !TIPOS_ISSUE.includes(d.tipo)) return 'Tipo inválido.'
  if (d.prioridade !== undefined && !PRIORIDADES_ISSUE.includes(d.prioridade)) return 'Prioridade inválida.'
  if (d.status !== undefined && !STATUS_ISSUE.includes(d.status)) return 'Status inválido.'
  return problemaPrazo(d.prazo)
}

/** Caminho da imagem da vista no bucket `issues`: `<obra_id>/<issue_id>/<vista_id>.png`. */
export function caminhoImagemVista(obraId: string, issueId: string, vistaId: string): string {
  return `${obraId}/${issueId}/${vistaId}.png`
}

export function problemaImagemVista(imagem: Blob): string | null {
  if (imagem.type && imagem.type !== 'image/png') return 'A imagem da vista deve ser PNG.'
  if (imagem.size > IMAGEM_VISTA_MAX_BYTES) return 'A imagem da vista passa de 5 MB.'
  return null
}

export const STATUS_ABERTOS: readonly StatusIssue[] = ['aberta', 'em_andamento']

export type FiltroStatus = 'todas' | 'abertas' | StatusIssue

export function ehAberta(i: Pick<Issue, 'status'>): boolean {
  return STATUS_ABERTOS.includes(i.status)
}

export function filtrarPorStatus<T extends Pick<Issue, 'status'>>(issues: readonly T[], filtro: FiltroStatus): T[] {
  if (filtro === 'todas') return [...issues]
  if (filtro === 'abertas') return issues.filter(ehAberta)
  return issues.filter((i) => i.status === filtro)
}

export type OrdemIssues = 'numero' | 'prioridade' | 'prazo' | 'atualizacao'

const PESO_PRIORIDADE: Record<PrioridadeIssue, number> = { baixa: 0, normal: 1, alta: 2, critica: 3 }

/** Ordena sem mudar a lista original. `numero` e `atualizacao`: mais novo primeiro; `prioridade`: mais urgente primeiro; `prazo`: mais próximo primeiro, sem prazo por último. */
export function ordenarIssues<T extends Pick<Issue, 'numero' | 'prioridade' | 'prazo' | 'atualizadoEm'>>(
  issues: readonly T[],
  ordem: OrdemIssues,
): T[] {
  const porNumero = (a: T, b: T) => b.numero - a.numero
  const copia = [...issues]
  switch (ordem) {
    case 'numero':
      return copia.sort(porNumero)
    case 'prioridade':
      return copia.sort((a, b) => PESO_PRIORIDADE[b.prioridade] - PESO_PRIORIDADE[a.prioridade] || porNumero(a, b))
    case 'prazo':
      return copia.sort((a, b) => {
        if (a.prazo === b.prazo) return porNumero(a, b)
        if (a.prazo === null) return 1
        if (b.prazo === null) return -1
        return a.prazo < b.prazo ? -1 : 1
      })
    case 'atualizacao':
      return copia.sort((a, b) =>
        a.atualizadoEm === b.atualizadoEm ? porNumero(a, b) : a.atualizadoEm < b.atualizadoEm ? 1 : -1,
      )
  }
}

export function contarPorStatus(issues: readonly Pick<Issue, 'status'>[]): Record<StatusIssue, number> {
  const n: Record<StatusIssue, number> = { aberta: 0, em_andamento: 0, resolvida: 0, fechada: 0 }
  for (const i of issues) n[i.status]++
  return n
}
