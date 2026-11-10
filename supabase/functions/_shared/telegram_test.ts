import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import {
  criarClienteTelegram,
  escaparHtml,
  type FetchFn,
  linkApp,
} from "./telegram.ts";
import {
  criarSegredos,
  derivarSecretTokenWebhook,
  TTL_CACHE_MS,
} from "./segredo.ts";

const TOKEN = "123456:TOKEN-SECRETO";

function resposta(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status });
}

Deno.test("chamar: sucesso devolve o result e envia JSON", async () => {
  let url = "";
  let corpo = "";
  const f: FetchFn = (u, init) => {
    url = u;
    corpo = String(init?.body);
    return Promise.resolve(resposta({ ok: true, result: { message_id: 5 } }));
  };
  const r = await criarClienteTelegram(TOKEN, f).chamar("sendMessage", {
    chat_id: 1,
  });
  assertEquals(r, { tipo: "ok", resultado: { message_id: 5 } });
  assertEquals(url, `https://api.telegram.org/bot${TOKEN}/sendMessage`);
  assertEquals(JSON.parse(corpo), { chat_id: 1 });
});

Deno.test("chamar: FormData é enviado como está", async () => {
  let corpo: unknown;
  const f: FetchFn = (_u, init) => {
    corpo = init?.body;
    return Promise.resolve(resposta({ ok: true, result: true }));
  };
  const form = new FormData();
  form.append("chat_id", "1");
  await criarClienteTelegram(TOKEN, f).chamar("sendPhoto", form);
  assert(corpo instanceof FormData);
});

Deno.test("chamar: 429 traz retry_after e description", async () => {
  const f: FetchFn = () =>
    Promise.resolve(resposta({
      ok: false,
      error_code: 429,
      description: "Too Many Requests: retry after 7",
      parameters: { retry_after: 7 },
    }, 429));
  const r = await criarClienteTelegram(TOKEN, f).chamar("x");
  assertEquals(r, {
    tipo: "http",
    status: 429,
    description: "Too Many Requests: retry after 7",
    retryAfter: 7,
  });
});

Deno.test("chamar: corpo que não é JSON vira http com o status", async () => {
  const f: FetchFn = () =>
    Promise.resolve(new Response("<html>", { status: 502 }));
  const r = await criarClienteTelegram(TOKEN, f).chamar("x");
  assertEquals(r, { tipo: "http", status: 502, description: "" });
});

Deno.test("chamar: erro de rede não vaza a URL nem o token", async () => {
  const f: FetchFn = (u) => Promise.reject(new TypeError(`falhou ${u}`));
  const r = await criarClienteTelegram(TOKEN, f).chamar("x");
  assertEquals(r, { tipo: "rede", motivo: "falha" });
  assertFalse(JSON.stringify(r).includes(TOKEN));
});

Deno.test("chamar: timeout vira rede/timeout", async () => {
  const f: FetchFn = (_u, init) =>
    new Promise((_res, rej) => {
      init?.signal?.addEventListener("abort", () => rej(init.signal!.reason));
    });
  const r = await criarClienteTelegram(TOKEN, f).chamar("x", {}, {
    timeoutMs: 10,
  });
  assertEquals(r, { tipo: "rede", motivo: "timeout" });
});

Deno.test("linkApp e escaparHtml", () => {
  assertEquals(linkApp("bot", "diario"), "https://t.me/bot/diario");
  assertEquals(
    linkApp("bot", "diario", "registro_1"),
    "https://t.me/bot/diario?startapp=registro_1",
  );
  assertEquals(escaparHtml("a & <b> c"), "a &amp; &lt;b&gt; c");
});

function adminRpc(valor: unknown, erro = false) {
  const chamadas: string[] = [];
  return {
    chamadas,
    rpc: (nome: string) => {
      chamadas.push(nome);
      return Promise.resolve(
        erro
          ? { data: null, error: { message: "falhou" } }
          : { data: valor, error: null },
      );
    },
  };
}

Deno.test("segredo: deriva o secret_token em hex de 64 caracteres", async () => {
  const a = await derivarSecretTokenWebhook("segredo");
  const b = await derivarSecretTokenWebhook("segredo");
  const c = await derivarSecretTokenWebhook("outro");
  assertEquals(a, b);
  assert(a !== c);
  assert(/^[0-9a-f]{64}$/.test(a));
});

Deno.test("segredo: cache de 5 min e nova leitura depois", async () => {
  let t = 1_000;
  const adm = adminRpc("s3");
  const seg = criarSegredos(adm, () => t);
  assertEquals(await seg.interno(), "s3");
  t += TTL_CACHE_MS - 1;
  assertEquals(await seg.interno(), "s3");
  assertEquals(adm.chamadas.length, 1);
  t += 2;
  assertEquals(await seg.interno(), "s3");
  assertEquals(adm.chamadas.length, 2);
});

Deno.test("segredo: erro ou ausência não confere e não é guardado", async () => {
  const sem = criarSegredos(adminRpc(null));
  assertEquals(await sem.interno(), null);
  const erro = criarSegredos(adminRpc("x", true));
  assertEquals(await erro.interno(), null);
  const req = new Request("https://f.test/", {
    headers: { "x-segredo-interno": "x" },
  });
  assertFalse(await erro.conferirInterno(req));
  assertFalse(await sem.conferirWebhook("qualquer"));
});

Deno.test("segredo: conferirInterno e conferirWebhook", async () => {
  const seg = criarSegredos(adminRpc("s3"));
  const ok = new Request("https://f.test/", {
    headers: { "x-segredo-interno": "s3" },
  });
  const ruim = new Request("https://f.test/", {
    headers: { "x-segredo-interno": "s4" },
  });
  assert(await seg.conferirInterno(ok));
  assertFalse(await seg.conferirInterno(ruim));
  assertFalse(await seg.conferirInterno(new Request("https://f.test/")));
  const tok = await derivarSecretTokenWebhook("s3");
  assert(await seg.conferirWebhook(tok));
  assertFalse(await seg.conferirWebhook("errado"));
  assertFalse(await seg.conferirWebhook(null));
});
