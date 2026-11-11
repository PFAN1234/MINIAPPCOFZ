import type {
  Admin,
  Bucket,
  ConfigObra,
  DadosEditorPlanta,
  DadosObra,
  DadosWidget,
  EstadoSessao,
  ObraAdmin,
  ObraLista,
  ObraSalva,
  PavimentoResumo,
  Publicacao,
  ResultadoPublicacao,
  UsuarioApp,
} from './tipos.ts'

export interface RepositorioAdmin {
  /** Há sessão? É de um admin? */
  estadoSessao(): Promise<EstadoSessao>
  /** Troca o token do link `#entrar=` (uso único) por sessão. */
  entrarComToken(token: string): Promise<void>
  /** Troca os dados do Telegram Login Widget por sessão (só admins). */
  entrarComWidget(dados: DadosWidget): Promise<void>
  sair(): Promise<void>
  /** Só na fixture: entra sem Telegram (desenvolvimento e e2e). */
  entrarModoTeste?(): Promise<void>

  listarObras(): Promise<ObraLista[]>
  obterObra(slug: string): Promise<ObraAdmin>
  salvarObra(dados: DadosObra): Promise<ObraSalva>
  /** Lista completa: inclui, edita e apaga (só pavimento sem ambientes nem plantas). */
  salvarPavimentos(slug: string, lista: PavimentoResumo[]): Promise<PavimentoResumo[]>
  salvarConfig(slug: string, config: ConfigObra): Promise<void>
  exportarObra(slug: string): Promise<unknown>

  /** Planta (fase 2): ambientes, planta ativa e último PDF guardado de cada pavimento. */
  obterEditorPlanta(slug: string): Promise<DadosEditorPlanta>
  listarPublicacoes(slug: string): Promise<Publicacao[]>
  /** Envia um arquivo ao Storage (upsert). */
  enviarArquivo(bucket: Bucket, caminho: string, arquivo: Blob, tipo: string): Promise<void>
  /** Baixa um PDF guardado no bucket `originais`. */
  baixarOriginal(caminho: string): Promise<Uint8Array>
  /** RPC `admin_publicar_revisao` (payload montado em planta/publicar.ts). */
  publicarRevisao(slug: string, payload: unknown): Promise<ResultadoPublicacao>

  listarAdmins(): Promise<Admin[]>
  incluirAdmin(usuarioId: string): Promise<void>
  removerAdmin(usuarioId: string): Promise<void>
  listarUsuarios(): Promise<UsuarioApp[]>
}

/** Como no app: a fixture só entra no build com `VITE_DADOS=fixture`. */
export async function criarRepositorioAdmin(): Promise<RepositorioAdmin> {
  if (import.meta.env.VITE_DADOS === 'fixture') {
    const { criarRepositorioAdminFixture } = await import('./fixture.ts')
    // `localStorage['fixture-admin'] = 'nao'` simula um usuário que não é admin.
    let admin = true
    try {
      admin = localStorage.getItem('fixture-admin') !== 'nao'
    } catch {
      // sem localStorage: admin
    }
    return criarRepositorioAdminFixture({ admin })
  }
  const { criarRepositorioAdminSupabase } = await import('./supabase.ts')
  return criarRepositorioAdminSupabase()
}
