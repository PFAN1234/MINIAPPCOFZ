import type { PublicacaoProblema } from '@modules/fiscalizacao/domain/tipos.ts'

export interface PublicacoesRepositorio {
  /** Publicações `incerto`/`falhou` (e pendentes com muitas tentativas), mais recentes primeiro. */
  listarPublicacoesProblema(obraId: string): Promise<PublicacaoProblema[]>
  /** Volta a publicação para a fila de envio. */
  republicar(id: number): Promise<void>
  /** Gestor confirma que a mensagem já está no tópico. */
  marcarPublicada(id: number): Promise<void>
}
