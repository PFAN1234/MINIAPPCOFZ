import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import {
  criarHandler,
  gerarTokenAleatorio,
  sha256Hex,
  TOKEN_FORMATO,
} from "./handler.ts";
import { assinarWidget } from "./widget_fixture.ts";

const BOT = "123456:TOKEN-DE-TESTE";
const AGORA = new Date("2026-11-11T12:00:00Z");
const ORIGEM = "https://miniappcofz.vercel.app";
const URL_ADMIN = "https://miniappcofz.vercel.app/admin/";
const UID = "00000000-0000-0000-0000-000000000001";
const TOKEN = "A".repeat(43);
const JWT_ADMIN = "jwt-do-admin";
const JWT_COMUM = "jwt-de-usuario-comum";
const TG_ADMIN = 1362893349;

const ADMIN = {
  usuario_id: UID,
  email: "tg1362893349@telegram.invalid",
  nome: "Patrício Ferreira",
  username: "patricio",
};

interface Link {
  usuario: string;
  expira: number;
}

/** Banco simulado: links por hash, admins por usuário e por telegram_id. */
function montar(opts: { rpcErro?: boolean } = {}) {
  const links = new Map<string, Link>();
  let agora = AGORA.getTime();
  const chamadas = {
    rpc: [] as { nome: string; args: Record<string, unknown> }[],
    generateLink: [] as Record<string, unknown>[],
    verifyOtp: 0,
  };
  const ehAdmin = (id: string) => id === UID;

  const admin = {
    rpc: (nome: string, args: Record<string, unknown> = {}) => {
      chamadas.rpc.push({ nome, args });
      if (opts.rpcErro) {
        return Promise.resolve({ data: null, error: { message: "falhou" } });
      }
      if (nome === "admin_entrada_criar") {
        if (!ehAdmin(args.p_usuario as string)) {
          return Promise.resolve({
            data: null,
            error: { message: "Apenas admins", code: "42501" },
          });
        }
        const expira = agora + 120_000;
        links.set(args.p_token_hash as string, {
          usuario: args.p_usuario as string,
          expira,
        });
        return Promise.resolve({
          data: new Date(expira).toISOString(),
          error: null,
        });
      }
      if (nome === "admin_entrada_consumir") {
        const l = links.get(args.p_token_hash as string);
        links.delete(args.p_token_hash as string);
        const valido = l && l.expira > agora && ehAdmin(l.usuario);
        return Promise.resolve({ data: valido ? [ADMIN] : [], error: null });
      }
      if (nome === "admin_por_telegram") {
        return Promise.resolve({
          data: args.p_telegram_id === TG_ADMIN ? [ADMIN] : [],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: { message: "rpc?" } });
    },
    auth: {
      getUser: (jwt: string) =>
        Promise.resolve(
          jwt === JWT_ADMIN
            ? { data: { user: { id: UID } }, error: null }
            : jwt === JWT_COMUM
            ? {
              data: { user: { id: "00000000-0000-0000-0000-000000000009" } },
              error: null,
            }
            : { data: { user: null }, error: { message: "invalid JWT" } },
        ),
      admin: {
        generateLink: (p: Record<string, unknown>) => {
          chamadas.generateLink.push(p);
          return Promise.resolve({
            data: { properties: { hashed_token: "HASH" } },
            error: null,
          });
        },
      },
    },
  };
  const sessao = {
    auth: {
      verifyOtp: () => {
        chamadas.verifyOtp++;
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
    botToken: BOT,
    origensPermitidas: [ORIGEM],
    urlAdmin: URL_ADMIN,
    admin,
    criarClienteSessao: () => sessao,
    agora: () => new Date(agora),
    gerarToken: () => TOKEN,
  });
  return {
    handler,
    chamadas,
    links,
    avancar: (ms: number) => {
      agora += ms;
    },
  };
}

const post = (corpo: unknown, jwt?: string) =>
  new Request("https://f.test/admin-sessao", {
    method: "POST",
    headers: {
      Origin: ORIGEM,
      "Content-Type": "application/json",
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
    },
    body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
  });

const SESSAO = {
  access_token: "AT",
  refresh_token: "RT",
  expires_at: 123,
  usuario: { id: UID, nome: "Patrício Ferreira", username: "patricio" },
};

Deno.test("token aleatório: 43 caracteres base64url e diferentes entre si", () => {
  const a = gerarTokenAleatorio();
  const b = gerarTokenAleatorio();
  assertMatch(a, TOKEN_FORMATO);
  assert(a !== b);
});

Deno.test("sha256Hex", async () => {
  assertEquals(
    await sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

Deno.test("OPTIONS, GET e corpo inválido", async () => {
  const { handler } = montar();
  const op = await handler(
    new Request("https://f.test/", {
      method: "OPTIONS",
      headers: { Origin: ORIGEM },
    }),
  );
  assertEquals(op.status, 204);
  assertEquals(op.headers.get("Access-Control-Allow-Origin"), ORIGEM);
  const mal = await handler(
    new Request("https://f.test/", {
      method: "OPTIONS",
      headers: { Origin: "https://mal.test" },
    }),
  );
  assertEquals(mal.headers.get("Access-Control-Allow-Origin"), null);
  assertEquals(
    (await handler(new Request("https://f.test/", { method: "GET" }))).status,
    405,
  );
  for (const c of ["{x", "null", "[]", { acao: "outra" }, {}]) {
    assertEquals((await handler(post(c))).status, 400);
  }
});

Deno.test("criar sem JWT, com JWT inválido ou de não admin: 403", async () => {
  const { handler, chamadas, links } = montar();
  for (const jwt of [undefined, "lixo", JWT_COMUM]) {
    const r = await handler(post({ acao: "criar" }, jwt));
    assertEquals(r.status, 403);
    assertEquals(await r.json(), { erro: "Acesso negado" });
  }
  assertEquals(links.size, 0);
  // só o não admin chega a pedir o link ao banco (e é recusado lá)
  assertEquals(chamadas.rpc.map((c) => c.nome), ["admin_entrada_criar"]);
});

Deno.test("criar: guarda só o hash e devolve a URL com o token", async () => {
  const { handler, chamadas, links } = montar();
  const r = await handler(post({ acao: "criar" }, JWT_ADMIN));
  assertEquals(r.status, 200);
  assertEquals(r.headers.get("Cache-Control"), "no-store");
  const corpo = await r.json();
  assertEquals(corpo.url, `${URL_ADMIN}#entrar=${TOKEN}`);
  assertEquals(
    corpo.expira_em,
    new Date(AGORA.getTime() + 120_000).toISOString(),
  );
  const hash = await sha256Hex(TOKEN);
  assertEquals(chamadas.rpc[0].args, { p_usuario: UID, p_token_hash: hash });
  assertEquals([...links.keys()], [hash]);
  assert(!JSON.stringify(chamadas.rpc).includes(TOKEN));
});

Deno.test("trocar token válido abre a sessão do mesmo usuário", async () => {
  const m = montar();
  await m.handler(post({ acao: "criar" }, JWT_ADMIN));
  const r = await m.handler(post({ acao: "trocar", token: TOKEN }));
  assertEquals(r.status, 200);
  assertEquals(await r.json(), SESSAO);
  assertEquals(m.chamadas.generateLink, [{
    type: "magiclink",
    email: "tg1362893349@telegram.invalid",
  }]);
  assertEquals(m.chamadas.verifyOtp, 1);
});

Deno.test("trocar token reutilizado: 401", async () => {
  const m = montar();
  await m.handler(post({ acao: "criar" }, JWT_ADMIN));
  assertEquals(
    (await m.handler(post({ acao: "trocar", token: TOKEN }))).status,
    200,
  );
  const r = await m.handler(post({ acao: "trocar", token: TOKEN }));
  assertEquals(r.status, 401);
  assertEquals(await r.json(), { erro: "Não autorizado" });
  assertEquals(m.chamadas.verifyOtp, 1);
});

Deno.test("trocar token expirado: 401", async () => {
  const m = montar();
  await m.handler(post({ acao: "criar" }, JWT_ADMIN));
  m.avancar(121_000);
  assertEquals(
    (await m.handler(post({ acao: "trocar", token: TOKEN }))).status,
    401,
  );
  assertEquals(m.chamadas.generateLink.length, 0);
});

Deno.test("trocar token desconhecido, malformado ou ausente", async () => {
  const { handler, chamadas } = montar();
  assertEquals(
    (await handler(post({ acao: "trocar", token: "B".repeat(43) }))).status,
    401,
  );
  assertEquals(
    (await handler(post({ acao: "trocar", token: "curto" }))).status,
    401,
  );
  assertEquals((await handler(post({ acao: "trocar" }))).status, 400);
  // o malformado nem chega ao banco
  assertEquals(chamadas.rpc.length, 1);
});

async function dadosWidget(extra: Record<string, string | number> = {}) {
  return await assinarWidget({
    id: TG_ADMIN,
    first_name: "Patrício",
    last_name: "Ferreira",
    username: "patricio",
    auth_date: Math.floor(AGORA.getTime() / 1000),
    ...extra,
  }, BOT);
}

Deno.test("widget com hash válido de admin: sessão", async () => {
  const { handler, chamadas } = montar();
  const r = await handler(post({ acao: "widget", dados: await dadosWidget() }));
  assertEquals(r.status, 200);
  assertEquals(await r.json(), SESSAO);
  assertEquals(chamadas.rpc, [{
    nome: "admin_por_telegram",
    args: { p_telegram_id: TG_ADMIN },
  }]);
});

Deno.test("widget com hash inválido: 401 sem tocar no banco", async () => {
  const { handler, chamadas } = montar();
  const dados = { ...(await dadosWidget()), first_name: "Outro" };
  const r = await handler(post({ acao: "widget", dados }));
  assertEquals(r.status, 401);
  assertEquals(chamadas.rpc.length, 0);
  assertEquals(
    (await handler(post({ acao: "widget" }))).status,
    401,
  );
});

Deno.test("widget antigo (mais de 24 h): 401", async () => {
  const { handler, chamadas } = montar();
  const antigo = Math.floor(AGORA.getTime() / 1000) - 25 * 3600;
  const r = await handler(
    post({ acao: "widget", dados: await dadosWidget({ auth_date: antigo }) }),
  );
  assertEquals(r.status, 401);
  assertEquals(chamadas.rpc.length, 0);
});

Deno.test("widget de quem não é admin (ou não existe): 403 e nenhuma sessão", async () => {
  const { handler, chamadas } = montar();
  const r = await handler(
    post({ acao: "widget", dados: await dadosWidget({ id: 555 }) }),
  );
  assertEquals(r.status, 403);
  assertEquals(await r.json(), { erro: "Acesso negado" });
  assertEquals(chamadas.generateLink.length + chamadas.verifyOtp, 0);
});

Deno.test("falha do banco vira 500 genérico", async () => {
  const { handler } = montar({ rpcErro: true });
  const r = await handler(post({ acao: "criar" }, JWT_ADMIN));
  assertEquals(r.status, 500);
  assertEquals(await r.json(), { erro: "Erro interno" });
  assertEquals(
    (await handler(post({ acao: "trocar", token: TOKEN }))).status,
    500,
  );
});
