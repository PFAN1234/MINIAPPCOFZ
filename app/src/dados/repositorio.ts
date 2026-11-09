import type {
  AmbienteDetalhe,
  CaminhoFoto,
  NovoRegistro,
  FiltroRegistros,
  ObraDetalhe,
  ObraResumo,
  RegistroResumo,
} from './tipos.ts'

export interface Repositorio {
  listarObras(): Promise<ObraResumo[]>
  /** Pavimentos (com planta ativa), ambientes e pendências abertas por ambiente. */
  obterObra(slug: string): Promise<ObraDetalhe>
  obterAmbiente(slug: string, codigo: string): Promise<AmbienteDetalhe>
  listarRegistros(filtro: FiltroRegistros): Promise<RegistroResumo[]>
  /** URL assinada (1 h) ou local na fixture, indexada pelo caminho recebido. */
  urlsImagens(
    paths: string[],
    bucket?: 'plantas' | 'fotos',
  ): Promise<Record<string, string>>
  /** Envia o JPEG para `<obraId>/<registroId>/<fotoId>.jpg` (reenvio permitido até vincular). */
  enviarFoto(caminho: CaminhoFoto, blob: Blob): Promise<void>
  /** Idempotente pelo `id`. Falhas sobem como `ErroEnvio`. */
  concluirRegistro(dados: NovoRegistro): Promise<{ id: string }>
  /**
   * Só na implementação Supabase: há sessão ativa? Ausente na fixture, que
   * dispensa login. Sem sessão o app pede para abrir pelo Telegram.
   */
  temSessao?(): Promise<boolean>
}

/**
 * Ponto único de criação. A fixture entra por `import()` dinâmico atrás de uma
 * condição constante em tempo de build: sem `VITE_DADOS=fixture` o bundler
 * descarta o ramo e os dados de teste não vão para o `dist/`.
 */
export async function criarRepositorio(): Promise<Repositorio> {
  if (import.meta.env.VITE_DADOS === 'fixture') {
    const { criarRepositorioFixture } = await import('./fixture.ts')
    return criarRepositorioFixture()
  }
  const { criarRepositorioSupabase } = await import('./supabase.ts')
  return criarRepositorioSupabase()
}
