import { ErroAdmin } from '../../../admin/dados/tipos.ts'
import type { AcessosAdminRepositorio } from '../application/ports/AcessosAdminRepositorio.port.ts'
import type { AcessosRepositorio } from '../application/ports/AcessosRepositorio.port.ts'
import type { Admin, MatrizAcessosAdmin, PapelAcesso, Pessoa, UsuarioApp } from '../domain/tipos.ts'

type UsuarioBase = Omit<UsuarioApp, 'eh_admin'>

export interface OpcoesAcessosAdminFixture {
  /** Se o usuário de teste nasce admin. */
  admin: boolean
  voce: UsuarioApp
  usuarios: readonly UsuarioBase[]
  /** Obras da fixture admin (estado de outro contexto), com o nome da etapa. */
  obras: () => { id: string; slug: string; nome: string; etapaNome: string }[]
  /** Exige sessão válida e admin (vem do repositório composto). */
  exigirAdmin: () => void
}

export type AcessosAdminFixture = AcessosAdminRepositorio &
  Pick<AcessosRepositorio, 'definirAcesso'> & {
    ehAdmin(): boolean
    nomeExibicao(id: string): string | null
  }

export function criarAcessosAdminFixture(o: OpcoesAcessosAdminFixture): AcessosAdminFixture {
  const { voce, usuarios, exigirAdmin } = o
  /** `usuario.nome_exibicao`. */
  const nomesExibicao = new Map<string, string | null>([['usuario-patricio', 'CP PATRICIO']])
  const nomeExibicao = (id: string) => nomesExibicao.get(id) ?? null
  /** Papel de cada pessoa em cada obra (para "participações" da tela de pessoas). */
  const participantes: { usuario_id: string; obra_id: string; papel: string }[] = [
    { usuario_id: 'usuario-patricio', obra_id: 'obra-hto', papel: 'gestor' },
    { usuario_id: 'usuario-eduardo', obra_id: 'obra-hto', papel: 'equipe' },
    { usuario_id: 'usuario-maria', obra_id: 'obra-cofz', papel: 'equipe' },
  ]
  /** Pedidos de acesso pendentes: usuário → obras. */
  const pedidosAcesso = new Map<string, Set<string>>([['usuario-maria', new Set(['obra-hto'])]])
  const admins = new Map<string, { criado_em: string; criado_por: string | null }>([
    [voce.id, { criado_em: '2026-11-11T12:00:00Z', criado_por: null }],
    ['usuario-patricio', { criado_em: '2026-11-11T12:00:00Z', criado_por: null }],
  ])
  if (!o.admin) admins.delete(voce.id)
  const nomeDe = (id: string | null) => usuarios.find((u) => u.id === id)?.nome ?? null

  /** Admin do grupo é gestor de todas as obras. */
  const papelEfetivo = (obraId: string, usuarioId: string): PapelAcesso => {
    if (admins.has(usuarioId)) return 'gestor'
    const p = participantes.find((x) => x.usuario_id === usuarioId && x.obra_id === obraId)?.papel
    return p === 'gestor' ? 'gestor' : p === 'equipe' ? 'equipe' : 'nenhum'
  }

  return {
    ehAdmin: () => admins.has(voce.id),
    nomeExibicao,

    async listarPessoas(): Promise<Pessoa[]> {
      exigirAdmin()
      const obras = o.obras()
      return usuarios
        .map((u) => ({
          id: u.id,
          nome: u.nome,
          nome_exibicao: nomeExibicao(u.id),
          username: u.username,
          telegram_id: u.telegram_id,
          eh_admin: admins.has(u.id),
          participacoes: participantes
            .filter((p) => p.usuario_id === u.id)
            .map((p) => {
              const ob = obras.find((x) => x.id === p.obra_id)!
              return { obra_slug: ob.slug, obra_nome: ob.nome, etapa_nome: ob.etapaNome, papel: p.papel }
            }),
        }))
        .sort((a, b) => (a.nome_exibicao ?? a.nome).localeCompare(b.nome_exibicao ?? b.nome))
    },

    async matrizAcessos(): Promise<MatrizAcessosAdmin> {
      exigirAdmin()
      const obras = o.obras()
      const pessoas = usuarios.map((u) => {
        const acessos: Record<string, 'equipe' | 'gestor'> = {}
        for (const ob of obras) {
          const papel = papelEfetivo(ob.id, u.id)
          if (papel !== 'nenhum') acessos[ob.id] = papel
        }
        return {
          id: u.id,
          nome: u.nome,
          username: u.username,
          admin: admins.has(u.id),
          vistoEm: '2026-11-15T14:00:00Z',
          acessos,
          pedidos: [...(pedidosAcesso.get(u.id) ?? [])],
        }
      })
      pessoas.sort(
        (a, b) =>
          Number(b.pedidos.length > 0) - Number(a.pedidos.length > 0) ||
          a.nome.localeCompare(b.nome, 'pt-BR') ||
          a.id.localeCompare(b.id),
      )
      return { obras: obras.map((ob) => ({ id: ob.id, slug: ob.slug, nome: ob.nome })), pessoas }
    },

    async definirAcesso(obraId, usuarioId, papel: PapelAcesso) {
      exigirAdmin()
      if (papel !== 'nenhum' && papel !== 'equipe' && papel !== 'gestor') throw new ErroAdmin('Acesso inválido.')
      if (!o.obras().some((ob) => ob.id === obraId)) throw new ErroAdmin('Obra não encontrada.')
      if (admins.has(usuarioId) && papel !== 'gestor') {
        throw new ErroAdmin('Administradores do grupo são gestores de todas as obras.')
      }
      if (papelEfetivo(obraId, usuarioId) === 'gestor' && papel !== 'gestor') {
        const outros = usuarios.filter((u) => u.id !== usuarioId && papelEfetivo(obraId, u.id) === 'gestor')
        if (outros.length === 0) throw new ErroAdmin('A obra precisa de pelo menos um gestor.')
      }
      const i = participantes.findIndex((p) => p.usuario_id === usuarioId && p.obra_id === obraId)
      if (papel === 'nenhum') {
        if (i >= 0) participantes.splice(i, 1)
      } else if (i >= 0) {
        participantes[i].papel = papel
      } else {
        participantes.push({ usuario_id: usuarioId, obra_id: obraId, papel })
      }
      pedidosAcesso.get(usuarioId)?.delete(obraId)
    },

    async definirNomeExibicao(usuarioId, nome) {
      exigirAdmin()
      const u = usuarios.find((x) => x.id === usuarioId)
      if (!u) throw new ErroAdmin('Usuário não encontrado')
      const limpo = (nome ?? '').trim().replace(/\s+/g, ' ').toUpperCase()
      if (limpo.length > 60) throw new ErroAdmin('O nome de exibição pode ter até 60 caracteres')
      nomesExibicao.set(usuarioId, limpo || null)
      return { id: u.id, nome: u.nome, nome_exibicao: limpo || null }
    },

    async listarAdmins(): Promise<Admin[]> {
      exigirAdmin()
      return usuarios
        .filter((u) => admins.has(u.id))
        .map((u) => {
          const a = admins.get(u.id)!
          return {
            usuario_id: u.id,
            nome: u.nome,
            username: u.username,
            telegram_id: u.telegram_id,
            criado_em: a.criado_em,
            criado_por_nome: nomeDe(a.criado_por),
          }
        })
        .sort((a, b) => a.nome.localeCompare(b.nome))
    },

    async incluirAdmin(usuarioId) {
      exigirAdmin()
      if (!usuarios.some((u) => u.id === usuarioId)) throw new ErroAdmin('Usuário não encontrado')
      if (!admins.has(usuarioId)) admins.set(usuarioId, { criado_em: new Date().toISOString(), criado_por: voce.id })
    },

    async removerAdmin(usuarioId) {
      exigirAdmin()
      if (!admins.has(usuarioId)) throw new ErroAdmin('Este usuário não é admin')
      if (admins.size <= 1) throw new ErroAdmin('Não é possível remover o último admin')
      admins.delete(usuarioId)
    },

    async listarUsuarios() {
      exigirAdmin()
      return usuarios
        .map((u) => ({ ...u, eh_admin: admins.has(u.id) }))
        .sort((a, b) => a.nome.localeCompare(b.nome))
    },
  }
}
