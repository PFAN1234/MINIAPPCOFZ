import type { Bucket } from '../../../../admin/dados/tipos.ts'
import { caminhoDocumento, extensaoArquivo, problemaDocumento, type Documento, type NovoDocumento, type RegistroDocumento } from '../../domain/documentos.ts'

export interface DepsDocumento {
  enviarArquivo(bucket: Bucket, caminho: string, arquivo: Blob, tipo: string): Promise<void>
  registrarDocumento(slug: string, registro: RegistroDocumento): Promise<Documento>
  /** SHA-256 do conteúdo, em hexadecimal minúsculo (64 caracteres). */
  sha256(bytes: Uint8Array): Promise<string>
  /** UUID de uma série nova. */
  novaSerie(): string
}

/**
 * Confere, envia o arquivo ao bucket `documentos` e registra a revisão. Sem `serie`, abre um
 * documento novo; com `serie`, é uma nova revisão do mesmo documento.
 */
export async function enviarDocumento(args: {
  deps: DepsDocumento
  obra: { id: string; slug: string }
  serie?: string
  documento: NovoDocumento
}): Promise<Documento> {
  const { deps, obra, documento: d } = args
  const problema = problemaDocumento({
    titulo: d.titulo,
    tipo: d.tipo,
    revisao: d.revisao,
    codigo: d.codigo,
    disciplina: d.disciplina,
    arquivoNome: d.arquivoNome,
    bytes: d.bytes.byteLength,
    mime: d.mime,
  })
  if (problema) throw new Error(problema)

  const serie = args.serie ?? deps.novaSerie()
  const sha256 = await deps.sha256(d.bytes)
  const caminho = caminhoDocumento(obra.id, serie, sha256, extensaoArquivo(d.arquivoNome))
  await deps.enviarArquivo('documentos', caminho, new Blob([d.bytes as BlobPart], { type: d.mime }), d.mime)
  return deps.registrarDocumento(obra.slug, {
    serie,
    codigo: d.codigo?.trim() || null,
    titulo: d.titulo.trim(),
    tipo: d.tipo,
    disciplina: d.disciplina || null,
    revisao: d.revisao,
    caminho,
    arquivoNome: d.arquivoNome.trim(),
    mime: d.mime,
    bytes: d.bytes.byteLength,
    sha256,
  })
}
