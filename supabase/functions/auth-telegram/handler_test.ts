import { assertEquals } from "jsr:@std/assert@1";
import { assinarInitData } from "../_shared/init_data_fixture.ts";
import { criarHandler } from "./handler.ts";
import type { ResultadoTelegram } from "../_shared/telegram.ts";

const TOKEN = "123456:TOKEN-DE-TESTE";
const AGORA = new Date("2026-01-10T12:00:00Z");
const ORIGEM = "https://app.exemplo.test";
const UID = "00000000-0000-0000-0000-000000000001";

async function initValido(
  user = { id: 77, first_name: "Ana", last_name: "Souza", username: "ana" },
) {
  return await assinarInitData({
    auth_date: String(Math.floor(AGORA.getTime() / 1000)),
    user: JSON.stringify(user),
  }, TOKEN);
}

interface OpcoesMontar {
  existente?: boolean;
  createErro?: boolean;
  /** Obras com grupo vinculado, para a sincronização de acesso. */
  obras?: { id: string; telegram_chat_id: number }[];
  /** Resposta do getChatMember por chat_id. */
  membros?: Record<number, ResultadoTelegram>;
  rpcErro?: boolean;
  obrasErro?: boolean;
}

function montar(opts: OpcoesMontar = {}) {
  const chamadas = {
    rpc: [] as { nome: string; args: Record<string, unknown> }[],
    getChatMember: [] as Record<string, unknown>[],
    createUser: [] as Record<string, unknown>[],
    upsert: [] as Record<string, unknown>[],
    generateLink: 0,
    verifyOtp: [] as Record<string, unknown>[],
  };
  let linhaCriada = false;
  const admin = {
    rpc: (nome: string, args: Record<string, unknown> = {}) => {
      chamadas.rpc.push({ nome, args });
      return Promise.resolve(
        opts.rpcErro
          ? { data: null, error: { message: "falhou" } }
          : { data: null, error: null },
      );
    },
    from: (t: string) => ({
      select: () => ({
        not: () =>
          Promise.resolve(
            t === "obra" && opts.obrasErro
              ? { data: null, error: { message: "falhou" } }
              : { data: opts.obras ?? [], error: null },
          ),
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: opts.existente || (opts.createErro && linhaCriada)
                ? { id: UID }
                : null,
              error: null,
            }),
        }),
      }),
      upsert: (row: Record<string, unknown>) => {
        chamadas.upsert.push(row);
        linhaCriada = true;
        return Promise.resolve({ data: null, error: null });
      },
    }),
    auth: {
      admin: {
        createUser: (a: Record<string, unknown>) => {
          chamadas.createUser.push(a);
          return Promise.resolve(
            opts.createErro
              ? { data: null, error: { message: "email_exists" } }
              : { data: { user: { id: UID } }, error: null },
          );
        },
        generateLink: () => {
          chamadas.generateLink++;
          return Promise.resolve({
            data: { properties: { hashed_token: "HASH" }, user: { id: UID } },
            error: null,
          });
        },
      },
    },
  };
  const sessao = {
    auth: {
      verifyOtp: (p: Record<string, unknown>) => {
        chamadas.verifyOtp.push(p);
        return Promise.resolve({
          data: {
            session: {
              access_token: "AT",
              refresh_token: "RT",
              expires_at: 123,
            },
          },
          error: null,
        });
      },
    },
  };
  const handler = criarHandler({
    botToken: TOKEN,
    origensPermitidas: [ORIGEM],
    admin,
    criarClienteSessao: () => sessao,
    telegram: opts.obras
      ? {
        chamar: <T>(metodo: string, corpo?: unknown) => {
          const c = corpo as Record<string, unknown>;
          chamadas.getChatMember.push({ metodo, ...c });
          return Promise.resolve(
            (opts.membros?.[c.chat_id as number] ??
              { tipo: "rede", motivo: "falha" }) as ResultadoTelegram<T>,
          );
        },
      }
      : undefined,
    agora: () => AGORA,
  });
  return { handler, chamadas };
}

const post = (corpo: unknown, origem = ORIGEM) =>
  new Request("https://f.test/auth-telegram", {
    method: "POST",
    headers: { Origin: origem, "Content-Type": "application/json" },
    body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
  });

Deno.test("OPTIONS com origem permitida", async () => {
  const r = await montar().handler(
    new Request("https://f.test/", {
      method: "OPTIONS",
      headers: { Origin: ORIGEM },
    }),
  );
  assertEquals(r.status, 204);
  assertEquals(r.headers.get("Access-Control-Allow-Origin"), ORIGEM);
});

Deno.test("OPTIONS com origem negada não ecoa a origem", async () => {
  const r = await montar().handler(
    new Request("https://f.test/", {
      method: "OPTIONS",
      headers: { Origin: "https://mal.test" },
    }),
  );
  assertEquals(r.headers.get("Access-Control-Allow-Origin"), null);
});

Deno.test("GET retorna 405", async () => {
  const r = await montar().handler(
    new Request("https://f.test/", { method: "GET" }),
  );
  assertEquals(r.status, 405);
});

Deno.test("corpo inválido retorna 400", async () => {
  const { handler } = montar();
  assertEquals((await handler(post("{nao json"))).status, 400);
  assertEquals((await handler(post({ outro: 1 }))).status, 400);
  assertEquals((await handler(post({ initData: 5 }))).status, 400);
  assertEquals((await handler(post("null"))).status, 400);
});

Deno.test("initData inválido retorna 401 sem tocar no Supabase", async () => {
  const { handler, chamadas } = montar();
  const r = await handler(post({ initData: "auth_date=1&hash=00" }));
  assertEquals(r.status, 401);
  assertEquals((await r.json()).erro, "Não autorizado");
  assertEquals(chamadas.createUser.length + chamadas.upsert.length, 0);
});

Deno.test("usuário novo: cria no Auth, upsert e sessão", async () => {
  const { handler, chamadas } = montar();
  const r = await handler(post({ initData: await initValido() }));
  assertEquals(r.status, 200);
  assertEquals(r.headers.get("Access-Control-Allow-Origin"), ORIGEM);
  assertEquals(await r.json(), {
    access_token: "AT",
    refresh_token: "RT",
    expires_at: 123,
    usuario: { id: UID, nome: "Ana Souza", username: "ana" },
  });
  assertEquals(chamadas.createUser, [{
    email: "tg77@telegram.invalid",
    email_confirm: true,
    app_metadata: { telegram_id: 77 },
    user_metadata: { nome: "Ana Souza" },
  }]);
  assertEquals(chamadas.upsert, [{
    id: UID,
    telegram_id: 77,
    nome: "Ana Souza",
    username: "ana",
    atualizado_em: AGORA.toISOString(),
  }]);
  assertEquals(chamadas.verifyOtp, [{ token_hash: "HASH", type: "email" }]);
});

Deno.test("usuário existente: não chama createUser", async () => {
  const { handler, chamadas } = montar({ existente: true });
  const r = await handler(
    post({
      initData: await initValido({ id: 77, first_name: "Ana" } as never),
    }),
  );
  assertEquals(r.status, 200);
  assertEquals(chamadas.createUser.length, 0);
  assertEquals(chamadas.upsert.length, 1);
  assertEquals(chamadas.upsert[0].nome, "Ana");
  assertEquals(chamadas.upsert[0].username, null);
  assertEquals(chamadas.verifyOtp.length, 1);
});

Deno.test("corrida no createUser: busca de novo e segue", async () => {
  const { handler, chamadas } = montar({ createErro: true });
  const r = await handler(post({ initData: await initValido() }));
  assertEquals(r.status, 200);
  assertEquals(chamadas.createUser.length, 1);
  assertEquals(chamadas.upsert[0].id, UID);
});

const O1 = { id: "obra-1", telegram_chat_id: -1001 };
const O2 = { id: "obra-2", telegram_chat_id: -1002 };
const ok = (resultado: unknown): ResultadoTelegram => ({
  tipo: "ok",
  resultado,
});

async function entrar(opts: OpcoesMontar) {
  const m = montar(opts);
  const r = await m.handler(post({ initData: await initValido() }));
  return { ...m, r };
}

Deno.test("sincronização: admin, membro, restricted e left viram itens", async () => {
  const obras = [0, 1, 2, 3, 4, 5].map((i) => ({
    id: `obra-${i}`,
    telegram_chat_id: -1000 - i,
  }));
  const { r, chamadas } = await entrar({
    existente: true,
    obras,
    membros: {
      [-1000]: ok({ status: "creator" }),
      [-1001]: ok({ status: "administrator" }),
      [-1002]: ok({ status: "member" }),
      [-1003]: ok({ status: "restricted", is_member: true }),
      [-1004]: ok({ status: "restricted", is_member: false }),
      [-1005]: ok({ status: "kicked" }),
    },
  });
  assertEquals(r.status, 200);
  assertEquals(chamadas.getChatMember.length, 6);
  assertEquals(chamadas.getChatMember[0], {
    metodo: "getChatMember",
    chat_id: -1000,
    user_id: 77,
  });
  assertEquals(chamadas.rpc, [{
    nome: "sincronizar_acesso",
    args: {
      p_usuario: UID,
      p_itens: [
        { obra_id: "obra-0", situacao: "admin" },
        { obra_id: "obra-1", situacao: "admin" },
        { obra_id: "obra-2", situacao: "membro" },
        { obra_id: "obra-3", situacao: "membro" },
        { obra_id: "obra-4", situacao: "fora" },
        { obra_id: "obra-5", situacao: "fora" },
      ],
    },
  }]);
});

Deno.test("sincronização: left vira fora", async () => {
  const { chamadas } = await entrar({
    existente: true,
    obras: [O1],
    membros: { [-1001]: ok({ status: "left" }) },
  });
  assertEquals(chamadas.rpc[0].args.p_itens, [
    { obra_id: "obra-1", situacao: "fora" },
  ]);
});

Deno.test("sincronização: erro da API pula só aquela obra", async () => {
  const { r, chamadas } = await entrar({
    existente: true,
    obras: [O1, O2],
    membros: {
      [-1001]: { tipo: "http", status: 400, description: "chat not found" },
      [-1002]: ok({ status: "member" }),
    },
  });
  assertEquals(r.status, 200);
  assertEquals(chamadas.rpc[0].args.p_itens, [
    { obra_id: "obra-2", situacao: "membro" },
  ]);
});

Deno.test("sincronização: se todas as obras falham, não chama a RPC", async () => {
  const { r, chamadas } = await entrar({ existente: true, obras: [O1] });
  assertEquals(r.status, 200);
  assertEquals(chamadas.getChatMember.length, 1);
  assertEquals(chamadas.rpc.length, 0);
});

Deno.test("sincronização: sem obras vinculadas, não consulta o Telegram", async () => {
  const { r, chamadas } = await entrar({ existente: true, obras: [] });
  assertEquals(r.status, 200);
  assertEquals(chamadas.getChatMember.length, 0);
  assertEquals(chamadas.rpc.length, 0);
});

Deno.test("sincronização: falha da RPC não impede o login", async () => {
  const { r, chamadas } = await entrar({
    existente: true,
    obras: [O1],
    membros: { [-1001]: ok({ status: "member" }) },
    rpcErro: true,
  });
  assertEquals(r.status, 200);
  assertEquals((await r.json()).access_token, "AT");
  assertEquals(chamadas.rpc.length, 1);
});

Deno.test("sincronização: falha ao listar obras não impede o login", async () => {
  const { r } = await entrar({
    existente: true,
    obras: [O1],
    obrasErro: true,
  });
  assertEquals(r.status, 200);
});
