import type { LinkAdmin } from '../../domain/tipos.ts'

/** Sessão do Mini App: login, usuário atual, papel de admin e link para o site de administração. */
export interface SessaoRepositorio {
  /** Só no modo Supabase: troca o `initData` do Telegram por sessão. Sem ele, há sessão. */
  temSessao?(): Promise<boolean>
  idUsuario(): Promise<string | null>
  souAdmin(): Promise<boolean>
  criarLinkAdmin(): Promise<LinkAdmin>
}
