import type { DadosWidget, EstadoSessao } from '../../domain/tipos.ts'

/** Sessão do site de administração. */
export interface SessaoAdminRepositorio {
  estadoSessao(): Promise<EstadoSessao>
  entrarComToken(token: string): Promise<void>
  entrarComWidget(dados: DadosWidget): Promise<void>
  sair(): Promise<void>
  /** Só na fixture. */
  entrarModoTeste?(): Promise<void>
  meuId(): Promise<string | null>
}
