import { assertEquals } from "jsr:@std/assert@1";
import { validarInitData } from "./init_data.ts";
import { assinarInitData } from "./init_data_fixture.ts";

const TOKEN = "123456:TOKEN-DE-TESTE";
const AGORA = new Date("2026-01-10T12:00:00Z");
const seg = (d: Date) => String(Math.floor(d.getTime() / 1000));
const USER = JSON.stringify({
  id: 4242,
  first_name: "Ana",
  last_name: "Souza",
  username: "ana",
});

function campos(extra: Record<string, string> = {}) {
  return { auth_date: seg(AGORA), query_id: "AAH", user: USER, ...extra };
}

Deno.test("initData válido", async () => {
  const r = await validarInitData(
    await assinarInitData(campos(), TOKEN),
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
    assertEquals(r.authDate.getTime(), AGORA.getTime());
  }
});

Deno.test("signature entra no data_check_string (só hash é excluído)", async () => {
  const ok = await assinarInitData(campos({ signature: "abc_DEF" }), TOKEN);
  assertEquals((await validarInitData(ok, TOKEN, AGORA)).ok, true);
  const p = new URLSearchParams(ok);
  p.set("signature", "outra");
  assertEquals((await validarInitData(p.toString(), TOKEN, AGORA)).ok, false);
});

Deno.test("hash adulterado (campo alterado)", async () => {
  const p = new URLSearchParams(await assinarInitData(campos(), TOKEN));
  p.set("query_id", "OUTRO");
  const r = await validarInitData(p.toString(), TOKEN, AGORA);
  assertEquals(r, { ok: false, motivo: "hash inválido" });
});

Deno.test("hash ausente", async () => {
  const p = new URLSearchParams(await assinarInitData(campos(), TOKEN));
  p.delete("hash");
  const r = await validarInitData(p.toString(), TOKEN, AGORA);
  assertEquals(r, { ok: false, motivo: "hash ausente" });
});

Deno.test("auth_date expirado (25 h)", async () => {
  const antigo = new Date(AGORA.getTime() - 25 * 3600_000);
  const r = await validarInitData(
    await assinarInitData(campos({ auth_date: seg(antigo) }), TOKEN),
    TOKEN,
    AGORA,
  );
  assertEquals(r, { ok: false, motivo: "auth_date expirado" });
});

Deno.test("auth_date dentro de 24 h e até 5 min no futuro passam", async () => {
  for (const ms of [-23 * 3600_000, 4 * 60_000]) {
    const d = new Date(AGORA.getTime() + ms);
    const r = await validarInitData(
      await assinarInitData(campos({ auth_date: seg(d) }), TOKEN),
      TOKEN,
      AGORA,
    );
    assertEquals(r.ok, true);
  }
});

Deno.test("auth_date no futuro (10 min)", async () => {
  const fut = new Date(AGORA.getTime() + 10 * 60_000);
  const r = await validarInitData(
    await assinarInitData(campos({ auth_date: seg(fut) }), TOKEN),
    TOKEN,
    AGORA,
  );
  assertEquals(r, { ok: false, motivo: "auth_date no futuro" });
});

Deno.test("user sem id", async () => {
  const r = await validarInitData(
    await assinarInitData(
      campos({ user: JSON.stringify({ first_name: "Ana" }) }),
      TOKEN,
    ),
    TOKEN,
    AGORA,
  );
  assertEquals(r.ok, false);
});

Deno.test("user ausente e user não-JSON", async () => {
  const { user: _u, ...semUser } = campos();
  assertEquals(
    (await validarInitData(await assinarInitData(semUser, TOKEN), TOKEN, AGORA))
      .ok,
    false,
  );
  assertEquals(
    (await validarInitData(
      await assinarInitData(campos({ user: "{x" }), TOKEN),
      TOKEN,
      AGORA,
    )).ok,
    false,
  );
});

Deno.test("token errado e entradas vazias", async () => {
  const data = await assinarInitData(campos(), TOKEN);
  assertEquals((await validarInitData(data, "999:OUTRO", AGORA)).ok, false);
  assertEquals((await validarInitData("", TOKEN, AGORA)).ok, false);
  assertEquals((await validarInitData(data, "", AGORA)).ok, false);
});
