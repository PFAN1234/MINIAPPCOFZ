import type {
  CaminhoFoto,
  FiltroRegistros,
  NovoEncerramento,
  NovoRegistro,
  PendenciaDetalhe,
  RegistroLocalizado,
  RegistroResumo,
} from '@modules/fiscalizacao/domain/tipos.ts'

export interface RegistrosRepositorio {
  listarRegistros(filtro: FiltroRegistros): Promise<RegistroResumo[]>
  /** Pessoas que têm registros nas obras visíveis (`autores_registros`), pelo nome mostrado. */
  autoresRegistros(): Promise<{ id: string; nome: string }[]>
  /** URL assinada (1 h) ou local na fixture, indexada pelo caminho recebido. */
  urlsImagens(paths: string[], bucket?: 'plantas' | 'fotos'): Promise<Record<string, string>>
  /** Envia o JPEG para `<obraId>/<registroId>/<fotoId>.jpg` (reenvio permitido até vincular). */
  enviarFoto(caminho: CaminhoFoto, blob: Blob): Promise<void>
  /** Idempotente pelo `id`. Falhas sobem como `ErroEnvio`. */
  concluirRegistro(dados: NovoRegistro): Promise<{ id: string }>
  /** Pendência com fotos, ambiente, pavimento, papel do usuário e encerramento; null se não houver acesso. */
  obterPendencia(id: string): Promise<PendenciaDetalhe | null>
  /** Idempotente pelo `id`. Falhas sobem como `ErroEnvio` (`conflito` se já encerrada). */
  encerrarPendencia(dados: NovoEncerramento): Promise<{ id: string }>
  /** Localiza um registro visível ao usuário (para o link `startapp`); null se não houver. */
  localizarRegistro(id: string): Promise<RegistroLocalizado | null>
}
