// Acha ou cria o usuário do Telegram no Supabase (Auth + tabela `usuario`).
// Usado pelo auth-telegram (login) e pelo bot-webhook (quem aparece no grupo).

// deno-lint-ignore no-explicit-any
type Resp<T = any> = Promise<{ data: T; error: { message: string } | null }>;

/** Contrato mínimo do cliente Supabase (service role) usado aqui. */
export interface ClienteUsuarios {
  // deno-lint-ignore no-explicit-any
  from(tabela: string): any;
  auth: {
    admin: {
      // deno-lint-ignore no-explicit-any
      createUser(attrs: any): Resp;
      // deno-lint-ignore no-explicit-any
      generateLink(params: any): Resp;
    };
  };
}

export interface UsuarioTelegram {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

export const emailTelegram = (telegramId: number) =>
  `tg${telegramId}@telegram.invalid`;

export const nomeTelegram = (tg: UsuarioTelegram) =>
  [tg.first_name, tg.last_name].filter(Boolean).join(" ");

/** Id do usuário com esse `telegram_id`, ou `null` se ainda não existe. */
export async function buscarUsuario(
  admin: Pick<ClienteUsuarios, "from">,
  telegramId: number,
): Promise<string | null> {
  const { data, error } = await admin.from("usuario").select("id")
    .eq("telegram_id", telegramId).maybeSingle();
  if (error) throw new Error(`consulta usuario: ${error.message}`);
  return data?.id ?? null;
}

/**
 * Devolve o id do usuário, criando-o (Auth e `usuario`) se não existir, e atualiza nome e
 * username. Lança em caso de falha.
 */
export async function garantirUsuario(
  admin: ClienteUsuarios,
  tg: UsuarioTelegram,
  agora?: () => Date,
): Promise<string> {
  const nome = nomeTelegram(tg);
  const email = emailTelegram(tg.id);

  let id = await buscarUsuario(admin, tg.id);
  if (!id) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      app_metadata: { telegram_id: tg.id },
      user_metadata: { nome },
    });
    if (error) {
      // Corrida: outra requisição pode ter criado o mesmo usuário.
      id = await buscarUsuario(admin, tg.id);
      if (!id) {
        // O usuário do Auth existe, mas a linha em `usuario` ainda não: o id vem do link.
        const { data: l, error: e2 } = await admin.auth.admin.generateLink({
          type: "magiclink",
          email,
        });
        if (e2 || !l?.user?.id) {
          throw new Error(`createUser: ${error.message}`);
        }
        id = l.user.id as string;
      }
    } else {
      id = data.user.id as string;
    }
  }

  const { error: eUp } = await admin.from("usuario").upsert({
    id,
    telegram_id: tg.id,
    nome,
    username: tg.username ?? null,
    atualizado_em: (agora?.() ?? new Date()).toISOString(),
  }, { onConflict: "id" });
  if (eUp) throw new Error(`upsert usuario: ${eUp.message}`);

  return id;
}

export type Situacao = "admin" | "membro" | "fora";

/** Converte o `ChatMember` do Telegram na situação do usuário no grupo (ou `null` se desconhecida). */
export function situacaoDoMembro(
  m: { status?: string; is_member?: boolean } | null | undefined,
): Situacao | null {
  switch (m?.status) {
    case "creator":
    case "administrator":
      return "admin";
    case "member":
      return "membro";
    case "restricted":
      return m?.is_member ? "membro" : "fora";
    case "left":
    case "kicked":
      return "fora";
    default:
      return null;
  }
}
