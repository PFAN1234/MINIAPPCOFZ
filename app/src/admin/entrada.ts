/** Link de entrada do site: `/admin/#entrar=<token>` (gerado pela Edge Function admin-sessao). */

/** Token do hash `#entrar=...`, ou null se não houver. */
export function tokenDoHash(hash: string): string | null {
  const m = /^#?entrar=([A-Za-z0-9_-]+)$/.exec(hash)
  return m ? m[1] : null
}

/** Tira o hash da URL sem recarregar a página (o token não fica no histórico). */
export function limparHash(): void {
  const { pathname, search } = window.location
  window.history.replaceState(window.history.state, '', pathname + search)
}

/** Lê o token do link e já o apaga da URL: chamado uma única vez por abertura do site. */
export function consumirTokenDaUrl(): string | null {
  const token = tokenDoHash(window.location.hash)
  if (token !== null) limparHash()
  return token
}

/** Token do link `#entrar=`, entregue uma única vez (uso único, mesmo com o StrictMode). */
export interface Entrada {
  pegarToken(): string | null
}

export function criarEntrada(token: string | null): Entrada {
  let pendente = token
  return {
    pegarToken() {
      const t = pendente
      pendente = null
      return t
    },
  }
}
