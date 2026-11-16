import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  criarSegredos,
  derivarSecretTokenWebhook,
} from "../_shared/segredo.ts";
import type { ResultadoTelegram } from "../_shared/telegram.ts";
import { criarHandler, lerComando, limparCacheVistos } from "./handler.ts";

const BOT = "diarioobra_cofz_bot";
const CHAT = -1001234;
const THREAD = 55;

type Chamada = { metodo: string; corpo: Record<string, unknown> };
type Respostas = Record<string, ResultadoTelegram | undefined>;

function montar(
  opts: {
    respostas?: Respostas;
    obra?: unknown;
    rpcErro?: boolean | { message: string; code?: string };
    rpcLanca?: boolean;
    /** Obras (ids) não arquivadas ligadas ao grupo CHAT. */
    obrasDoGrupo?: string[];
    /** `telegram_id` → id dos usuários que já existem. */
    usuarios?: Record<number, string>;
    agora?: () => Date;
  } = {},
) {
  limparCacheVistos();
  const criados: number[] = [];
  const consultasObra: number[] = [];
  const usuarios = { ...(opts.usuarios ?? {}) };
  const chamadas: Chamada[] = [];
  const rpcs: { nome: string; args: Record<string, unknown> }[] = [];
  const respostas = opts.respostas ?? {};
  const admin = {
    from: (tabela: string) => {
      let filtro: unknown = null;
      const b = {
        select: () => b,
        eq: (_c: string, v: unknown) => {
          filtro = v;
          return b;
        },
        is: () => b,
        maybeSingle: () => {
          const id = usuarios[filtro as number];
          return Promise.resolve({
            data: id ? { id } : null,
            error: null,
          });
        },
        upsert: () => Promise.resolve({ error: null }),
        // deno-lint-ignore no-explicit-any
        then: (ok: any, falha: any) => {
          if (tabela === "obra") consultasObra.push(filtro as number);
          const ids = filtro === CHAT ? (opts.obrasDoGrupo ?? []) : [];
          return Promise.resolve({
            data: ids.map((id) => ({ id })),
            error: null,
          }).then(ok, falha);
        },
      };
      return b;
    },
    auth: {
      admin: {
        createUser: (attrs: { app_metadata: { telegram_id: number } }) => {
          const tid = attrs.app_metadata.telegram_id;
          criados.push(tid);
          usuarios[tid] = `novo-${tid}`;
          return Promise.resolve({
            data: { user: { id: `novo-${tid}` } },
            error: null,
          });
        },
        generateLink: () =>
          Promise.resolve({ data: null, error: { message: "x" } }),
      },
    },
    rpc: (nome: string, args: Record<string, unknown> = {}) => {
      if (nome === "segredo_interno") {
        return Promise.resolve({ data: "SEG", error: null });
      }
      rpcs.push({ nome, args });
      if (opts.rpcLanca) return Promise.reject(new Error("boom"));
      return Promise.resolve(
        opts.rpcErro
          ? {
            data: null,
            error: opts.rpcErro === true ? { message: "falhou" } : opts.rpcErro,
          }
          : { data: opts.obra ?? null, error: null },
      );
    },
  };
  const handler = criarHandler({
    telegram: {
      chamar: <T>(metodo: string, corpo?: unknown) => {
        chamadas.push({ metodo, corpo: corpo as Record<string, unknown> });
        const r = respostas[metodo] ??
          (metodo === "sendMessage"
            ? { tipo: "ok", resultado: { message_id: 900 } }
            : { tipo: "ok", resultado: true });
        return Promise.resolve(r as ResultadoTelegram<T>);
      },
    },
    admin,
    segredos: criarSegredos(admin),
    botUsername: BOT,
    appName: "diario",
    urlFuncao: "https://p.supabase.co/functions/v1/bot-webhook",
    agora: opts.agora,
  });
  return { handler, chamadas, rpcs, criados, consultasObra };
}

const status = (s: string, extra = {}) =>
  ({
    tipo: "ok",
    resultado: { status: s, ...extra },
  }) as ResultadoTelegram;

async function update(
  handler: (r: Request) => Promise<Response>,
  message: Record<string, unknown>,
  secret?: string | null,
) {
  const s = secret === undefined
    ? await derivarSecretTokenWebhook("SEG")
    : secret;
  return await handler(
    new Request("https://f.test/bot-webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(s ? { "X-Telegram-Bot-Api-Secret-Token": s } : {}),
      },
      body: JSON.stringify({ update_id: 1, message }),
    }),
  );
}

async function updateBruto(
  handler: (r: Request) => Promise<Response>,
  corpo: Record<string, unknown>,
) {
  return await handler(
    new Request("https://f.test/bot-webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": await derivarSecretTokenWebhook(
          "SEG",
        ),
      },
      body: JSON.stringify({ update_id: 2, ...corpo }),
    }),
  );
}

const noTopico = (text: string, extra = {}) => ({
  message_id: 10,
  text,
  chat: { id: CHAT, type: "supergroup", is_forum: true },
  message_thread_id: THREAD,
  is_topic_message: true,
  from: { id: 7, first_name: "Ana" },
  ...extra,
});

const enviadas = (c: Chamada[]) => c.filter((x) => x.metodo === "sendMessage");

Deno.test("lerComando: aceita /cmd e /cmd@bot, ignora outro bot", () => {
  assertEquals(lerComando("/start", BOT), { comando: "start", argumento: "" });
  assertEquals(lerComando(`/vincular_obra@${BOT} hto`, BOT), {
    comando: "vincular_obra",
    argumento: "hto",
  });
  assertEquals(
    lerComando(`/start@${BOT.toUpperCase()}`, BOT)?.comando,
    "start",
  );
  assertEquals(lerComando("/start@outro_bot", BOT), null);
  assertEquals(lerComando("oi", BOT), null);
  assertEquals(lerComando("/", BOT), null);
});

Deno.test("segredo do webhook inválido ou ausente → 401, sem chamar nada", async () => {
  const { handler, chamadas, rpcs } = montar();
  const msg = { text: "/start", chat: { id: 1, type: "private" } };
  assertEquals((await update(handler, msg, "errado")).status, 401);
  assertEquals((await update(handler, msg, null)).status, 401);
  assertEquals(chamadas.length + rpcs.length, 0);
});

Deno.test("GET → 405", async () => {
  const r = await montar().handler(
    new Request("https://f.test/", { method: "GET" }),
  );
  assertEquals(r.status, 405);
});

Deno.test("configurar: setWebhook e setMyCommands nos dois escopos", async () => {
  const { handler, chamadas } = montar();
  const r = await handler(
    new Request("https://f.test/bot-webhook", {
      method: "POST",
      headers: { "x-segredo-interno": "SEG" },
      body: JSON.stringify({ acao: "configurar" }),
    }),
  );
  assertEquals(r.status, 200);
  const corpo = await r.json();
  assertEquals(corpo.ok, true);
  assertEquals(chamadas.map((c) => c.metodo), [
    "setWebhook",
    "setMyCommands",
    "setMyCommands",
  ]);
  assertEquals(chamadas[0].corpo, {
    url: "https://p.supabase.co/functions/v1/bot-webhook",
    secret_token: await derivarSecretTokenWebhook("SEG"),
    allowed_updates: ["message", "chat_member"],
  });
  assertEquals(chamadas[1].corpo.scope, { type: "all_private_chats" });
  assertEquals(
    (chamadas[1].corpo.commands as { command: string }[]).map((c) => c.command),
    ["start"],
  );
  assertEquals(chamadas[2].corpo.scope, { type: "all_chat_administrators" });
  assertEquals(
    (chamadas[2].corpo.commands as { command: string }[]).map((c) => c.command),
    ["vincular_etapa", "vincular_obra", "fixar_botao"],
  );
});

Deno.test("configurar: segredo interno errado → 401; ação inválida → 400", async () => {
  const { handler, chamadas } = montar();
  const req = (seg: string, corpo: unknown) =>
    new Request("https://f.test/", {
      method: "POST",
      headers: { "x-segredo-interno": seg },
      body: JSON.stringify(corpo),
    });
  assertEquals((await handler(req("X", { acao: "configurar" }))).status, 401);
  assertEquals((await handler(req("SEG", { acao: "outra" }))).status, 400);
  assertEquals(chamadas.length, 0);
});

Deno.test("configurar: falha do Telegram aparece sem token", async () => {
  const { handler } = montar({
    respostas: {
      setWebhook: { tipo: "http", status: 401, description: "Unauthorized" },
    },
  });
  const r = await handler(
    new Request("https://f.test/", {
      method: "POST",
      headers: { "x-segredo-interno": "SEG" },
      body: JSON.stringify({ acao: "configurar" }),
    }),
  );
  assertEquals(r.status, 502);
  const corpo = await r.json();
  assertEquals(corpo.ok, false);
  assertEquals(corpo.webhook, {
    ok: false,
    status: 401,
    description: "Unauthorized",
  });
});

Deno.test("/start no privado envia o botão do app", async () => {
  const { handler, chamadas } = montar();
  const r = await update(handler, {
    message_id: 1,
    text: "/start",
    chat: { id: 7, type: "private" },
    from: { id: 7 },
  });
  assertEquals(r.status, 200);
  const [m] = enviadas(chamadas);
  assertEquals(m.corpo.chat_id, 7);
  assertEquals(m.corpo.reply_markup, {
    inline_keyboard: [[{
      text: "Abrir Fiscal Bot",
      url: `https://t.me/${BOT}/diario`,
    }]],
  });
});

Deno.test("/start em grupo é ignorado", async () => {
  const { handler, chamadas } = montar();
  await update(handler, noTopico("/start"));
  assertEquals(chamadas.length, 0);
});

Deno.test("comando para outro bot e mensagem de bot são ignorados", async () => {
  const { handler, chamadas, rpcs } = montar();
  await update(handler, noTopico("/vincular_obra@outro_bot hto"));
  await update(
    handler,
    noTopico("/vincular_obra hto", { from: { id: 9, is_bot: true } }),
  );
  await update(handler, noTopico("texto comum"));
  assertEquals(chamadas.length + rpcs.length, 0);
});

Deno.test("/vincular_obra fora de tópico", async () => {
  const { handler, chamadas, rpcs } = montar();
  await update(handler, {
    message_id: 1,
    text: "/vincular_obra hto",
    chat: { id: CHAT, type: "supergroup", is_forum: true },
    from: { id: 7 },
  });
  assertEquals(
    enviadas(chamadas)[0].corpo.text,
    "Use este comando dentro do tópico da obra.",
  );
  assertEquals(rpcs.length, 0);
});

Deno.test("/vincular_obra por quem não é administrador", async () => {
  const { handler, chamadas, rpcs } = montar({
    respostas: { getChatMember: status("member") },
  });
  await update(handler, noTopico("/vincular_obra hto"));
  assertEquals(
    enviadas(chamadas)[0].corpo.text,
    "Só administradores do grupo podem vincular a obra.",
  );
  assertEquals(enviadas(chamadas)[0].corpo.message_thread_id, THREAD);
  assertEquals(rpcs.length, 0);
});

Deno.test("/vincular_obra: erro na checagem de administrador nega", async () => {
  const { handler, chamadas, rpcs } = montar({
    respostas: {
      getChatMember: { tipo: "http", status: 400, description: "x" },
    },
  });
  await update(handler, noTopico("/vincular_obra hto"));
  assertEquals(
    enviadas(chamadas)[0].corpo.text,
    "Só administradores do grupo podem vincular a obra.",
  );
  assertEquals(rpcs.length, 0);
});

Deno.test("/vincular_obra como administrador anônimo", async () => {
  const { handler, chamadas, rpcs } = montar({
    obra: { id: "o1", nome: "HTO" },
  });
  await update(
    handler,
    noTopico("/vincular_obra hto", {
      from: { id: 1087968824, is_bot: true },
      sender_chat: { id: CHAT },
    }),
  );
  // Sem getChatMember: o próprio grupo é o remetente.
  assertEquals(chamadas.filter((c) => c.metodo === "getChatMember").length, 0);
  assertEquals(rpcs.length, 1);
});

Deno.test("/vincular_obra sem argumento mostra o uso", async () => {
  const { handler, chamadas, rpcs } = montar({
    respostas: { getChatMember: status("administrator") },
  });
  await update(handler, noTopico("/vincular_obra"));
  assertEquals(
    enviadas(chamadas)[0].corpo.text,
    "Uso: /vincular_obra <slug> (ex.: /vincular_obra hto)",
  );
  assertEquals(rpcs.length, 0);
});

Deno.test("/vincular_obra com slug inexistente", async () => {
  const { handler, chamadas, rpcs } = montar({
    respostas: { getChatMember: status("creator") },
    obra: null,
  });
  await update(handler, noTopico("/vincular_obra xyz"));
  assertEquals(rpcs[0], {
    nome: "vincular_obra",
    args: { p_slug: "xyz", p_chat: CHAT, p_thread: THREAD },
  });
  assertEquals(enviadas(chamadas)[0].corpo.text, "Obra “xyz” não encontrada.");
});

Deno.test("/vincular_obra com obra arquivada mostra a mensagem do banco", async () => {
  const msg =
    "A obra “HTO” está arquivada. Peça a um admin do Mini App para desarquivá-la antes de vincular o tópico.";
  const { handler, chamadas } = montar({
    respostas: { getChatMember: status("creator") },
    rpcErro: { message: msg, code: "22023" },
  });
  const r = await update(handler, noTopico("/vincular_obra hto"));
  assertEquals(r.status, 200);
  assertEquals(enviadas(chamadas)[0].corpo.text, msg);
});

Deno.test("/vincular_obra com sucesso (e @bot no comando)", async () => {
  const { handler, chamadas, rpcs } = montar({
    respostas: { getChatMember: status("administrator") },
    obra: { id: "o1", nome: "HTO", slug: "hto" },
  });
  const r = await update(handler, noTopico(`/vincular_obra@${BOT} hto`));
  assertEquals(r.status, 200);
  assertEquals(rpcs, [{
    nome: "vincular_obra",
    args: { p_slug: "hto", p_chat: CHAT, p_thread: THREAD },
  }]);
  const [m] = enviadas(chamadas);
  assertEquals(
    m.corpo.text,
    "Tópico vinculado à obra HTO. Os registros do Fiscal Bot serão publicados aqui.",
  );
  assertEquals(m.corpo.chat_id, CHAT);
  assertEquals(m.corpo.message_thread_id, THREAD);
});

Deno.test("/vincular_etapa fora de supergrupo", async () => {
  for (
    const chat of [{ id: 7, type: "private" }, { id: CHAT, type: "group" }]
  ) {
    const { handler, chamadas, rpcs } = montar();
    await update(handler, {
      message_id: 1,
      text: "/vincular_etapa 2a-etapa",
      chat,
      from: { id: 7 },
    });
    assertEquals(
      enviadas(chamadas)[0].corpo.text,
      "Use este comando no grupo da etapa (supergrupo com tópicos).",
    );
    assertEquals(rpcs.length, 0);
  }
});

Deno.test("/vincular_etapa por quem não é administrador", async () => {
  const { handler, chamadas, rpcs } = montar({
    respostas: { getChatMember: status("member") },
  });
  await update(handler, noTopico("/vincular_etapa 2a-etapa"));
  assertEquals(
    enviadas(chamadas)[0].corpo.text,
    "Só administradores do grupo podem vincular a etapa.",
  );
  assertEquals(rpcs.length, 0);
});

Deno.test("/vincular_etapa sem argumento mostra o uso", async () => {
  const { handler, chamadas, rpcs } = montar({
    respostas: { getChatMember: status("administrator") },
  });
  await update(handler, noTopico("/vincular_etapa"));
  assertEquals(
    enviadas(chamadas)[0].corpo.text,
    "Uso: /vincular_etapa <slug> (ex.: /vincular_etapa 2a-etapa)",
  );
  assertEquals(rpcs.length, 0);
});

Deno.test("/vincular_etapa com slug inexistente", async () => {
  const { handler, chamadas, rpcs } = montar({
    respostas: { getChatMember: status("creator") },
    obra: null,
  });
  await update(handler, noTopico("/vincular_etapa XYZ"));
  assertEquals(rpcs[0], {
    nome: "vincular_etapa",
    args: { p_slug: "xyz", p_chat: CHAT, p_titulo: null },
  });
  assertEquals(
    enviadas(chamadas)[0].corpo.text,
    "Etapa “xyz” não encontrada.",
  );
});

Deno.test("/vincular_etapa recusada pelo banco mostra a mensagem", async () => {
  const msg =
    "A etapa “2ª ETAPA” já está vinculada a outro grupo. Desvincule o grupo no site de administração antes de vincular este.";
  const { handler, chamadas } = montar({
    respostas: { getChatMember: status("creator") },
    rpcErro: { message: msg, code: "22023" },
  });
  const r = await update(handler, noTopico("/vincular_etapa 2a-etapa"));
  assertEquals(r.status, 200);
  assertEquals(enviadas(chamadas)[0].corpo.text, msg);
});

Deno.test("/vincular_etapa com sucesso no tópico Geral, com o título do grupo", async () => {
  const { handler, chamadas, rpcs } = montar({
    respostas: { getChatMember: status("administrator") },
    obra: { id: "e1", nome: "2ª ETAPA", slug: "2a-etapa" },
  });
  const r = await update(handler, {
    message_id: 4,
    text: `/vincular_etapa@${BOT} 2a-etapa`,
    chat: {
      id: CHAT,
      type: "supergroup",
      is_forum: true,
      title: "Obras 2ª etapa",
    },
    from: { id: 7 },
  });
  assertEquals(r.status, 200);
  assertEquals(rpcs, [{
    nome: "vincular_etapa",
    args: { p_slug: "2a-etapa", p_chat: CHAT, p_titulo: "Obras 2ª etapa" },
  }]);
  const [m] = enviadas(chamadas);
  assertEquals(
    m.corpo.text,
    "Grupo vinculado à etapa 2ª ETAPA. Agora vincule cada tópico à sua obra com /vincular_obra <slug>, dentro do tópico.",
  );
  assertEquals(m.corpo.chat_id, CHAT);
  assert(!("message_thread_id" in m.corpo));
});

Deno.test("/vincular_etapa dentro de um tópico responde no tópico", async () => {
  const { handler, chamadas } = montar({
    respostas: { getChatMember: status("administrator") },
    obra: { id: "e1", nome: "2ª ETAPA" },
  });
  await update(handler, noTopico("/vincular_etapa 2a-etapa"));
  assertEquals(enviadas(chamadas)[0].corpo.message_thread_id, THREAD);
});

Deno.test("/vincular_obra sem a etapa vinculada mostra a mensagem do banco", async () => {
  const msg = "Vincule antes a etapa: /vincular_etapa 2a-etapa";
  const { handler, chamadas } = montar({
    respostas: { getChatMember: status("creator") },
    rpcErro: { message: msg, code: "22023" },
  });
  await update(handler, noTopico("/vincular_obra hto"));
  assertEquals(enviadas(chamadas)[0].corpo.text, msg);
});

Deno.test("/fixar_botao: envia no tópico e fixa sem notificar", async () => {
  const { handler, chamadas } = montar({
    respostas: { getChatMember: status("administrator") },
  });
  await update(handler, noTopico("/fixar_botao"));
  assertEquals(chamadas.map((c) => c.metodo), [
    "getChatMember",
    "sendMessage",
    "pinChatMessage",
  ]);
  assertEquals(
    chamadas[1].corpo.text,
    "📋 <b>Fiscal Bot</b>\nToque no botão para registrar serviços e pendências da obra.",
  );
  assertEquals(chamadas[1].corpo.parse_mode, "HTML");
  assertEquals(chamadas[1].corpo.message_thread_id, THREAD);
  assertEquals(chamadas[2].corpo, {
    chat_id: CHAT,
    message_id: 900,
    disable_notification: true,
  });
});

Deno.test("/fixar_botao: no tópico Geral não manda message_thread_id", async () => {
  const { handler, chamadas } = montar({
    respostas: { getChatMember: status("creator") },
  });
  await update(handler, {
    message_id: 3,
    text: "/fixar_botao",
    chat: { id: CHAT, type: "supergroup", is_forum: true },
    from: { id: 7 },
  });
  assert(!("message_thread_id" in chamadas[1].corpo));
});

Deno.test("/fixar_botao: sem permissão de fixar avisa", async () => {
  const { handler, chamadas } = montar({
    respostas: {
      getChatMember: status("administrator"),
      pinChatMessage: {
        tipo: "http",
        status: 400,
        description: "not enough rights to pin a message",
      },
    },
  });
  const r = await update(handler, noTopico("/fixar_botao"));
  assertEquals(r.status, 200);
  const msgs = enviadas(chamadas);
  assertEquals(msgs.length, 2);
  assertEquals(msgs[1].corpo.text, "Preciso da permissão de fixar mensagens.");
});

Deno.test("/fixar_botao por quem não é administrador", async () => {
  const { handler, chamadas } = montar({
    respostas: { getChatMember: status("member") },
  });
  await update(handler, noTopico("/fixar_botao"));
  assertEquals(chamadas.some((c) => c.metodo === "pinChatMessage"), false);
  assertEquals(
    enviadas(chamadas)[0].corpo.text,
    "Só administradores do grupo podem fixar o botão.",
  );
});

Deno.test("erro interno (RPC com erro ou exceção) → 200", async () => {
  for (const opts of [{ rpcErro: true }, { rpcLanca: true }]) {
    const { handler } = montar({
      ...opts,
      respostas: { getChatMember: status("administrator") },
    });
    const r = await update(handler, noTopico("/vincular_obra hto"));
    assertEquals(r.status, 200);
    const r2 = await update(handler, noTopico("/vincular_etapa 2a-etapa"));
    assertEquals(r2.status, 200);
  }
});

Deno.test("corpo que não é JSON após o segredo válido → 200", async () => {
  const { handler } = montar();
  const r = await handler(
    new Request("https://f.test/", {
      method: "POST",
      headers: {
        "X-Telegram-Bot-Api-Secret-Token": await derivarSecretTokenWebhook(
          "SEG",
        ),
      },
      body: "{nao json",
    }),
  );
  assertEquals(r.status, 200);
});

// --- Acessos por lista: quem o bot conhece ---------------------------------------------------

const OBRAS = ["obra-1", "obra-2"];
const sincs = (r: { nome: string; args: Record<string, unknown> }[]) =>
  r.filter((x) => x.nome === "sincronizar_acesso");
const itens = (situacao: string) =>
  OBRAS.map((obra_id) => ({ obra_id, situacao }));

Deno.test("mensagem comum no grupo da obra gera 'visto' e não responde", async () => {
  const { handler, rpcs, chamadas, criados } = montar({ obrasDoGrupo: OBRAS });
  const r = await update(handler, noTopico("bom dia"));
  assertEquals(r.status, 200);
  assertEquals(criados, [7]);
  assertEquals(sincs(rpcs).map((x) => x.args), [
    { p_usuario: "novo-7", p_itens: itens("visto") },
  ]);
  assertEquals(chamadas, []);
});

Deno.test("visto: cache de uma hora por chat e usuário", async () => {
  let t = Date.parse("2026-11-16T10:00:00Z");
  const { handler, rpcs, consultasObra } = montar({
    obrasDoGrupo: OBRAS,
    usuarios: { 7: "u7", 8: "u8" },
    agora: () => new Date(t),
  });
  await update(handler, noTopico("oi"));
  await update(handler, noTopico("de novo"));
  assertEquals(sincs(rpcs).length, 1);
  assertEquals(consultasObra.length, 1);
  // Outra pessoa não é afetada pelo cache.
  await update(handler, noTopico("oi", { from: { id: 8, first_name: "Bia" } }));
  assertEquals(sincs(rpcs).length, 2);
  // Passada uma hora, registra de novo.
  t += 61 * 60 * 1000;
  await update(handler, noTopico("voltei"));
  assertEquals(sincs(rpcs).length, 3);
});

Deno.test("comando também conta como 'visto'", async () => {
  const { handler, rpcs } = montar({
    obrasDoGrupo: OBRAS,
    usuarios: { 7: "u7" },
    respostas: { getChatMember: status("administrator") },
  });
  await update(handler, noTopico("/fixar_botao"));
  assertEquals(sincs(rpcs).map((x) => x.args), [
    { p_usuario: "u7", p_itens: itens("visto") },
  ]);
});

Deno.test("chat sem obra e mensagens de bot são ignorados", async () => {
  const { handler, rpcs, criados } = montar({ obrasDoGrupo: [] });
  await update(handler, noTopico("oi"));
  assertEquals(sincs(rpcs), []);
  assertEquals(criados, []);

  const com = montar({ obrasDoGrupo: OBRAS });
  await update(
    com.handler,
    noTopico("oi", { from: { id: 9, is_bot: true, first_name: "Bot" } }),
  );
  await update(
    com.handler,
    noTopico("oi", { from: undefined, sender_chat: { id: -100 } }),
  );
  await update(com.handler, {
    ...noTopico(""),
    text: undefined,
    new_chat_members: [{ id: 9, is_bot: true, first_name: "Bot" }],
  });
  await update(com.handler, {
    ...noTopico(""),
    text: undefined,
    left_chat_member: { id: 9, is_bot: true, first_name: "Bot" },
  });
  assertEquals(sincs(com.rpcs), []);
  assertEquals(com.criados, []);
});

Deno.test("entrada e saída pelo update 'message'", async () => {
  const { handler, rpcs, criados } = montar({
    obrasDoGrupo: OBRAS,
    usuarios: { 20: "u20" },
  });
  const servico = { message_id: 11, chat: { id: CHAT, type: "supergroup" } };
  await update(handler, {
    ...servico,
    new_chat_members: [
      { id: 10, first_name: "Caio" },
      { id: 11, is_bot: true, first_name: "Bot" },
    ],
  });
  assertEquals(criados, [10]);
  assertEquals(sincs(rpcs).map((x) => x.args), [
    { p_usuario: "novo-10", p_itens: itens("membro") },
  ]);
  await update(handler, {
    ...servico,
    left_chat_member: { id: 20, first_name: "Duda" },
  });
  assertEquals(sincs(rpcs).at(-1)?.args, {
    p_usuario: "u20",
    p_itens: itens("fora"),
  });
  // Quem sai sem nunca ter sido visto não vira usuário.
  const antes = sincs(rpcs).length;
  await update(handler, {
    ...servico,
    left_chat_member: { id: 30, first_name: "Edu" },
  });
  assertEquals(sincs(rpcs).length, antes);
  assertEquals(criados, [10]);
  // Quem sai sozinho vem também em `from`: a saída não pode virar "visto" em seguida.
  await update(handler, {
    ...servico,
    from: { id: 20, first_name: "Duda" },
    left_chat_member: { id: 20, first_name: "Duda" },
  });
  assertEquals(sincs(rpcs).at(-1)?.args, {
    p_usuario: "u20",
    p_itens: itens("fora"),
  });
});

Deno.test("update 'chat_member' converte a situação como o auth-telegram", async () => {
  const casos: [Record<string, unknown>, string | null][] = [
    [{ status: "creator" }, "admin"],
    [{ status: "administrator" }, "admin"],
    [{ status: "member" }, "membro"],
    [{ status: "restricted", is_member: true }, "membro"],
    [{ status: "restricted", is_member: false }, "fora"],
    [{ status: "left" }, "fora"],
    [{ status: "kicked" }, "fora"],
    [{ status: "outro" }, null],
  ];
  for (const [membro, esperado] of casos) {
    const { handler, rpcs } = montar({
      obrasDoGrupo: OBRAS,
      usuarios: { 40: "u40" },
    });
    const r = await updateBruto(handler, {
      chat_member: {
        chat: { id: CHAT, type: "supergroup" },
        new_chat_member: { ...membro, user: { id: 40, first_name: "Fer" } },
      },
    });
    assertEquals(r.status, 200);
    assertEquals(
      sincs(rpcs).map((x) => x.args),
      esperado ? [{ p_usuario: "u40", p_itens: itens(esperado) }] : [],
    );
  }
});

Deno.test("chat_member: 'fora' sem usuário não faz nada; entrada cria; bot e chat sem obra são ignorados", async () => {
  const fora = montar({ obrasDoGrupo: OBRAS });
  await updateBruto(fora.handler, {
    chat_member: {
      chat: { id: CHAT, type: "supergroup" },
      new_chat_member: { status: "left", user: { id: 50, first_name: "Gil" } },
    },
  });
  assertEquals(sincs(fora.rpcs), []);
  assertEquals(fora.criados, []);

  const entra = montar({ obrasDoGrupo: OBRAS });
  await updateBruto(entra.handler, {
    chat_member: {
      chat: { id: CHAT, type: "supergroup" },
      new_chat_member: {
        status: "member",
        user: { id: 51, first_name: "Ivo" },
      },
    },
  });
  assertEquals(entra.criados, [51]);
  assertEquals(sincs(entra.rpcs).map((x) => x.args), [
    { p_usuario: "novo-51", p_itens: itens("membro") },
  ]);

  const ign = montar({ obrasDoGrupo: OBRAS });
  await updateBruto(ign.handler, {
    chat_member: {
      chat: { id: CHAT, type: "supergroup" },
      new_chat_member: {
        status: "member",
        user: { id: 52, is_bot: true, first_name: "Bot" },
      },
    },
  });
  await updateBruto(ign.handler, {
    chat_member: {
      chat: { id: -999, type: "supergroup" },
      new_chat_member: { status: "member", user: { id: 53, first_name: "Jo" } },
    },
  });
  assertEquals(sincs(ign.rpcs), []);
  assertEquals(ign.criados, []);
});

Deno.test("falha ao registrar acesso não derruba o update nem o comando", async () => {
  const { handler, chamadas } = montar({
    obrasDoGrupo: OBRAS,
    rpcErro: true,
    respostas: { getChatMember: status("administrator") },
  });
  const r = await update(handler, noTopico("/fixar_botao"));
  assertEquals(r.status, 200);
  assertEquals(enviadas(chamadas).length >= 1, true);
});
