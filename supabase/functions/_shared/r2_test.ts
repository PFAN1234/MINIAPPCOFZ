import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "jsr:@std/assert@1";
import { chaveObjeto, configDoAmbiente, criarR2 } from "./r2.ts";

const CONFIG = {
  contaId: "conta123",
  chaveId: "AKIDEXAMPLE",
  segredo: "segredo-de-teste",
  bucket: "bucket-dev",
};

Deno.test("urlAssinada GET: endpoint, região auto, serviço s3 e validade", async () => {
  const r2 = criarR2(CONFIG);
  const u = new URL(await r2.urlAssinada("GET", "fotos/a b/x.jpg", 3600));
  assertEquals(u.host, "conta123.r2.cloudflarestorage.com");
  assertEquals(u.pathname, "/bucket-dev/fotos/a%20b/x.jpg");
  const p = u.searchParams;
  assertEquals(p.get("X-Amz-Algorithm"), "AWS4-HMAC-SHA256");
  assertEquals(p.get("X-Amz-Expires"), "3600");
  assertEquals(p.get("X-Amz-SignedHeaders"), "host");
  assert(
    /^AKIDEXAMPLE\/\d{8}\/auto\/s3\/aws4_request$/.test(
      p.get("X-Amz-Credential")!,
    ),
  );
  assert(/^[0-9a-f]{64}$/.test(p.get("X-Amz-Signature")!));
});

Deno.test("urlAssinada PUT: assina content-length e content-type", async () => {
  const r2 = criarR2(CONFIG);
  const u = new URL(
    await r2.urlAssinada("PUT", "fotos/x.jpg", 600, {
      "Content-Type": "image/jpeg",
      "Content-Length": "1234",
    }),
  );
  assertEquals(
    u.searchParams.get("X-Amz-SignedHeaders"),
    "content-length;content-type;host",
  );
  assertEquals(u.searchParams.get("X-Amz-Expires"), "600");
});

Deno.test("urlAssinada muda com o segredo", async () => {
  const a = await criarR2(CONFIG).urlAssinada("GET", "fotos/x.jpg", 60);
  const b = await criarR2({ ...CONFIG, segredo: "outro" }).urlAssinada(
    "GET",
    "fotos/x.jpg",
    60,
  );
  const sig = (s: string) => new URL(s).searchParams.get("X-Amz-Signature");
  assert(sig(a) !== sig(b));
});

Deno.test("cabecalho: HEAD devolve tamanho e tipo; 404 vira null", async () => {
  const chamadas: string[] = [];
  const r2 = criarR2(CONFIG, (e) => {
    const req = e as Request;
    chamadas.push(`${req.method} ${req.url}`);
    return Promise.resolve(
      req.url.includes("existe")
        ? new Response(null, {
          status: 200,
          headers: { "content-length": "42", "content-type": "image/jpeg" },
        })
        : new Response(null, { status: 404 }),
    );
  });
  assertEquals(await r2.cabecalho("fotos/existe.jpg"), {
    tamanho: 42,
    tipo: "image/jpeg",
  });
  assertEquals(await r2.cabecalho("fotos/falta.jpg"), null);
  assert(chamadas[0].startsWith("HEAD https://conta123.r2."));
});

Deno.test("apagar: lotes de 1.000 e NoSuchKey não é erro", async () => {
  const tamanhos: number[] = [];
  const r2 = criarR2(CONFIG, async (e) => {
    const req = e as Request;
    const corpo = await req.text();
    tamanhos.push((corpo.match(/<Object>/g) ?? []).length);
    return new Response(
      "<DeleteResult><Error><Key>a</Key><Code>NoSuchKey</Code></Error></DeleteResult>",
      { status: 200 },
    );
  });
  await r2.apagar(Array.from({ length: 2300 }, (_, i) => `fotos/${i}.jpg`));
  assertEquals(tamanhos, [1000, 1000, 300]);
});

Deno.test("apagar: erro de outro tipo lança", async () => {
  const r2 = criarR2(
    CONFIG,
    () =>
      Promise.resolve(
        new Response(
          "<DeleteResult><Error><Key>a</Key><Code>AccessDenied</Code></Error></DeleteResult>",
          { status: 200 },
        ),
      ),
  );
  await assertRejects(() => r2.apagar(["fotos/a.jpg"]));
});

Deno.test("listar: lê chaves, tamanhos e token de continuação", async () => {
  const r2 = criarR2(CONFIG, (e) => {
    const u = new URL((e as Request).url);
    assertEquals(u.searchParams.get("list-type"), "2");
    assertEquals(u.searchParams.get("prefix"), "fotos/");
    return Promise.resolve(
      new Response(
        "<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>tok&amp;1</NextContinuationToken>" +
          "<Contents><Key>fotos/a&amp;b.jpg</Key><Size>10</Size></Contents>" +
          "<Contents><Key>fotos/c.jpg</Key><Size>20</Size></Contents></ListBucketResult>",
        { status: 200 },
      ),
    );
  });
  assertEquals(await r2.listar("fotos/"), {
    objetos: [
      { chave: "fotos/a&b.jpg", tamanho: 10 },
      { chave: "fotos/c.jpg", tamanho: 20 },
    ],
    proxima: "tok&1",
  });
});

Deno.test("chaveObjeto rejeita pasta fora das 8 e caminho inseguro", () => {
  assertEquals(chaveObjeto("fotos", "a/b.jpg"), "fotos/a/b.jpg");
  assertThrows(() => chaveObjeto("outra", "a.jpg"));
  assertThrows(() => chaveObjeto("fotos", "/a.jpg"));
  assertThrows(() => chaveObjeto("fotos", "a/../b.jpg"));
  assertThrows(() => chaveObjeto("fotos", ""));
});

Deno.test("configDoAmbiente lê as quatro variáveis e lança se faltar", () => {
  const env: Record<string, string> = {
    R2_ACCOUNT_ID: "c",
    R2_ACCESS_KEY_ID: "k",
    R2_SECRET_ACCESS_KEY: "s",
    R2_BUCKET: "b",
  };
  assertEquals(configDoAmbiente((n) => env[n]), {
    contaId: "c",
    chaveId: "k",
    segredo: "s",
    bucket: "b",
  });
  assertThrows(() => configDoAmbiente(() => undefined));
});
