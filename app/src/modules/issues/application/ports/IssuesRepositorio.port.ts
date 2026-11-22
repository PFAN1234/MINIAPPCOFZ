import type { Vista } from '../../../modelos/domain/central.ts'
import type { DadosIssue, Issue, ResultadoImportacaoBcf, TopicoBcf } from '../../domain/issues.ts'

/** Porta de dados das Issues da obra (admin). */
export interface IssuesRepositorio {
  /** RPC `admin_listar_issues`: da mais nova (maior número) à mais antiga, com vistas e comentários. */
  listarIssues(obraId: string): Promise<Issue[]>
  /**
   * RPC `admin_salvar_issue`: sem `id` cria (exige título); com `id` atualiza só as chaves presentes
   * de `dados` (`null` limpa descrição, responsável e prazo).
   */
  salvarIssue(obraId: string, dados: DadosIssue, id?: string): Promise<{ id: string; numero: number }>
  /** RPC `admin_comentar_issue`; devolve o id do comentário. */
  comentarIssue(issueId: string, texto: string, vistaId?: string | null): Promise<string>
  /**
   * RPC `admin_salvar_vista_issue`. O cliente gera `vistaId`; a imagem (se houver) já deve estar
   * enviada e confirmada no bucket `issues` em `imagemPath`.
   */
  salvarVistaIssue(issueId: string, vistaId: string, vista: Vista, imagemPath?: string | null): Promise<string>
  /** URL de leitura da imagem de uma vista (caminho no bucket `issues`); `null` se não disponível. */
  urlImagemVista(caminho: string): Promise<string | null>
  /** RPC `admin_importar_bcf`: o mapeamento do BCF é feito antes (etapa 7D). */
  importarBcf(obraId: string, topicos: TopicoBcf[]): Promise<ResultadoImportacaoBcf>
}
