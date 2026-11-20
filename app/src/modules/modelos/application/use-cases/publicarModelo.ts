import type { Bucket } from '../../../../admin/dados/tipos.ts'
import { caminhoModelo, problemaFrag, problemaRevisaoModelo, problemaSigla, type TipoArquivo } from '../../domain/modelos.ts'
import type { ModeloAdmin, RegistroModelo } from '../../domain/tipos.ts'

export interface DepsModelo {
  enviarArquivo(bucket: Bucket, caminho: string, arquivo: Blob, tipo: string): Promise<void>
  registrarModelo(slug: string, registro: RegistroModelo): Promise<ModeloAdmin>
  /** Hash do conteúdo como no script (16 primeiros hex do SHA-256): chave do cache no aparelho. */
  hash(bytes: Uint8Array): Promise<string>
}

/** Confere, envia o `.frag` ao bucket `modelos` e registra o modelo (a RPC confere o arquivo no Storage). */
export async function publicarModelo(args: {
  deps: DepsModelo
  obra: { id: string; slug: string }
  sigla: string
  revisao: string | null
  frag: Uint8Array
  origem: TipoArquivo
  arquivoNome: string
  ifcBytes?: number | null
}): Promise<ModeloAdmin> {
  const { deps, obra, sigla, revisao, frag, origem, arquivoNome, ifcBytes } = args
  const problema = problemaSigla(sigla) ?? problemaRevisaoModelo(revisao ?? '') ?? problemaFrag(frag)
  if (problema) throw new Error(problema)
  const hash = await deps.hash(frag)
  const caminho = caminhoModelo(obra.id, sigla, hash)
  await deps.enviarArquivo(
    'modelos',
    caminho,
    new Blob([frag as BlobPart], { type: 'application/octet-stream' }),
    'application/octet-stream',
  )
  return deps.registrarModelo(obra.slug, {
    sigla,
    revisao: revisao || null,
    caminho,
    bytes: frag.byteLength,
    hash,
    origem,
    arquivo_nome: arquivoNome,
    ifc_bytes: ifcBytes ?? null,
  })
}
