// Lógica da Edge Function bot-webhook, com dependências injetadas (testável sem rede).
import type { ClienteRpc, Segredos } from "../_shared/segredo.ts";
import {
  type ClienteTelegram,
  linkApp,
  type ResultadoTelegram,
} from "../_shared/telegram.ts";

export interface Deps {
  telegram: ClienteTelegram;
  admin: ClienteRpc;
  segredos: Segredos;
  botUsername: string;
  appName: string;
  /** URL pública desta função, registrada no `setWebhook`. */
  urlFuncao: string;
}

interface Mensagem {
  message_id: number;
  text?: string;
  message_thread_id?: number;
  is_topic_message?: boolean;
  from?: { id: number; is_bot?: boolean };
  sender_chat?: { id: number };
  chat: { id: number; type: string; is_forum?: boolean };
}

const BOTAO = "Abrir Diário da obra";

const TEXTOS = {
  inicio:
    "Olá! O Diário da obra registra serviços e pendências com fotos, direto do canteiro, e publica cada registro no tópico da obra.\n\nToque no botão abaixo para abrir o app.",
  vinculado: (nome: string) =>
    `Tópico vinculado à obra ${nome}. Os registros do Diário da obra serão publicados aqui.`,
  foraDoTopico: "Use este comando dentro do tópico da obra.",
  soAdminVincular: "Só administradores do grupo podem vincular a obra.",
  soAdminFixar: "Só administradores do grupo podem fixar o botão.",
  naoEncontrada: (slug: string) => `Obra “${slug}” não encontrada.`,
  uso: "Uso: /vincular_obra <slug> (ex.: /vincular_obra hto)",
  botaoFixado:
    "📋 <b>Diário da obra</b>\nToque no botão para registrar serviços e pendências da obra.",
  semPermissaoFixar: "Preciso da permissão de fixar mensagens.",
};

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/** Separa `/cmd@bot args`. Devolve `null` se não for comando para este bot. */
export function lerComando(
  texto: string,
  botUsername: string,
): { comando: string; argumento: string } | null {
  if (!texto.startsWith("/")) return null;
  const [primeiro, ...resto] = texto.split(/\s+/);
  const [comando, alvo] = primeiro.slice(1).split("@");
  if (comando === "") return null;
  if (alvo !== undefined && alvo.toLowerCase() !== botUsername.toLowerCase()) {
    return null;
  }
  return { comando: comando.toLowerCase(), argumento: resto.join(" ").trim() };
}

export function criarHandler(deps: Deps) {
  const { telegram } = deps;
  const linkDoApp = linkApp(deps.botUsername, deps.appName);

  const botaoApp = () => ({
    inline_keyboard: [[{ text: BOTAO, url: linkDoApp }]],
  });

  /** Chama a Bot API e registra só o método e o status (nunca a URL). */
  async function chamar<T = unknown>(
    metodo: string,
    corpo: Record<string, unknown>,
  ): Promise<ResultadoTelegram<T>> {
    const r = await telegram.chamar<T>(metodo, corpo);
    if (r.tipo === "http") {
      console.warn(
        `bot-webhook: ${metodo} falhou (${r.status}): ${r.description}`,
      );
    } else if (r.tipo === "rede") {
      console.warn(`bot-webhook: ${metodo} sem resposta (${r.motivo})`);
    }
    return r;
  }

  function responder(m: Mensagem, texto: string, extra = {}) {
    return chamar<{ message_id: number }>("sendMessage", {
      chat_id: m.chat.id,
      ...(m.is_topic_message && m.message_thread_id
        ? { message_thread_id: m.message_thread_id }
        : {}),
      text: texto,
      ...extra,
    });
  }

  async function ehAdministrador(m: Mensagem): Promise<boolean> {
    // Administrador anônimo: a mensagem vem em nome do próprio grupo.
    if (m.sender_chat && m.sender_chat.id === m.chat.id) return true;
    if (!m.from) return false;
    const r = await chamar<{ status?: string }>("getChatMember", {
      chat_id: m.chat.id,
      user_id: m.from.id,
    });
    return r.tipo === "ok" &&
      (r.resultado?.status === "creator" ||
        r.resultado?.status === "administrator");
  }

  async function aoIniciar(m: Mensagem) {
    if (m.chat.type !== "private") return;
    await responder(m, TEXTOS.inicio, { reply_markup: botaoApp() });
  }

  async function aoVincular(m: Mensagem, slug: string) {
    if (!m.chat.is_forum || !m.is_topic_message || !m.message_thread_id) {
      await responder(m, TEXTOS.foraDoTopico);
      return;
    }
    if (!(await ehAdministrador(m))) {
      await responder(m, TEXTOS.soAdminVincular);
      return;
    }
    const alvo = slug.split(" ")[0].toLowerCase();
    if (alvo === "") {
      await responder(m, TEXTOS.uso);
      return;
    }
    const { data, error } = await deps.admin.rpc("vincular_obra", {
      p_slug: alvo,
      p_chat: m.chat.id,
      p_thread: m.message_thread_id,
    });
    if (error) throw new Error(`vincular_obra: ${error.message}`);
    const obra = data as { id?: string; nome?: string } | null;
    if (!obra || !obra.id) {
      await responder(m, TEXTOS.naoEncontrada(alvo));
      return;
    }
    await responder(m, TEXTOS.vinculado(obra.nome ?? alvo));
  }

  async function aoFixar(m: Mensagem) {
    if (m.chat.type === "private") return;
    if (!(await ehAdministrador(m))) {
      await responder(m, TEXTOS.soAdminFixar);
      return;
    }
    const enviada = await responder(m, TEXTOS.botaoFixado, {
      parse_mode: "HTML",
      reply_markup: botaoApp(),
    });
    if (enviada.tipo !== "ok") return;
    const fixada = await chamar("pinChatMessage", {
      chat_id: m.chat.id,
      message_id: enviada.resultado.message_id,
      disable_notification: true,
    });
    if (fixada.tipo !== "ok") {
      await responder(m, TEXTOS.semPermissaoFixar);
    }
  }

  async function configurar(): Promise<Response> {
    const secretToken = await deps.segredos.secretTokenWebhook();
    if (secretToken === null) {
      return json({ erro: "Segredo interno indisponível" }, 500);
    }
    const resumo = (r: ResultadoTelegram) =>
      r.tipo === "ok"
        ? { ok: true }
        : r.tipo === "http"
        ? { ok: false, status: r.status, description: r.description }
        : { ok: false, motivo: r.motivo };

    const webhook = await telegram.chamar("setWebhook", {
      url: deps.urlFuncao,
      secret_token: secretToken,
      allowed_updates: ["message"],
    });
    const privados = await telegram.chamar("setMyCommands", {
      commands: [{ command: "start", description: "Abrir o Diário da obra" }],
      scope: { type: "all_private_chats" },
    });
    const admins = await telegram.chamar("setMyCommands", {
      commands: [
        {
          command: "vincular_obra",
          description: "Vincular este tópico a uma obra",
        },
        {
          command: "fixar_botao",
          description: "Fixar o botão do Diário da obra",
        },
      ],
      scope: { type: "all_chat_administrators" },
    });
    const resultado = {
      webhook: resumo(webhook),
      comandos_privados: resumo(privados),
      comandos_administradores: resumo(admins),
    };
    const tudoOk = [webhook, privados, admins].every((r) => r.tipo === "ok");
    return json({ ok: tudoOk, ...resultado }, tudoOk ? 200 : 502);
  }

  async function processar(m: Mensagem) {
    if (typeof m.text !== "string") return;
    // Mensagens de bots são ignoradas, exceto a do administrador anônimo
    // (o Telegram a envia como GroupAnonymousBot, com `sender_chat`).
    if (m.from?.is_bot && !m.sender_chat) return;
    const cmd = lerComando(m.text, deps.botUsername);
    if (!cmd) return;
    switch (cmd.comando) {
      case "start":
        return await aoIniciar(m);
      case "vincular_obra":
        return await aoVincular(m, cmd.argumento);
      case "fixar_botao":
        return await aoFixar(m);
    }
  }

  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") {
      return new Response(null, { status: 405, headers: { Allow: "POST" } });
    }

    // Ação de configuração: chamada de dentro do banco, com o segredo interno.
    if (req.headers.has("x-segredo-interno")) {
      if (!(await deps.segredos.conferirInterno(req))) {
        return json({ erro: "Não autorizado" }, 401);
      }
      const corpo = await req.json().catch(() => null);
      if (corpo?.acao !== "configurar") {
        return json({ erro: "Ação inválida" }, 400);
      }
      return await configurar();
    }

    const secret = req.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (!(await deps.segredos.conferirWebhook(secret))) {
      return json({ erro: "Não autorizado" }, 401);
    }

    // Daqui em diante responde sempre 200, para o Telegram não reenviar em laço.
    try {
      const update = await req.json();
      if (update?.message) await processar(update.message as Mensagem);
    } catch (e) {
      console.error(
        "bot-webhook: erro ao processar update:",
        e instanceof Error ? e.message : "erro desconhecido",
      );
    }
    return json({ ok: true });
  };
}
