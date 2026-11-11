// Lógica da Edge Function auth-telegram, com dependências injetadas (testável sem rede).
import { validarInitData } from "../_shared/init_data.ts";
import type { ClienteTelegram } from "../_shared/telegram.ts";
import { type ClienteSessao, emitirSessao } from "../_shared/sessao.ts";
import { cabecalhosCors, json, listarOrigens } from "../_shared/http.ts";

export type { ClienteSessao };
export { listarOrigens };

// Contratos mínimos do cliente Supabase usados aqui.
// deno-lint-ignore no-explicit-any
type Resp<T = any> = Promise<{ data: T; error: { message: string } | null }>;

export interface ClienteAdmin {
  // deno-lint-ignore no-explicit-any
  from(tabela: string): any;
  rpc(
    nome: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ error: { message: string } | null }>;
  auth: {
    admin: {
      // deno-lint-ignore no-explicit-any
      createUser(attrs: any): Resp;
      // deno-lint-ignore no-explicit-any
      generateLink(params: any): Resp;
    };
  };
}

export interface Deps {
  botToken: string;
  origensPermitidas: string[];
  admin: ClienteAdmin;
  criarClienteSessao: () => ClienteSessao;
  /** Cliente da Bot API, para sincronizar o acesso pelos grupos das obras. */
  telegram?: ClienteTelegram;
  agora?: () => Date;
}

export function criarHandler(deps: Deps) {
  return async (req: Request): Promise<Response> => {
    const cors = cabecalhosCors(
      req.headers.get("Origin"),
      deps.origensPermitidas,
    );

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (req.method !== "POST") {
      return json({ erro: "Método não permitido" }, 405, {
        ...cors,
        Allow: "POST, OPTIONS",
      });
    }

    let initData: unknown;
    try {
      const corpo = await req.json();
      initData = corpo?.initData;
    } catch {
      return json({ erro: "Corpo inválido" }, 400, cors);
    }
    if (typeof initData !== "string" || initData === "") {
      return json({ erro: "Corpo inválido" }, 400, cors);
    }

    const agora = deps.agora?.() ?? new Date();
    const v = await validarInitData(initData, deps.botToken, agora);
    if (!v.ok) {
      // Só o motivo, sem dados pessoais.
      console.warn(`auth-telegram: initData rejeitado (${v.motivo})`);
      return json({ erro: "Não autorizado" }, 401, cors);
    }

    try {
      const sessao = await abrirSessao(deps, v.usuario);
      return json(sessao, 200, cors);
    } catch (e) {
      console.error(
        "auth-telegram: falha ao criar sessão:",
        e instanceof Error ? e.message : "erro desconhecido",
      );
      return json({ erro: "Erro interno" }, 500, cors);
    }
  };
}

async function abrirSessao(
  deps: Deps,
  tg: { id: number; first_name: string; last_name?: string; username?: string },
) {
  const { admin } = deps;
  const nome = [tg.first_name, tg.last_name].filter(Boolean).join(" ");
  const email = `tg${tg.id}@telegram.invalid`;

  const buscar = async (): Promise<string | null> => {
    const { data, error } = await admin.from("usuario").select("id")
      .eq("telegram_id", tg.id).maybeSingle();
    if (error) throw new Error(`consulta usuario: ${error.message}`);
    return data?.id ?? null;
  };

  let id = await buscar();
  if (!id) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      app_metadata: { telegram_id: tg.id },
      user_metadata: { nome },
    });
    if (error) {
      // Corrida: outra requisição pode ter criado o mesmo usuário.
      id = await buscar();
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
    atualizado_em: (deps.agora?.() ?? new Date()).toISOString(),
  }, { onConflict: "id" });
  if (eUp) throw new Error(`upsert usuario: ${eUp.message}`);

  await sincronizarAcesso(deps, id, tg.id);

  const sessao = await emitirSessao(admin, deps.criarClienteSessao, email);

  return { ...sessao, usuario: { id, nome, username: tg.username ?? null } };
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

const TIMEOUT_CHAT_MEMBER_MS = 5000;

/**
 * Confere a situação do usuário em cada grupo vinculado e grava pela RPC `sincronizar_acesso`.
 * Nunca lança: falhas só vão para o log (sem dados pessoais) e não impedem o login.
 */
async function sincronizarAcesso(
  deps: Deps,
  usuarioId: string,
  telegramId: number,
): Promise<void> {
  const { telegram, admin } = deps;
  if (!telegram) return;
  try {
    const { data: obras, error } = await admin.from("obra")
      .select("id, telegram_chat_id")
      .not("telegram_chat_id", "is", null);
    if (error) throw new Error(`consulta obra: ${error.message}`);
    if (!obras || obras.length === 0) return;

    const itens = (await Promise.all(
      // deno-lint-ignore no-explicit-any
      obras.map(async (o: any) => {
        const r = await telegram.chamar<
          { status?: string; is_member?: boolean }
        >(
          "getChatMember",
          { chat_id: o.telegram_chat_id, user_id: telegramId },
          { timeoutMs: TIMEOUT_CHAT_MEMBER_MS },
        );
        // Erro de API (ou de rede): pula a obra, sem mudar nada.
        if (r.tipo !== "ok") return null;
        const situacao = situacaoDoMembro(r.resultado);
        return situacao ? { obra_id: o.id as string, situacao } : null;
      }),
    )).filter((i) => i !== null);
    if (itens.length === 0) return;

    const { error: eRpc } = await admin.rpc("sincronizar_acesso", {
      p_usuario: usuarioId,
      p_itens: itens,
    });
    if (eRpc) throw new Error(`sincronizar_acesso: ${eRpc.message}`);
  } catch (e) {
    console.warn(
      "auth-telegram: falha ao sincronizar acesso:",
      e instanceof Error ? e.message : "erro desconhecido",
    );
  }
}
