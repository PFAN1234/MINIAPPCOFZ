import type { Documento, RegistroDocumento, RevisaoDocumento, VinculoDocumento } from '../../domain/documentos.ts'

/** Porta de dados dos Documentos da obra (admin). */
export interface DocumentosRepositorio {
  /** RPC `admin_listar_documentos`: a revisão vigente de cada série. */
  listarDocumentos(slug: string): Promise<Documento[]>
  /** RPC `admin_historico_documento`: todas as revisões da série, da mais nova à mais antiga. */
  historicoDocumento(serie: string): Promise<RevisaoDocumento[]>
  /** RPC `admin_registrar_documento`, depois de enviar o arquivo ao bucket `documentos`. */
  registrarDocumento(slug: string, registro: RegistroDocumento): Promise<Documento>
  /** RPC `admin_retirar_documento`: a revisão sai da lista e fica no histórico. */
  retirarDocumento(id: string): Promise<void>
  /** RPC `admin_vincular_documento`: substitui os vínculos e devolve a lista nova. */
  vincularDocumento(id: string, vinculos: VinculoDocumento[]): Promise<VinculoDocumento[]>
  /** Baixa o arquivo do bucket `documentos` (caminho dentro do bucket). */
  baixarDocumento(caminho: string): Promise<Blob>
}
