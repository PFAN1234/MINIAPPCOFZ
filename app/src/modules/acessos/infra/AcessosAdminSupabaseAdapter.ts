import type { AcessosAdminRepositorio } from '../application/ports/AcessosAdminRepositorio.port.ts'
import type { AcessosRepositorio } from '../application/ports/AcessosRepositorio.port.ts'
import type { Admin, MatrizAcessosAdmin, Pessoa, UsuarioApp } from '../domain/tipos.ts'

type Linha = Record<string, unknown>
type Rpc = <T>(nome: string, args?: Record<string, unknown>) => Promise<T>

/** `rpc` traduz os erros das chamadas admin (ver `admin/dados/supabase.ts`). */
export function criarAcessosAdminSupabase(rpc: Rpc): AcessosAdminRepositorio & Pick<AcessosRepositorio, 'definirAcesso'> {
  const textoOuNulo = (v: unknown) => (v == null ? null : String(v))

  return {
    async listarPessoas() {
      return ((await rpc<Linha[] | null>('admin_listar_pessoas')) ?? []).map(
        (l): Pessoa => ({
          id: String(l.id),
          nome: String(l.nome ?? ''),
          nome_exibicao: textoOuNulo(l.nome_exibicao),
          username: textoOuNulo(l.username),
          telegram_id: Number(l.telegram_id),
          eh_admin: l.eh_admin === true,
          participacoes: Array.isArray(l.participacoes)
            ? (l.participacoes as Linha[]).map((p) => ({
                obra_slug: String(p.obra_slug ?? ''),
                obra_nome: String(p.obra_nome ?? ''),
                etapa_nome: String(p.etapa_nome ?? ''),
                papel: String(p.papel ?? ''),
              }))
            : [],
        }),
      )
    },

    async matrizAcessos(): Promise<MatrizAcessosAdmin> {
      const dados = ((await rpc<Linha | null>('matriz_acessos')) ?? {}) as Linha
      return {
        obras: ((dados.obras ?? []) as Linha[]).map((o) => ({
          id: String(o.id),
          slug: String(o.slug),
          nome: String(o.nome),
        })),
        pessoas: ((dados.pessoas ?? []) as Linha[]).map((l) => ({
          id: String(l.id),
          nome: String(l.nome),
          username: textoOuNulo(l.username),
          admin: l.admin === true,
          vistoEm: textoOuNulo(l.visto_em),
          acessos: Object.fromEntries(
            Object.entries((l.acessos ?? {}) as Record<string, unknown>).map(([k, v]) => [
              k,
              v === 'gestor' ? 'gestor' : 'equipe',
            ]),
          ),
          pedidos: ((l.pedidos ?? []) as unknown[]).map(String),
        })),
      }
    },

    async definirAcesso(obraId, usuarioId, papel) {
      await rpc('definir_acesso', { p_obra: obraId, p_usuario: usuarioId, p_papel: papel })
    },

    async definirNomeExibicao(usuarioId, nome) {
      const r = await rpc<Linha>('admin_definir_nome_exibicao', { p_usuario: usuarioId, p_nome: nome })
      return { id: String(r.id), nome: String(r.nome ?? ''), nome_exibicao: textoOuNulo(r.nome_exibicao) }
    },

    async listarAdmins() {
      return ((await rpc<Linha[]>('admin_listar_admins')) ?? []).map(
        (l): Admin => ({
          usuario_id: String(l.usuario_id),
          nome: String(l.nome),
          username: l.username == null ? null : String(l.username),
          telegram_id: Number(l.telegram_id),
          criado_em: String(l.criado_em),
          criado_por_nome: l.criado_por_nome == null ? null : String(l.criado_por_nome),
        }),
      )
    },

    async incluirAdmin(usuarioId) {
      await rpc('admin_incluir_admin', { p_usuario: usuarioId })
    },

    async removerAdmin(usuarioId) {
      await rpc('admin_remover_admin', { p_usuario: usuarioId })
    },

    async listarUsuarios() {
      return ((await rpc<Linha[]>('admin_listar_usuarios')) ?? []).map(
        (l): UsuarioApp => ({
          id: String(l.id),
          nome: String(l.nome),
          username: l.username == null ? null : String(l.username),
          telegram_id: Number(l.telegram_id),
          eh_admin: l.eh_admin === true,
        }),
      )
    },
  }
}
