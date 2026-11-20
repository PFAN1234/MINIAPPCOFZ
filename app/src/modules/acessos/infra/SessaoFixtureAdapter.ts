import { ErroEnvio } from '../../../dados/erros.ts'
import type { SessaoRepositorio } from '../application/ports/SessaoRepositorio.port.ts'
import type { LinkAdmin } from '../domain/tipos.ts'

export function criarSessaoFixture(o: {
  admin: boolean
  idUsuario: string
  exigirRede: () => void
}): SessaoRepositorio {
  return {
    async idUsuario() {
      return o.idUsuario
    },

    async souAdmin() {
      return o.admin === true
    },

    async criarLinkAdmin(): Promise<LinkAdmin> {
      o.exigirRede()
      if (o.admin !== true) {
        throw new ErroEnvio('permissao', 'Apenas admins do Mini App podem abrir a administração.')
      }
      const base = typeof location === 'undefined' ? 'http://localhost' : location.origin
      return {
        url: `${base}/admin/#entrar=fixture`,
        expira_em: new Date(Date.now() + 120_000).toISOString(),
      }
    },
  }
}
