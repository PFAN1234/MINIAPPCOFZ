import type {
  Admin,
  ConfigObra,
  DadosObra,
  DadosWidget,
  EstadoSessao,
  ObraAdmin,
  ObraLista,
  ObraSalva,
  PavimentoResumo,
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
