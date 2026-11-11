import { assertEquals } from "jsr:@std/assert@1";
import {
  calcularHashWidget,
  montarDataCheckStringWidget,
  validarLoginWidget,
} from "./widget.ts";
import { assinarWidget as assinarComToken } from "./widget_fixture.ts";

const TOKEN = "123456:TOKEN-DE-TESTE";
const AGORA = new Date("2026-11-11T12:00:00Z");
const seg = (d: Date) => Math.floor(d.getTime() / 1000);

/** Dados como o widget entrega ao `data-onauth`, assinados com o token. */
function assinarWidget(campos: Record<string, string | number>) {
  return assinarComToken(campos, TOKEN);
}

function campos(extra: Record<string, string | number> = {}) {
  return {
    id: 4242,
    first_name: "Ana",
    last_name: "Souza",
    username: "ana",
    photo_url: "https://t.me/i/userpic/320/ana.jpg",
    auth_date: seg(AGORA),
    ...extra,
  };
}

Deno.test("data_check_string em ordem alfabética, sem hash", () => {
  assertEquals(
    montarDataCheckStringWidget({
      username: "ana",
      id: 1,
      auth_date: 9,
      hash: "x",
      first_name: "Ana",
    }),
    "auth_date=9\nfirst_name=Ana\nid=1\nusername=ana",
  );
});

Deno.test("hash conforme o exemplo calculado à parte (SHA-256 do token como chave)", async () => {
  // Valor de referência calculado com HMAC-SHA-256(key=sha256(token), data_check_string).
  const ref = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(TOKEN)),
    ),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const esperado = Array.from(
    new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        ref,
        new TextEncoder().encode("auth_date=9\nfirst_name=Ana\nid=1"),
      ),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  assertEquals(
    await calcularHashWidget({ id: 1, first_name: "Ana", auth_date: 9 }, TOKEN),
    esperado,
  );
});

Deno.test("widget válido", async () => {
  const r = await validarLoginWidget(
    await assinarWidget(campos()),
    TOKEN,
    AGORA,
  );
  assertEquals(r.ok, true);
  if (r.ok) {
    assertEquals(r.usuario, {
      id: 4242,
      first_name: "Ana",
      last_name: "Souza",
      username: "ana",
    });
  }
});

Deno.test("widget só com id, first_name e auth_date", async () => {
  const r = await validarLoginWidget(
    await assinarWidget({ id: 7, first_name: "Bia", auth_date: seg(AGORA) }),
    TOKEN,
    AGORA,
  );
  assertEquals(r.ok && r.usuario, { id: 7, first_name: "Bia" });
});

Deno.test("hash inválido: campo alterado, token errado, hash ausente", async () => {
  const ok = await assinarWidget(campos());
  assertEquals(
    await validarLoginWidget({ ...ok, id: 4243 }, TOKEN, AGORA),
    { ok: false, motivo: "hash inválido" },
  );
  assertEquals(
    (await validarLoginWidget(ok, "999:OUTRO", AGORA)).ok,
    false,
  );
  const { hash: _h, ...semHash } = ok;
  assertEquals(
    await validarLoginWidget(semHash, TOKEN, AGORA),
    { ok: false, motivo: "hash ausente" },
  );
  // O hash do Mini App (com "WebAppData") não serve para o widget.
  assertEquals(
    (await validarLoginWidget({ ...ok, hash: "0".repeat(64) }, TOKEN, AGORA))
      .ok,
    false,
  );
});

Deno.test("auth_date com mais de 24 h ou no futuro", async () => {
  const antigo = new Date(AGORA.getTime() - 25 * 3600_000);
  assertEquals(
    await validarLoginWidget(
      await assinarWidget(campos({ auth_date: seg(antigo) })),
      TOKEN,
      AGORA,
    ),
    { ok: false, motivo: "auth_date expirado" },
  );
  const futuro = new Date(AGORA.getTime() + 10 * 60_000);
  assertEquals(
    await validarLoginWidget(
      await assinarWidget(campos({ auth_date: seg(futuro) })),
      TOKEN,
      AGORA,
    ),
    { ok: false, motivo: "auth_date no futuro" },
  );
  const recente = new Date(AGORA.getTime() - 23 * 3600_000);
  assertEquals(
    (await validarLoginWidget(
      await assinarWidget(campos({ auth_date: seg(recente) })),
      TOKEN,
      AGORA,
    )).ok,
    true,
  );
});

Deno.test("entradas inválidas", async () => {
  assertEquals((await validarLoginWidget(null, TOKEN, AGORA)).ok, false);
  assertEquals((await validarLoginWidget([], TOKEN, AGORA)).ok, false);
  assertEquals(
    (await validarLoginWidget(await assinarWidget(campos()), "", AGORA)).ok,
    false,
  );
  assertEquals(
    (await validarLoginWidget(
      { ...(await assinarWidget(campos())), extra: { a: 1 } },
      TOKEN,
      AGORA,
    )).ok,
    false,
  );
  const semNome = await assinarWidget({ id: 1, auth_date: seg(AGORA) });
  assertEquals(
    await validarLoginWidget(semNome, TOKEN, AGORA),
    { ok: false, motivo: "first_name ausente" },
  );
});
