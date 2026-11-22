/** Armazenamento de arquivos (Cloudflare R2, via function `armazenamento`). */
export interface Armazenamento {
  /**
   * Pede a URL, envia o arquivo e confirma. `ja_confirmado` quando o arquivo já
   * estava no servidor (reenvio idempotente).
   */
  enviar(
    pasta: string,
    caminho: string,
    dados: Blob,
    tipo: string,
  ): Promise<'enviado' | 'ja_confirmado'>
  /** URLs de leitura, indexadas pelo caminho. Só voltam os itens permitidos e confirmados. */
  urls(pasta: string, caminhos: string[]): Promise<Map<string, string>>
  baixar(pasta: string, caminho: string): Promise<Blob>
  excluir(pasta: string, caminho: string): Promise<void>
}
