import { assertEquals } from "jsr:@std/assert@1";
import { assinarInitData } from "../_shared/init_data_fixture.ts";
import { criarHandler } from "./handler.ts";

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

function montar(opts: { existente?: boolean; createErro?: boolean } = {}) {
  const chamadas = {
    createUser: [] as Record<string, unknown>[],
    upsert: [] as Record<string, unknown>[],
    generateLink: 0,
    verifyOtp: [] as Record<string, unknown>[],
  };
  let linhaCriada = false;
  const admin = {
    from: (_t: string) => ({
      select: () => ({
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
