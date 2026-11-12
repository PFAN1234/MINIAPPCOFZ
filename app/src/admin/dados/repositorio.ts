import type {
  Admin,
  Bucket,
  ConfigObra,
  DadosEditorPlanta,
  DadosModelos,
  DadosObra,
  DadosWidget,
  Exclusao,
  EstadoSessao,
  ObraAdmin,
  ObraLista,
  ModeloAdmin,
  AmbienteRA,
  QrAmbiente,
  ObraSalva,
  PavimentoResumo,
  Publicacao,
  RegistroModelo,
  ResultadoExclusao,
  ResultadoPublicacao,
  ResumoObra,
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
  /** Arquiva (true) ou desarquiva (false); devolve `arquivada_em`. */
  arquivarObra(slug: string, arquivada: boolean): Promise<string | null>
  /** Contagens do que a exclusão apaga. */
  resumoObra(slug: string): Promise<ResumoObra>
  /** Edge Function `admin-excluir-obra`: apaga a obra, tudo dela e os arquivos. Irreversível. */
  excluirObra(slug: string, confirmacao: string): Promise<ResultadoExclusao>
  listarExclusoes(): Promise<Exclusao[]>
  /** Tenta de novo remover os arquivos de uma exclusão que ficou pendente. */
  limparExclusao(id: string): Promise<ResultadoExclusao>

  /** Planta (fase 2): ambientes, planta ativa e último PDF guardado de cada pavimento. */
  obterEditorPlanta(slug: string): Promise<DadosEditorPlanta>
  listarPublicacoes(slug: string): Promise<Publicacao[]>
  /** Envia um arquivo ao Storage (upsert). */
  enviarArquivo(bucket: Bucket, caminho: string, arquivo: Blob, tipo: string): Promise<void>
  /** Baixa um PDF guardado no bucket `originais`. */
  baixarOriginal(caminho: string): Promise<Uint8Array>
  /** RPC `admin_publicar_revisao` (payload montado em planta/publicar.ts). */
  publicarRevisao(slug: string, payload: unknown): Promise<ResultadoPublicacao>

  /** Modelo 3D (fase 3): modelos publicados e histórico (`admin_listar_modelos`). */
  listarModelosAdmin(slug: string): Promise<DadosModelos>
  /** RPC `admin_registrar_modelo`, depois de enviar o `.frag` ao bucket `modelos`. */
  registrarModelo(slug: string, registro: RegistroModelo): Promise<ModeloAdmin>
  /** RPC `admin_retirar_modelo`: tira a disciplina do visualizador (o arquivo fica guardado). */
  retirarModelo(slug: string, sigla: string): Promise<void>

  /** Realidade aumentada: ambientes com geometria e seu QR (RPC `admin_listar_ra`). */
  listarRA(obraId: string): Promise<AmbienteRA[]>
  /** RPC `admin_definir_qr` (distâncias em metros). */
  definirQr(ambienteId: string, qr: QrAmbiente): Promise<void>
  /** RPC `admin_remover_qr`. */
  removerQr(ambienteId: string): Promise<void>

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
