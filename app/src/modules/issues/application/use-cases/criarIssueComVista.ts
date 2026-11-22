import type { Bucket } from '../../../../admin/dados/tipos.ts'
import type { Vista } from '../../../modelos/domain/central.ts'
import { caminhoImagemVista, problemaImagemVista, problemaIssue, problemaTitulo, type DadosIssue } from '../../domain/issues.ts'

export interface DepsIssueComVista {
  enviarArquivo(bucket: Bucket, caminho: string, arquivo: Blob, tipo: string): Promise<void>
  salvarIssue(obraId: string, dados: DadosIssue, id?: string): Promise<{ id: string; numero: number }>
  salvarVistaIssue(issueId: string, vistaId: string, vista: Vista, imagemPath?: string | null): Promise<string>
  /** UUID da vista nova (padrão: `crypto.randomUUID`). */
  novoId?: () => string
}

/** A imagem não subiu: a issue (se foi criada) existe, mas sem a vista; dá para tentar de novo com `adicionarVista`. */
export class ErroImagemVista extends Error {
  readonly issue: { id: string; numero: number } | null

  constructor(issue: { id: string; numero: number } | null, causa: unknown) {
    super(
      issue
        ? `A issue #${issue.numero} foi criada, mas a imagem da vista não pôde ser enviada. Adicione a vista de novo.`
        : 'A imagem da vista não pôde ser enviada.',
      { cause: causa },
    )
    this.name = 'ErroImagemVista'
    this.issue = issue
  }
}

/** Envia a imagem e salva a vista de uma issue existente. */
export async function adicionarVista(args: {
  deps: DepsIssueComVista
  obraId: string
  issue: { id: string; numero?: number }
  vista: Vista
  imagem?: Blob | null
}): Promise<{ vistaId: string }> {
  const { deps, obraId, issue, vista, imagem } = args
  if (imagem) {
    const p = problemaImagemVista(imagem)
    if (p) throw new Error(p)
  }
  const vistaId = (deps.novoId ?? (() => crypto.randomUUID()))()
  let caminho: string | null = null
  if (imagem) {
    caminho = caminhoImagemVista(obraId, issue.id, vistaId)
    try {
      await deps.enviarArquivo('issues', caminho, imagem, 'image/png')
    } catch (e) {
      throw new ErroImagemVista(issue.numero === undefined ? null : { id: issue.id, numero: issue.numero }, e)
    }
  }
  await deps.salvarVistaIssue(issue.id, vistaId, vista, caminho)
  return { vistaId }
}

/**
 * Salva a issue, depois a vista (com a imagem PNG, se houver). Se a imagem falhar, a issue fica
 * criada sem vista e o erro `ErroImagemVista` sobe com o número dela.
 */
export async function criarIssueComVista(args: {
  deps: DepsIssueComVista
  obraId: string
  dados: DadosIssue & { titulo: string }
  vista?: Vista | null
  imagem?: Blob | null
}): Promise<{ id: string; numero: number; vistaId: string | null }> {
  const { deps, obraId, dados, vista, imagem } = args
  const problema = problemaTitulo(dados.titulo) ?? problemaIssue(dados) ?? (imagem ? problemaImagemVista(imagem) : null)
  if (problema) throw new Error(problema)

  const issue = await deps.salvarIssue(obraId, dados)
  if (!vista) return { ...issue, vistaId: null }
  const { vistaId } = await adicionarVista({ deps, obraId, issue, vista, imagem })
  return { ...issue, vistaId }
}
