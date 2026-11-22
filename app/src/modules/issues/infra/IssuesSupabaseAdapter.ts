import type { Armazenamento } from '@modules/armazenamento/application/ports/Armazenamento.port.ts'
import type { Vista } from '../../modelos/domain/central.ts'
import type { IssuesRepositorio } from '../application/ports/IssuesRepositorio.port.ts'
import type {
  DadosIssue,
  Issue,
  IssueComentario,
  IssueVista,
  PrioridadeIssue,
  StatusIssue,
  TipoIssue,
  TopicoBcf,
} from '../domain/issues.ts'

type Linha = Record<string, unknown>
type Rpc = <T>(nome: string, args?: Record<string, unknown>) => Promise<T>

const texto = (v: unknown) => (v == null ? null : String(v))

function vista(l: Linha): IssueVista {
  return {
    id: String(l.id),
    guid: String(l.guid),
    vista: l.vista as Vista,
    imagemPath: texto(l.imagem_path),
    criadoEm: String(l.criado_em),
  }
}

function comentario(l: Linha): IssueComentario {
  return {
    id: String(l.id),
    guid: String(l.guid),
    autorId: texto(l.autor_id),
    autorNome: texto(l.autor_nome),
    texto: String(l.texto),
    vistaId: texto(l.vista_id),
    criadoEm: String(l.criado_em),
  }
}

function issue(l: Linha): Issue {
  return {
    id: String(l.id),
    numero: Number(l.numero),
    guid: String(l.guid),
    titulo: String(l.titulo),
    descricao: texto(l.descricao),
    tipo: String(l.tipo) as TipoIssue,
    prioridade: String(l.prioridade) as PrioridadeIssue,
    status: String(l.status) as StatusIssue,
    responsavelId: texto(l.responsavel_id),
    responsavelNome: texto(l.responsavel_nome),
    prazo: texto(l.prazo),
    criadoPor: texto(l.criado_por),
    criadoPorNome: texto(l.criado_por_nome),
    criadoEm: String(l.criado_em),
    atualizadoEm: String(l.atualizado_em),
    vistas: ((l.vistas as Linha[] | null) ?? []).map(vista),
    comentarios: ((l.comentarios as Linha[] | null) ?? []).map(comentario),
  }
}

/** Só as chaves presentes: na atualização, ausente = não mexer; `null` = limpar. */
function jsonDados(d: DadosIssue): Linha {
  const p: Linha = {}
  if (d.titulo !== undefined) p.titulo = d.titulo.trim()
  if (d.descricao !== undefined) p.descricao = d.descricao?.trim() || null
  if (d.tipo !== undefined) p.tipo = d.tipo
  if (d.prioridade !== undefined) p.prioridade = d.prioridade
  if (d.status !== undefined) p.status = d.status
  if (d.responsavelId !== undefined) p.responsavel_id = d.responsavelId
  if (d.prazo !== undefined) p.prazo = d.prazo || null
  return p
}

function jsonTopico(t: TopicoBcf): Linha {
  const p: Linha = { guid: t.guid, titulo: t.titulo }
  if (t.descricao != null) p.descricao = t.descricao
  if (t.tipo) p.tipo = t.tipo
  if (t.prioridade) p.prioridade = t.prioridade
  if (t.status) p.status = t.status
  if (t.prazo) p.prazo = t.prazo
  if (t.criadoEm) p.criado_em = t.criadoEm
  p.vistas = (t.vistas ?? []).map((v) => ({
    guid: v.guid,
    vista: v.vista,
    ...(v.criadoEm ? { criado_em: v.criadoEm } : {}),
    ...(v.imagemPath ? { imagem_path: v.imagemPath } : {}),
  }))
  p.comentarios = (t.comentarios ?? []).map((c) => ({
    guid: c.guid,
    texto: c.texto,
    ...(c.criadoEm ? { criado_em: c.criadoEm } : {}),
    ...(c.vistaGuid ? { vista_guid: c.vistaGuid } : {}),
  }))
  return p
}

/** Adaptador Supabase das issues. `rpc` é a chamada admin (traduz os erros). */
export function criarIssuesSupabase(armazenamento: Armazenamento, rpc: Rpc): IssuesRepositorio {
  return {
    async listarIssues(obraId) {
      const linhas = await rpc<Linha[] | null>('admin_listar_issues', { p_obra: obraId })
      return (linhas ?? []).map(issue)
    },

    async salvarIssue(obraId, dados, id) {
      const p = id === undefined ? { obra_id: obraId, ...jsonDados(dados) } : { id, ...jsonDados(dados) }
      const r = await rpc<{ id: string; numero: number }>('admin_salvar_issue', { p })
      return { id: String(r.id), numero: Number(r.numero) }
    },

    async comentarIssue(issueId, textoComentario, vistaId = null) {
      const id = await rpc<string>('admin_comentar_issue', {
        p_issue: issueId,
        p_texto: textoComentario.trim(),
        p_vista: vistaId,
      })
      return String(id)
    },

    async salvarVistaIssue(issueId, vistaId, v, imagemPath = null) {
      const id = await rpc<string>('admin_salvar_vista_issue', {
        p_issue: issueId,
        p_id: vistaId,
        p_vista: v,
        p_imagem_path: imagemPath,
      })
      return String(id)
    },

    async urlImagemVista(caminho) {
      try {
        return (await armazenamento.urls('issues', [caminho])).get(caminho) ?? null
      } catch {
        return null
      }
    },

    async importarBcf(obraId, topicos) {
      const r = await rpc<{ criadas: number; atualizadas: number }>('admin_importar_bcf', {
        p_obra: obraId,
        p_topicos: topicos.map(jsonTopico),
      })
      return { criadas: Number(r.criadas), atualizadas: Number(r.atualizadas) }
    },
  }
}
