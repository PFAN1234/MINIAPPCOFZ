import { ErroAdmin } from '../../../admin/dados/tipos.ts'
import type { IssuesRepositorio } from '../application/ports/IssuesRepositorio.port.ts'
import {
  problemaComentario,
  problemaIssue,
  problemaTitulo,
  type DadosIssue,
  type Issue,
  type TopicoBcf,
} from '../domain/issues.ts'

function copia<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

/** O que o adaptador pede à fixture do admin (sessão, Storage, nomes); o padrão basta para testes isolados. */
export interface DepsIssuesFixture {
  exigirAdmin?: () => void
  /** Tamanho do arquivo enviado ao bucket `issues` (caminho dentro do bucket); `undefined` se não houver. */
  tamanhoArquivo?: (caminho: string) => number | undefined
  /** Nome do administrador (responsável); sem ele, `null`. */
  nomeUsuario?: (id: string) => string | null
  /** Quem aparece como autor das issues e comentários. */
  autor?: { id: string; nome: string }
  /** Issues que já existem (por obra). */
  semente?: { obraId: string; issues: Issue[] }[]
  /** Relógio (ISO), para testes. */
  agora?: () => string
}

export interface IssuesFixture extends IssuesRepositorio {
  /** Issues abertas (aberta + em andamento) da obra. */
  abertas(obraId: string): number
  removerObra(obraId: string): void
}

/** Adaptador de fixture das issues: o estado é próprio de cada instância. */
export function criarIssuesFixture(deps: DepsIssuesFixture = {}): IssuesFixture {
  const {
    exigirAdmin = () => {},
    tamanhoArquivo,
    nomeUsuario = () => null,
    autor = { id: 'usuario-teste', nome: 'Você' },
    agora = () => new Date().toISOString(),
  } = deps
  const porObra = new Map<string, Issue[]>()
  for (const s of deps.semente ?? []) porObra.set(s.obraId, copia(s.issues))
  let sequencia = 0
  for (const l of porObra.values()) for (const i of l) sequencia = Math.max(sequencia, i.numero)
  let idSeq = 0

  const lista = (obraId: string) => {
    let l = porObra.get(obraId)
    if (!l) porObra.set(obraId, (l = []))
    return l
  }
  const achar = (id: string): { obraId: string; issue: Issue } => {
    for (const [obraId, l] of porObra) {
      const issue = l.find((i) => i.id === id)
      if (issue) return { obraId, issue }
    }
    throw new ErroAdmin('Issue não encontrada.')
  }
  const erro = (msg: string | null) => {
    if (msg) throw new ErroAdmin(msg)
  }

  function aplicar(i: Issue, d: DadosIssue) {
    if (d.titulo !== undefined) i.titulo = d.titulo.trim()
    if (d.descricao !== undefined) i.descricao = d.descricao?.trim() || null
    if (d.tipo !== undefined) i.tipo = d.tipo
    if (d.prioridade !== undefined) i.prioridade = d.prioridade
    if (d.status !== undefined) i.status = d.status
    if (d.responsavelId !== undefined) {
      i.responsavelId = d.responsavelId
      i.responsavelNome = d.responsavelId ? nomeUsuario(d.responsavelId) : null
    }
    if (d.prazo !== undefined) i.prazo = d.prazo || null
  }

  function nova(obraId: string, guid: string, titulo: string): Issue {
    const t = agora()
    const i: Issue = {
      id: `issue-${++idSeq}-${Math.random().toString(36).slice(2, 8)}`,
      numero: ++sequencia,
      guid,
      titulo,
      descricao: null,
      tipo: 'problema',
      prioridade: 'normal',
      status: 'aberta',
      responsavelId: null,
      responsavelNome: null,
      prazo: null,
      criadoPor: autor.id,
      criadoPorNome: autor.nome,
      criadoEm: t,
      atualizadoEm: t,
      vistas: [],
      comentarios: [],
    }
    lista(obraId).push(i)
    return i
  }

  return {
    async listarIssues(obraId) {
      exigirAdmin()
      return copia([...lista(obraId)].sort((a, b) => b.numero - a.numero))
    },

    async salvarIssue(obraId, dados, id) {
      exigirAdmin()
      if (id === undefined) {
        erro(problemaTitulo(dados.titulo ?? ''))
        erro(problemaIssue(dados))
        const i = nova(obraId, crypto.randomUUID(), dados.titulo!.trim())
        aplicar(i, dados)
        return { id: i.id, numero: i.numero }
      }
      erro(problemaIssue(dados))
      const { issue } = achar(id)
      aplicar(issue, dados)
      issue.atualizadoEm = agora()
      return { id: issue.id, numero: issue.numero }
    },

    async comentarIssue(issueId, texto, vistaId = null) {
      exigirAdmin()
      erro(problemaComentario(texto))
      const { issue } = achar(issueId)
      if (vistaId && !issue.vistas.some((v) => v.id === vistaId)) throw new ErroAdmin('Vista não encontrada nesta issue.')
      const id = `comentario-${++idSeq}-${Math.random().toString(36).slice(2, 8)}`
      issue.comentarios.push({
        id,
        guid: crypto.randomUUID(),
        autorId: autor.id,
        autorNome: autor.nome,
        texto: texto.trim(),
        vistaId,
        criadoEm: agora(),
      })
      issue.atualizadoEm = agora()
      return id
    },

    async salvarVistaIssue(issueId, vistaId, vista, imagemPath = null) {
      exigirAdmin()
      const { obraId, issue } = achar(issueId)
      if (imagemPath) {
        if (imagemPath !== `${obraId}/${issueId}/${vistaId}.png`) throw new ErroAdmin('Caminho da imagem inválido.')
        if (!tamanhoArquivo || tamanhoArquivo(imagemPath) === undefined) throw new ErroAdmin('A imagem da vista não foi enviada.')
      }
      const existente = issue.vistas.find((v) => v.id === vistaId)
      if (existente) {
        existente.vista = copia(vista)
        existente.imagemPath = imagemPath
      } else {
        issue.vistas.push({ id: vistaId, guid: crypto.randomUUID(), vista: copia(vista), imagemPath, criadoEm: agora() })
      }
      issue.atualizadoEm = agora()
      return vistaId
    },

    async urlImagemVista(caminho) {
      exigirAdmin()
      return tamanhoArquivo?.(caminho) === undefined ? null : `fixture://issues/${caminho}`
    },

    async importarBcf(obraId, topicos: TopicoBcf[]) {
      exigirAdmin()
      let criadas = 0
      let atualizadas = 0
      for (const t of topicos) {
        erro(problemaTitulo(t.titulo))
        erro(problemaIssue({ ...t, titulo: t.titulo }))
        let i = lista(obraId).find((x) => x.guid === t.guid)
        if (i) atualizadas++
        else {
          i = nova(obraId, t.guid, t.titulo.trim())
          criadas++
        }
        aplicar(i, t)
        for (const v of t.vistas ?? []) {
          if (i.vistas.some((x) => x.guid === v.guid)) continue
          i.vistas.push({ id: `vista-${++idSeq}`, guid: v.guid, vista: copia(v.vista), imagemPath: v.imagemPath ?? null, criadoEm: v.criadoEm ?? agora() })
        }
        for (const c of t.comentarios ?? []) {
          if (i.comentarios.some((x) => x.guid === c.guid)) continue
          i.comentarios.push({
            id: `comentario-${++idSeq}`,
            guid: c.guid,
            autorId: null,
            autorNome: null,
            texto: c.texto.trim(),
            vistaId: i.vistas.find((v) => v.guid === c.vistaGuid)?.id ?? null,
            criadoEm: c.criadoEm ?? agora(),
          })
        }
        i.atualizadoEm = agora()
      }
      return { criadas, atualizadas }
    },

    abertas: (obraId) => lista(obraId).filter((i) => i.status === 'aberta' || i.status === 'em_andamento').length,
    removerObra: (obraId) => void porObra.delete(obraId),
  }
}
