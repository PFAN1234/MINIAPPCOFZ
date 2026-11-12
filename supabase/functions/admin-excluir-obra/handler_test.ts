import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import {
  type BucketStorage,
  criarHandler,
  type ItemStorage,
  LOTE_REMOCAO,
} from "./handler.ts";

const ORIGEM = "https://miniappcofz.vercel.app";
const JWT_ADMIN = "jwt-do-admin";
const JWT_COMUM = "jwt-de-usuario-comum";
const OBRA_ID = "11111111-2222-4333-8444-555555555555";
const OUTRA_OBRA = "99999999-2222-4333-8444-555555555555";
const EXCLUSAO = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const NOME = "HTO Torre";
const RESUMO = { registros: 3, arquivos: { fotos: 2 } };

type Arquivos = Record<string, string[]>;

/** Storage falso: caminhos por bucket; `list` devolve os filhos diretos (pastas com id null). */
function storageFalso(
  inicial: Arquivos,
  opts: { falharRemover?: string; falharListar?: string } = {},
) {
  const buckets = new Map<string, Set<string>>(
    Object.entries(inicial).map(([b, cs]) => [b, new Set(cs)]),
  );
  const chamadas = {
    list: [] as { bucket: string; prefixo: string; offset: number }[],
    remove: [] as { bucket: string; caminhos: string[] }[],
  };
  const from = (bucket: string): BucketStorage => ({
    list(prefixo, { limit, offset }) {
      chamadas.list.push({ bucket, prefixo, offset });
      if (opts.falharListar === bucket) {
        return Promise.resolve({ data: null, error: { message: "fora" } });
      }
      const filhos = new Map<string, ItemStorage>();
      for (const c of buckets.get(bucket) ?? []) {
        if (!c.startsWith(`${prefixo}/`)) continue;
        const resto = c.slice(prefixo.length + 1);
        const [primeiro] = resto.split("/");
        const pasta = resto.includes("/");
        filhos.set(primeiro, {
          name: primeiro,
          id: pasta ? null : `id-${primeiro}`,
        });
      }
      const itens = [...filhos.values()].sort((a, b) =>
        a.name.localeCompare(b.name)
      ).slice(offset, offset + limit);
      return Promise.resolve({ data: itens, error: null });
    },
    remove(caminhos) {
      chamadas.remove.push({ bucket, caminhos });
      if (opts.falharRemover === bucket) {
        return Promise.resolve({ data: null, error: { message: "503" } });
      }
      const s = buckets.get(bucket) ?? new Set();
      const removidos = caminhos.filter((c) => s.delete(c)).map((name) => ({
        name,
      }));
      return Promise.resolve({ data: removidos, error: null });
    },
  });
  const restantes = (bucket: string) => [...(buckets.get(bucket) ?? [])].sort();
  return { from, chamadas, restantes };
}

type Rpc = { jwt: string | null; nome: string; args: Record<string, unknown> };

function montar(
  arquivos: Arquivos = {},
  opts: {
    falharRemover?: string;
    falharListar?: string;
    registrarErro?: boolean;
    rpcInesperada?: boolean;
  } = {},
) {
  const storage = storageFalso(arquivos, opts);
  const rpcs: Rpc[] = [];
  const ok = (data: unknown) => Promise.resolve({ data, error: null });
  const erro = (message: string, code?: string) =>
    Promise.resolve({ data: null, error: { message, code } });

  const admin = {
    auth: {
      getUser: (jwt: string) =>
        Promise.resolve(
          jwt === JWT_ADMIN || jwt === JWT_COMUM
            ? { data: { user: { id: `uid-${jwt}` } }, error: null }
            : { data: { user: null }, error: { message: "jwt inválido" } },
        ),
    },
    storage: { from: storage.from },
    rpc: (nome: string, args: Record<string, unknown> = {}) => {
      rpcs.push({ jwt: null, nome, args });
      if (nome === "admin_registrar_limpeza") {
        return opts.registrarErro ? erro("banco fora") : ok(null);
      }
      if (nome === "admin_exclusao_para_limpar") {
        return args.p_id === EXCLUSAO
          ? ok(OBRA_ID)
          : erro("Exclusão não encontrada", "P0002");
      }
      return erro("rpc?");
    },
  };

  const clienteUsuario = (jwt: string) => ({
    rpc: (nome: string, args: Record<string, unknown> = {}) => {
      rpcs.push({ jwt, nome, args });
      if (nome === "sou_admin") return ok(jwt === JWT_ADMIN);
      if (nome === "admin_excluir_obra") {
        if (opts.rpcInesperada) {
          return erro('relation "x" does not exist', "42P01");
        }
        if (jwt !== JWT_ADMIN) return erro("Apenas admins", "42501");
        if (args.p_slug !== "hto") return erro("Obra não encontrada", "P0002");
        if ((args.p_confirmacao as string).trim() !== NOME) {
          return erro(
            `Para excluir, digite exatamente o nome da obra: ${NOME}`,
            "22023",
          );
        }
        return ok({ exclusao_id: EXCLUSAO, obra_id: OBRA_ID, resumo: RESUMO });
      }
      return erro("rpc?");
    },
  });

  const handler = criarHandler({
    origensPermitidas: [ORIGEM],
    admin,
    clienteUsuario,
  });
  return { handler, storage, rpcs };
}

function pedir(
  corpo: unknown,
  opts: { jwt?: string | null; metodo?: string; origem?: string } = {},
) {
  const jwt = opts.jwt === undefined ? JWT_ADMIN : opts.jwt;
  return new Request("https://f.test/admin-excluir-obra", {
    method: opts.metodo ?? "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: opts.origem ?? ORIGEM,
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
    },
    body: opts.metodo === "GET"
      ? undefined
      : typeof corpo === "string"
      ? corpo
      : JSON.stringify(corpo),
  });
}

const EXCLUIR = { acao: "excluir", slug: "hto", confirmacao: ` ${NOME} ` };

/** Obra com fotos em várias pastas (uma com mais de uma página), plantas aninhadas etc. */
function arquivosDaObra(): Arquivos {
  const fotos: string[] = [];
  for (let i = 0; i < 150; i++) {
    fotos.push(`${OBRA_ID}/reg-1/f${String(i).padStart(3, "0")}.jpg`);
  }
  for (let r = 2; r <= 101; r++) fotos.push(`${OBRA_ID}/reg-${r}/f.jpg`);
  fotos.push(`${OUTRA_OBRA}/reg-1/f.jpg`);
  return {
    fotos,
    plantas: [
      `${OBRA_ID}/R01/terreo/planta.webp`,
      `${OBRA_ID}/R01/terreo/planta-hd.webp`,
      `${OBRA_ID}/R01/terreo/ambientes/a.webp`,
      `${OBRA_ID}/R01/terreo/ambientes/b.webp`,
      `${OBRA_ID}/R02/subsolo/planta.webp`,
      `${OUTRA_OBRA}/R01/terreo/planta.webp`,
    ],
    originais: [`${OBRA_ID}/R01/terreo/${"a".repeat(64)}.pdf`],
    modelos: [],
  };
}

Deno.test("excluir: apaga no banco como o admin, remove tudo em lotes e registra", async () => {
  const m = montar(arquivosDaObra());
  const r = await m.handler(pedir(EXCLUIR));
  assertEquals(r.status, 200);
  assertEquals(r.headers.get("Access-Control-Allow-Origin"), ORIGEM);
  const corpo = await r.json();
  assertEquals(corpo, {
    ok: true,
    exclusao_id: EXCLUSAO,
    obra_id: OBRA_ID,
    resumo: RESUMO,
    arquivos_removidos: { fotos: 250, plantas: 5, originais: 1, modelos: 0 },
    pendente: false,
  });

  // A RPC de exclusão vai com o JWT do usuário; a limpeza, com a service role.
  assertEquals(m.rpcs[0], {
    jwt: JWT_ADMIN,
    nome: "admin_excluir_obra",
    args: { p_slug: "hto", p_confirmacao: ` ${NOME} ` },
  });
  assertEquals(m.rpcs.at(-1), {
    jwt: null,
    nome: "admin_registrar_limpeza",
    args: {
      p_id: EXCLUSAO,
      p_removidos: { fotos: 250, plantas: 5, originais: 1, modelos: 0 },
      p_erro: null,
    },
  });

  // Lotes de até 100 e a outra obra intacta.
  const lotes = m.storage.chamadas.remove.filter((c) => c.bucket === "fotos")
    .map((c) => c.caminhos.length);
  assertEquals(lotes, [100, 100, 50]);
  assert(
    m.storage.chamadas.remove.every((c) => c.caminhos.length <= LOTE_REMOCAO),
  );
  assert(
    m.storage.chamadas.remove.every((c) =>
      c.caminhos.every((p) => p.startsWith(`${OBRA_ID}/`))
    ),
  );
  assertEquals(m.storage.restantes("fotos"), [`${OUTRA_OBRA}/reg-1/f.jpg`]);
  assertEquals(m.storage.restantes("plantas"), [
    `${OUTRA_OBRA}/R01/terreo/planta.webp`,
  ]);
  assertEquals(m.storage.restantes("originais"), []);

  // Listagem paginada (reg-1 tem 150 arquivos; a raiz da obra tem 101 pastas).
  const offsets = (prefixo: string) =>
    m.storage.chamadas.list.filter((c) =>
      c.bucket === "fotos" && c.prefixo === prefixo
    ).map((c) => c.offset);
  assertEquals(offsets(`${OBRA_ID}/reg-1`), [0, 100]);
  assertEquals(offsets(OBRA_ID), [0, 100]);
  // Nunca lista a raiz do bucket nem outra obra.
  assert(m.storage.chamadas.list.every((c) => c.prefixo.startsWith(OBRA_ID)));
});

Deno.test("excluir: confirmação que não confere dá 400 e nada é removido", async () => {
  const m = montar(arquivosDaObra());
  const r = await m.handler(
    pedir({ ...EXCLUIR, confirmacao: NOME.toLowerCase() }),
  );
  assertEquals(r.status, 400);
  assertEquals(await r.json(), {
    erro: `Para excluir, digite exatamente o nome da obra: ${NOME}`,
  });
  assertEquals(m.storage.chamadas.list.length, 0);
  assertEquals(m.storage.chamadas.remove.length, 0);
  assertEquals(m.rpcs.map((x) => x.nome), ["admin_excluir_obra"]);
});

Deno.test("excluir: quem não é admin recebe 403 e nada é removido", async () => {
  const m = montar(arquivosDaObra());
  const r = await m.handler(pedir(EXCLUIR, { jwt: JWT_COMUM }));
  assertEquals(r.status, 403);
  assertEquals(await r.json(), { erro: "Acesso negado" });
  assertEquals(m.storage.chamadas.remove.length, 0);
  assertEquals(m.rpcs.map((x) => x.nome), ["admin_excluir_obra"]);
});

Deno.test("sem JWT ou com JWT inválido: 401 sem chamar o banco", async () => {
  for (const jwt of [null, "jwt-falso"]) {
    const m = montar(arquivosDaObra());
    const r = await m.handler(pedir(EXCLUIR, { jwt }));
    assertEquals(r.status, 401);
    assertEquals(await r.json(), { erro: "Não autorizado" });
    assertEquals(m.rpcs, []);
    assertEquals(m.storage.chamadas.list.length, 0);
  }
  const m = montar();
  const r = await m.handler(
    new Request("https://f.test/x", {
      method: "POST",
      headers: { Authorization: "Basic abc" },
      body: JSON.stringify(EXCLUIR),
    }),
  );
  assertEquals(r.status, 401);
});

Deno.test("excluir: obra inexistente dá 404", async () => {
  const m = montar();
  const r = await m.handler(pedir({ ...EXCLUIR, slug: "nao-existe" }));
  assertEquals(r.status, 404);
  assertEquals(await r.json(), { erro: "Obra não encontrada" });
});

Deno.test("excluir: falha no Storage depois do banco dá 200 pendente e registra o erro", async () => {
  const m = montar(arquivosDaObra(), { falharRemover: "plantas" });
  const r = await m.handler(pedir(EXCLUIR));
  assertEquals(r.status, 200);
  const corpo = await r.json();
  assertEquals(corpo.ok, true);
  assertEquals(corpo.pendente, true);
  assertEquals(corpo.exclusao_id, EXCLUSAO);
  assertMatch(corpo.erro, /plantas/);
  // Os outros buckets foram limpos mesmo assim.
  assertEquals(corpo.arquivos_removidos, {
    fotos: 250,
    plantas: 0,
    originais: 1,
    modelos: 0,
  });
  const registro = m.rpcs.at(-1)!;
  assertEquals(registro.nome, "admin_registrar_limpeza");
  assertEquals(registro.args.p_removidos, corpo.arquivos_removidos);
  assertEquals(registro.args.p_erro, corpo.erro);
  assertEquals(m.storage.restantes("plantas").length, 6);
});

Deno.test("excluir: falha na listagem também deixa pendente", async () => {
  const m = montar(arquivosDaObra(), { falharListar: "fotos" });
  const corpo = await (await m.handler(pedir(EXCLUIR))).json();
  assertEquals(corpo.pendente, true);
  assertMatch(corpo.erro, /fotos \(fora\)/);
  assertEquals(corpo.arquivos_removidos.plantas, 5);
});

Deno.test("excluir: falha ao registrar a limpeza deixa pendente", async () => {
  const m = montar(arquivosDaObra(), { registrarErro: true });
  const corpo = await (await m.handler(pedir(EXCLUIR))).json();
  assertEquals(corpo.pendente, true);
  assertMatch(corpo.erro, /não foi possível registrar/);
  assertEquals(corpo.arquivos_removidos.fotos, 250);
});

Deno.test("excluir: erro inesperado do banco dá 500 sem detalhes", async () => {
  const m = montar(arquivosDaObra(), { rpcInesperada: true });
  const r = await m.handler(pedir(EXCLUIR));
  assertEquals(r.status, 500);
  assertEquals(await r.json(), { erro: "Erro interno" });
  assertEquals(m.storage.chamadas.remove.length, 0);
});

Deno.test("limpar: confere o admin, pega o obra_id pela service role e remove o que sobrou", async () => {
  const arquivos = arquivosDaObra();
  arquivos.fotos = [`${OBRA_ID}/reg-1/f.jpg`, `${OUTRA_OBRA}/reg-1/f.jpg`];
  const m = montar(arquivos);
  const r = await m.handler(pedir({ acao: "limpar", exclusao_id: EXCLUSAO }));
  assertEquals(r.status, 200);
  assertEquals(await r.json(), {
    ok: true,
    exclusao_id: EXCLUSAO,
    obra_id: OBRA_ID,
    arquivos_removidos: { fotos: 1, plantas: 5, originais: 1, modelos: 0 },
    pendente: false,
  });
  assertEquals(m.rpcs.map((x) => [x.jwt, x.nome]), [
    [JWT_ADMIN, "sou_admin"],
    [null, "admin_exclusao_para_limpar"],
    [null, "admin_registrar_limpeza"],
  ]);
  assertEquals(m.storage.restantes("fotos"), [`${OUTRA_OBRA}/reg-1/f.jpg`]);
});

Deno.test("limpar: não admin 403, exclusão inexistente 404, id inválido 400", async () => {
  let m = montar(arquivosDaObra());
  let r = await m.handler(
    pedir({ acao: "limpar", exclusao_id: EXCLUSAO }, { jwt: JWT_COMUM }),
  );
  assertEquals(r.status, 403);
  assertEquals(m.storage.chamadas.list.length, 0);

  m = montar(arquivosDaObra());
  r = await m.handler(
    pedir({ acao: "limpar", exclusao_id: OUTRA_OBRA }),
  );
  assertEquals(r.status, 404);
  assertEquals(m.storage.chamadas.list.length, 0);

  for (const exclusao_id of [undefined, "", "abc", 1]) {
    m = montar(arquivosDaObra());
    r = await m.handler(pedir({ acao: "limpar", exclusao_id }));
    assertEquals(r.status, 400);
    assertEquals(m.rpcs, []);
  }
});

Deno.test("método e corpo inválidos", async () => {
  const m = montar();
  let r = await m.handler(pedir(null, { metodo: "GET" }));
  assertEquals(r.status, 405);
  assertEquals(r.headers.get("Allow"), "POST, OPTIONS");

  for (
    const corpo of [
      "não é json",
      "[]",
      "null",
      { acao: "outra" },
      { slug: "hto" },
      { acao: "excluir", slug: "hto" },
      { acao: "excluir", confirmacao: NOME },
      { acao: "excluir", slug: "", confirmacao: NOME },
      { acao: "excluir", slug: "hto", confirmacao: 1 },
    ]
  ) {
    r = await m.handler(pedir(corpo));
    assertEquals(r.status, 400, JSON.stringify(corpo));
    assertEquals(await r.json(), { erro: "Corpo inválido" });
  }
  assertEquals(m.rpcs, []);
});

Deno.test("CORS: preflight e respostas só ecoam origem permitida", async () => {
  const m = montar();
  let r = await m.handler(pedir(null, { metodo: "OPTIONS" }));
  assertEquals(r.status, 204);
  assertEquals(r.headers.get("Access-Control-Allow-Origin"), ORIGEM);
  assertMatch(r.headers.get("Access-Control-Allow-Headers")!, /authorization/);
  assertEquals(r.headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS");

  r = await m.handler(
    pedir(null, { metodo: "OPTIONS", origem: "https://intruso.example" }),
  );
  assertEquals(r.status, 204);
  assertEquals(r.headers.get("Access-Control-Allow-Origin"), null);

  r = await m.handler(pedir(EXCLUIR, { origem: "https://intruso.example" }));
  assertEquals(r.headers.get("Access-Control-Allow-Origin"), null);
  assertEquals(r.headers.get("Vary"), "Origin");
});
