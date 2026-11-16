// Lógica da Edge Function auth-telegram, com dependências injetadas (testável sem rede).
import { validarInitData } from "../_shared/init_data.ts";
import type { ClienteTelegram } from "../_shared/telegram.ts";
import { type ClienteSessao, emitirSessao } from "../_shared/sessao.ts";
import { cabecalhosCors, json, listarOrigens } from "../_shared/http.ts";
import {
  type ClienteUsuarios,
  emailTelegram,
  garantirUsuario,
  nomeTelegram,
  type Situacao,
  situacaoDoMembro,
} from "../_shared/usuario.ts";

export type { ClienteSessao };
export { listarOrigens, situacaoDoMembro };
export type { Situacao };

// Contrato mínimo do cliente Supabase usado aqui (inclui o de `garantirUsuario`).
export interface ClienteAdmin extends ClienteUsuarios {
  rpc(
    nome: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ error: { message: string } | null }>;
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
  const nome = nomeTelegram(tg);
  const email = emailTelegram(tg.id);

  const id = await garantirUsuario(admin, tg, deps.agora);

  await sincronizarAcesso(deps, id, tg.id);

  const sessao = await emitirSessao(admin, deps.criarClienteSessao, email);

  return { ...sessao, usuario: { id, nome, username: tg.username ?? null } };
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
