import type { Admin, MatrizAcessosAdmin, Pessoa, UsuarioApp } from '../../domain/tipos.ts'

/** Pessoas, admins e lista de acessos do site de administração. `definirAcesso` vem de `AcessosRepositorio`. */
export interface AcessosAdminRepositorio {
  listarPessoas(): Promise<Pessoa[]>
  definirNomeExibicao(
    usuarioId: string,
    nome: string | null,
  ): Promise<{ id: string; nome: string; nome_exibicao: string | null }>
  matrizAcessos(): Promise<MatrizAcessosAdmin>
  listarAdmins(): Promise<Admin[]>
  incluirAdmin(usuarioId: string): Promise<void>
  removerAdmin(usuarioId: string): Promise<void>
  listarUsuarios(): Promise<UsuarioApp[]>
}
