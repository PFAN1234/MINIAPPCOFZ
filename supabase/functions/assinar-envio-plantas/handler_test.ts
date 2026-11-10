import { assertEquals } from "jsr:@std/assert@1";
import { criarHandler } from "./handler.ts";

const OBRA = "c5d9db2d-37c9-436a-acd1-35f387cd63f2";

function segredos(ok: boolean) {
  return { conferirInterno: () => Promise.resolve(ok) };
}

const admin = {
  storage: {
    from: (_b: string) => ({
      createSignedUploadUrl: (c: string) =>
        Promise.resolve({
          data: { signedUrl: `https://x/${c}?token=t` },
          error: null,
        }),
    }),
  },
};

function pedido(corpo: unknown) {
  return new Request("http://local", {
    method: "POST",
    body: JSON.stringify(corpo),
  });
}

Deno.test("sem segredo interno: 401", async () => {
  const h = criarHandler({ admin, segredos: segredos(false) });
  assertEquals((await h(pedido({ caminhos: [] }))).status, 401);
});

Deno.test("caminho fora do padrão: 400", async () => {
  const h = criarHandler({ admin, segredos: segredos(true) });
  const r = await h(pedido({ caminhos: [`${OBRA}/../x.webp`] }));
  assertEquals(r.status, 400);
});

Deno.test("devolve uma URL por caminho", async () => {
  const h = criarHandler({ admin, segredos: segredos(true) });
  const c = `${OBRA}/R05/terreo/planta.webp`;
  const r = await h(pedido({ caminhos: [c] }));
  assertEquals(r.status, 200);
  assertEquals((await r.json()).urls[c], `https://x/${c}?token=t`);
});
