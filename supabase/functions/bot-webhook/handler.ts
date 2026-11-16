// Lógica da Edge Function bot-webhook, com dependências injetadas (testável sem rede).
import type { ClienteRpc, Segredos } from "../_shared/segredo.ts";
import {
  type ClienteTelegram,
  linkApp,
  type ResultadoTelegram,
} from "../_shared/telegram.ts";
import {
  buscarUsuario,
  type ClienteUsuarios,
  garantirUsuario,
  type Situacao,
  situacaoDoMembro,
} from "../_shared/usuario.ts";

export interface Deps {
  telegram: ClienteTelegram;
  admin: ClienteRpc & ClienteUsuarios;
  segredos: Segredos;
  botUsername: string;
  appName: string;
  /** URL pública desta função, registrada no `setWebhook`. */
  urlFuncao: string;
  agora?: () => Date;
}

interface UsuarioMsg {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface MembroChat {
  status?: string;
  is_member?: boolean;
  user?: UsuarioMsg;
}

interface MudancaMembro {
  chat: { id: number };
  new_chat_member?: MembroChat;
}

interface Mensagem {
  message_id: number;
  text?: string;
  message_thread_id?: number;
  is_topic_message?: boolean;
  from?: UsuarioMsg;
  sender_chat?: { id: number };
  new_chat_members?: UsuarioMsg[];
  left_chat_member?: UsuarioMsg;
  chat: { id: number; type: string; is_forum?: boolean; title?: string };
}

// Pares `chat:usuário` já registrados como "visto" na última hora (evita ir ao banco a cada mensagem).
const VISTO_TTL_MS = 60 * 60 * 1000;
const vistos = new Map<string, number>();

/** Esvazia o cache de "visto" (uso nos testes). */
export function limparCacheVistos() {
  vistos.clear();
}

const BOTAO = "Abrir Fiscal Bot";

const TEXTOS = {
  inicio:
    "Olá! O Fiscal Bot registra serviços e pendências com fotos, direto do canteiro, e publica cada registro no tópico da obra.\n\nToque no botão abaixo para abrir o app.",
  vinculado: (nome: string) =>
    `Tópico vinculado à obra ${nome}. Os registros do Fiscal Bot serão publicados aqui.`,
  foraDoTopico: "Use este comando dentro do tópico da obra.",
  soAdminVincular: "Só administradores do grupo podem vincular a obra.",
  soAdminFixar: "Só administradores do grupo podem fixar o botão.",
  naoEncontrada: (slug: string) => `Obra “${slug}” não encontrada.`,
  uso: "Uso: /vincular_obra <slug> (ex.: /vincular_obra hto)",
  etapaVinculada: (nome: string) =>
    `Grupo vinculado à etapa ${nome}. Agora vincule cada tópico à sua obra com /vincular_obra <slug>, dentro do tópico.`,
  foraDoGrupo: "Use este comando no grupo da etapa (supergrupo com tópicos).",
  soAdminVincularEtapa: "Só administradores do grupo podem vincular a etapa.",
  etapaNaoEncontrada: (slug: string) => `Etapa “${slug}” não encontrada.`,
  usoEtapa: "Uso: /vincular_etapa <slug> (ex.: /vincular_etapa 2a-etapa)",
  botaoFixado:
    "📋 <b>Fiscal Bot</b>\nToque no botão para registrar serviços e pendências da obra.",
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
    // 22023: recusa com mensagem para o grupo (ex.: obra arquivada no site de administração,
    // etapa sem grupo ou com outro grupo).
    if (error?.code === "22023") {
      await responder(m, error.message);
      return;
    }
    if (error) throw new Error(`vincular_obra: ${error.message}`);
    const obra = data as { id?: string; nome?: string } | null;
    if (!obra || !obra.id) {
      await responder(m, TEXTOS.naoEncontrada(alvo));
      return;
    }
    await responder(m, TEXTOS.vinculado(obra.nome ?? alvo));
  }

  /** Grupo da etapa: só em supergrupo, só administrador, em qualquer tópico. */
  async function aoVincularEtapa(m: Mensagem, slug: string) {
    if (m.chat.type !== "supergroup") {
      await responder(m, TEXTOS.foraDoGrupo);
      return;
    }
    if (!(await ehAdministrador(m))) {
      await responder(m, TEXTOS.soAdminVincularEtapa);
      return;
    }
    const alvo = slug.split(" ")[0].toLowerCase();
    if (alvo === "") {
      await responder(m, TEXTOS.usoEtapa);
      return;
    }
    const { data, error } = await deps.admin.rpc("vincular_etapa", {
      p_slug: alvo,
      p_chat: m.chat.id,
      p_titulo: m.chat.title ?? null,
    });
    // 22023: recusa com mensagem para o grupo (etapa arquivada, grupo de outra etapa...).
    if (error?.code === "22023") {
      await responder(m, error.message);
      return;
    }
    if (error) throw new Error(`vincular_etapa: ${error.message}`);
    const etapa = data as { id?: string; nome?: string } | null;
    if (!etapa || !etapa.id) {
      await responder(m, TEXTOS.etapaNaoEncontrada(alvo));
      return;
    }
    await responder(m, TEXTOS.etapaVinculada(etapa.nome ?? alvo));
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
      allowed_updates: ["message", "chat_member"],
    });
    const privados = await telegram.chamar("setMyCommands", {
      commands: [{ command: "start", description: "Abrir o Fiscal Bot" }],
      scope: { type: "all_private_chats" },
    });
    const admins = await telegram.chamar("setMyCommands", {
      commands: [
        {
          command: "vincular_etapa",
          description: "Vincular este grupo a uma etapa",
        },
        {
          command: "vincular_obra",
          description: "Vincular este tópico a uma obra",
        },
        {
          command: "fixar_botao",
          description: "Fixar o botão do Fiscal Bot",
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

  const agora = () => (deps.agora?.() ?? new Date()).getTime();

  /** Obras não arquivadas ligadas a este grupo. */
  async function obrasDoChat(chatId: number): Promise<string[]> {
    const { data, error } = await deps.admin.from("obra").select("id")
      .eq("telegram_chat_id", chatId).is("arquivada_em", null);
    if (error) throw new Error(`consulta obra: ${error.message}`);
    // deno-lint-ignore no-explicit-any
    return ((data ?? []) as any[]).map((o) => o.id as string);
  }

  async function sincronizar(
    usuarioId: string,
    obras: string[],
    situacao: Situacao | "visto",
  ) {
    const { error } = await deps.admin.rpc("sincronizar_acesso", {
      p_usuario: usuarioId,
      p_itens: obras.map((obra_id) => ({ obra_id, situacao })),
    });
    if (error) throw new Error(`sincronizar_acesso: ${error.message}`);
  }

  const ehPessoa = (u?: UsuarioMsg): u is UsuarioMsg & { first_name: string } =>
    !!u && !u.is_bot && typeof u.first_name === "string";

  /** Aplica a situação de uma pessoa em todas as obras do grupo. Nunca lança (só log). */
  async function aplicar(
    chatId: number,
    u: UsuarioMsg | undefined,
    situacao: Situacao | "visto",
  ) {
    try {
      if (!u || u.is_bot) return;
      const chave = `${chatId}:${u.id}`;
      if (situacao === "visto") {
        const antes = vistos.get(chave);
        if (antes !== undefined && agora() - antes < VISTO_TTL_MS) return;
      }
      const obras = await obrasDoChat(chatId);
      if (obras.length === 0) return;
      let id: string | null;
      if (situacao === "fora") {
        // Quem sai do grupo e nunca foi visto não vira usuário.
        id = await buscarUsuario(deps.admin, u.id);
        vistos.delete(chave);
      } else {
        if (!ehPessoa(u)) return;
        id = await garantirUsuario(deps.admin, u, deps.agora);
      }
      if (!id) return;
      await sincronizar(id, obras, situacao);
      if (situacao === "visto") vistos.set(chave, agora());
    } catch (e) {
      console.warn(
        "bot-webhook: falha ao registrar acesso:",
        e instanceof Error ? e.message : "erro desconhecido",
      );
    }
  }

  /** Update `chat_member`: mudança de situação de alguém no grupo. */
  async function processarMembro(c: MudancaMembro) {
    const novo = c.new_chat_member;
    const situacao = situacaoDoMembro(novo);
    if (!situacao) return;
    await aplicar(c.chat.id, novo?.user, situacao);
  }

  async function processar(m: Mensagem) {
    // Entrada e saída de pessoas no grupo (mensagens de serviço, sem texto).
    for (const u of m.new_chat_members ?? []) {
      await aplicar(m.chat.id, u, "membro");
    }
    if (m.left_chat_member) {
      await aplicar(m.chat.id, m.left_chat_member, "fora");
    }

    if (typeof m.text !== "string") return;
    // Mensagens de bots são ignoradas, exceto a do administrador anônimo
    // (o Telegram a envia como GroupAnonymousBot, com `sender_chat`).
    if (m.from?.is_bot && !m.sender_chat) return;
    // Mensagem comum ou comando de uma pessoa: conta como "visto" (sem resposta no grupo).
    // Mensagem de serviço de entrada/saída não conta: quem sai sozinho aparece em `from`
    // e voltaria para a lista logo depois do "fora".
    const servico = (m.new_chat_members?.length ?? 0) > 0 ||
      !!m.left_chat_member;
    if (!servico && !m.sender_chat) await aplicar(m.chat.id, m.from, "visto");
    const cmd = lerComando(m.text, deps.botUsername);
    if (!cmd) return;
    switch (cmd.comando) {
      case "start":
        return await aoIniciar(m);
      case "vincular_etapa":
        return await aoVincularEtapa(m, cmd.argumento);
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
      if (update?.chat_member) {
        await processarMembro(update.chat_member as MudancaMembro);
      }
    } catch (e) {
      console.error(
        "bot-webhook: erro ao processar update:",
        e instanceof Error ? e.message : "erro desconhecido",
      );
    }
    return json({ ok: true });
  };
}
