import { ErroAdmin } from '../../../admin/dados/tipos.ts'
import type { SessaoAdminRepositorio } from '../application/ports/SessaoAdminRepositorio.port.ts'
import type { EstadoSessao } from '../domain/tipos.ts'

export type SessaoAdminFixture = SessaoAdminRepositorio & { temSessaoAtiva(): boolean }

/** `ehAdmin` vem do adaptador de acessos (a lista de admins é dele). */
export function criarSessaoAdminFixture(o: {
  sessaoInicial: boolean
  voce: { id: string; nome: string }
  ehAdmin: () => boolean
}): SessaoAdminFixture {
  let sessao = o.sessaoInicial
  return {
    temSessaoAtiva: () => sessao,

    async estadoSessao(): Promise<EstadoSessao> {
      if (!sessao) return { tipo: 'sem_sessao' }
      const usuario = { id: o.voce.id, nome: o.voce.nome }
      return o.ehAdmin() ? { tipo: 'admin', usuario } : { tipo: 'negado', usuario }
    },

    async entrarComToken(token) {
      if (token !== 'fixture') {
        throw new ErroAdmin('Link inválido, expirado ou já usado. Peça outro pelo botão Administração no Mini App.')
      }
      sessao = true
    },

    async entrarComWidget() {
      if (!o.ehAdmin()) throw new ErroAdmin('Esta conta do Telegram não é admin do Mini App.')
      sessao = true
    },

    async entrarModoTeste() {
      sessao = true
    },

    async sair() {
      sessao = false
    },

    async meuId() {
      return sessao ? o.voce.id : null
    },
  }
}
