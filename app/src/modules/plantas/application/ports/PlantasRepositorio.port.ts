import type { Bucket } from '../../../../admin/dados/tipos.ts'
import type { DadosEditorPlanta, Publicacao, ResultadoPublicacao } from '../../domain/tipos.ts'

/** Porta de dados da planta no admin: ambientes, planta ativa, PDFs guardados e publicação de revisões. */
export interface PlantasRepositorio {
  /** Planta (fase 2): ambientes, planta ativa e último PDF guardado de cada pavimento. */
  obterEditorPlanta(slug: string): Promise<DadosEditorPlanta>
  listarPublicacoes(slug: string): Promise<Publicacao[]>
  /** Envia um arquivo ao Storage (upsert). */
  enviarArquivo(bucket: Bucket, caminho: string, arquivo: Blob, tipo: string): Promise<void>
  /** Baixa um PDF guardado no bucket `originais`. */
  baixarOriginal(caminho: string): Promise<Uint8Array>
  /** RPC `admin_publicar_revisao` (payload montado em `domain/publicacao.ts`). */
  publicarRevisao(slug: string, payload: unknown): Promise<ResultadoPublicacao>
}
