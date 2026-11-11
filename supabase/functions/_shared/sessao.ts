// Emissão de sessão Supabase para um usuário que já existe no Auth (usada pelo auth-telegram
// e pelo admin-sessao). O projeto usa chaves JWT assimétricas, então a função não assina JWT
// próprio: gera um link mágico com a API admin e troca o `token_hash` por sessão.

// deno-lint-ignore no-explicit-any
type Resp<T = any> = Promise<{ data: T; error: { message: string } | null }>;

/** Parte do cliente admin (chave secreta) usada aqui. */
export interface ClienteGerarLink {
  auth: {
    admin: {
      // deno-lint-ignore no-explicit-any
      generateLink(params: any): Resp;
    };
  };
}

/** Cliente separado, sem sessão persistida, que recebe a sessão do usuário. */
export interface ClienteSessao {
  auth: {
    // deno-lint-ignore no-explicit-any
    verifyOtp(params: any): Resp;
  };
}

export interface Sessao {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

/** Abre uma sessão para o usuário do Auth com este e-mail. Lança em caso de falha. */
export async function emitirSessao(
  admin: ClienteGerarLink,
  criarClienteSessao: () => ClienteSessao,
  email: string,
): Promise<Sessao> {
  const { data: link, error: eLink } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  const tokenHash = link?.properties?.hashed_token;
  if (eLink || !tokenHash) {
    throw new Error(`generateLink: ${eLink?.message ?? "sem hashed_token"}`);
  }

  // 'email' é o type documentado para verifyOtp com token_hash ('magiclink' está obsoleto).
  const { data: s, error: eOtp } = await criarClienteSessao().auth
    .verifyOtp({ token_hash: tokenHash, type: "email" });
  if (eOtp || !s?.session) {
    throw new Error(`verifyOtp: ${eOtp?.message ?? "sem sessão"}`);
  }

  return {
    access_token: s.session.access_token as string,
    refresh_token: s.session.refresh_token as string,
    expires_at: s.session.expires_at as number,
  };
}
