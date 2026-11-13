import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import type {
  ClienteTelegram,
  ResultadoTelegram,
} from "../_shared/telegram.ts";
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
const EXCLUSAO_2 = "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const NOME = "HTO Torre";
const ETAPA = "2ª ETAPA";
const RESUMO = { registros: 3, arquivos: { fotos: 2 } };

const BOLETIM_ID = "cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const BOLETIM_RETORNO = {
  numero: "CO-FZ/2026-001",
  data: "2026-11-10",
  etapa_id: OBRA_ID,
  revisoes: 2,
  chat_id: -1001234,
  mensagens: [10, 11],
  arquivos: ["e/n.pdf", "e/n-clima.png"],
};

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
    /** Retorno da RPC admin_excluir_boletim (padrão: um boletim com 2 mensagens). */
    boletim?: Record<string, unknown>;
    /** Erro da RPC admin_excluir_boletim: [mensagem, código]. */
    boletimErro?: [string, string];
    /** Resposta do Telegram por message_id (padrão: ok). */
    telegram?: Record<number, ResultadoTelegram>;
    removerBoletinsErro?: string;
  } = {},
) {
  const storage = storageFalso(arquivos, opts);
  const delecoes: { chat_id: unknown; message_id: number }[] = [];
  const removidosBoletins: string[][] = [];
  const telegram: ClienteTelegram = {
    chamar(metodo, corpo) {
      const c = corpo as { chat_id: unknown; message_id: number };
      assertEquals(metodo, "deleteMessage");
      delecoes.push(c);
      const r = opts.telegram?.[c.message_id] ??
        { tipo: "ok" as const, resultado: true };
      return Promise.resolve(r as never);
    },
  };
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
    storage: {
      from: (bucket: string) => {
        if (bucket !== "boletins") return storage.from(bucket);
        return {
          ...storage.from(bucket),
          remove: (caminhos: string[]) => {
            removidosBoletins.push(caminhos);
            return Promise.resolve(
              opts.removerBoletinsErro
                ? { data: null, error: { message: opts.removerBoletinsErro } }
                : { data: caminhos.map((name) => ({ name })), error: null },
            );
          },
        };
      },
    },
    rpc: (nome: string, args: Record<string, unknown> = {}) => {
      rpcs.push({ jwt: null, nome, args });
      if (nome === "admin_registrar_limpeza") {
        return opts.registrarErro ? erro("banco fora") : ok(null);
      }
      if (nome === "admin_exclusao_para_limpar") {
        if (args.p_id === EXCLUSAO) return ok(OBRA_ID);
        if (args.p_id === EXCLUSAO_2) return ok(OUTRA_OBRA);
        return erro("Exclusão não encontrada", "P0002");
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
      if (nome === "admin_excluir_boletim") {
        if (opts.boletimErro) {
          return erro(opts.boletimErro[0], opts.boletimErro[1]);
        }
        return ok(opts.boletim ?? BOLETIM_RETORNO);
      }
      if (nome === "admin_excluir_etapa") {
        if (jwt !== JWT_ADMIN) return erro("Apenas admins", "42501");
        if (args.p_slug === "vazia") {
          return ok({ etapa_id: OBRA_ID, exclusoes: [], resumo: {} });
        }
        if (args.p_slug !== "2a-etapa") {
          return erro("Etapa não encontrada", "P0002");
        }
        if ((args.p_confirmacao as string).trim() !== ETAPA) {
          return erro(
            `Para excluir, digite exatamente o nome da etapa: ${ETAPA}`,
            "22023",
          );
        }
        return ok({
          etapa_id: OBRA_ID,
          exclusoes: [EXCLUSAO, EXCLUSAO_2],
          resumo: RESUMO,
        });
      }
      return erro("rpc?");
    },
  });

  const handler = criarHandler({
    origensPermitidas: [ORIGEM],
    admin,
    clienteUsuario,
    telegram,
  });
  return { handler, storage, rpcs, delecoes, removidosBoletins };
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

const EXCLUIR_ETAPA = {
  acao: "excluir_etapa",
  slug: "2a-etapa",
  confirmacao: ETAPA,
};

Deno.test("excluir_etapa: apaga no banco como o admin e limpa os arquivos de cada obra", async () => {
  const m = montar(arquivosDaObra());
  const r = await m.handler(pedir(EXCLUIR_ETAPA));
  assertEquals(r.status, 200);
  assertEquals(await r.json(), {
    exclusoes: [
      {
        exclusao_id: EXCLUSAO,
        removidos: { fotos: 250, plantas: 5, originais: 1, modelos: 0 },
        pendente: false,
        erro: null,
      },
      {
        exclusao_id: EXCLUSAO_2,
        removidos: { fotos: 1, plantas: 1, originais: 0, modelos: 0 },
        pendente: false,
        erro: null,
      },
    ],
    pendente: false,
    erro: null,
  });
  assertEquals(m.rpcs[0], {
    jwt: JWT_ADMIN,
    nome: "admin_excluir_etapa",
    args: { p_slug: "2a-etapa", p_confirmacao: ETAPA },
  });
  assertEquals(m.storage.restantes("fotos"), []);
  assertEquals(m.storage.restantes("plantas"), []);
});

Deno.test("excluir_etapa: etapa sem obras não toca no Storage", async () => {
  const m = montar(arquivosDaObra());
  const r = await m.handler(pedir({ ...EXCLUIR_ETAPA, slug: "vazia" }));
  assertEquals(r.status, 200);
  assertEquals(await r.json(), { exclusoes: [], pendente: false, erro: null });
  assertEquals(m.storage.chamadas.list.length, 0);
  assertEquals(m.storage.chamadas.remove.length, 0);
});

Deno.test("excluir_etapa: falha no Storage de uma obra deixa pendente sem parar as outras", async () => {
  const m = montar(arquivosDaObra(), { falharRemover: "plantas" });
  const r = await m.handler(pedir(EXCLUIR_ETAPA));
  assertEquals(r.status, 200);
  const corpo = await r.json();
  assertEquals(corpo.pendente, true);
  assertMatch(corpo.erro, /2 obra\(s\)/);
  assertEquals(corpo.exclusoes.map((x: { pendente: boolean }) => x.pendente), [
    true,
    true,
  ]);
  // As fotos das duas obras saíram mesmo com a falha nas plantas.
  assertEquals(m.storage.restantes("fotos"), []);
});

Deno.test("excluir_etapa: confirmação errada 400, não admin 403, inexistente 404, corpo inválido 400", async () => {
  const m = montar(arquivosDaObra());
  let r = await m.handler(pedir({ ...EXCLUIR_ETAPA, confirmacao: "2a etapa" }));
  assertEquals(r.status, 400);
  assertMatch((await r.json()).erro, /nome da etapa/);
  r = await m.handler(pedir(EXCLUIR_ETAPA, { jwt: JWT_COMUM }));
  assertEquals(r.status, 403);
  r = await m.handler(pedir({ ...EXCLUIR_ETAPA, slug: "outra" }));
  assertEquals(r.status, 404);
  r = await m.handler(pedir({ acao: "excluir_etapa", slug: "2a-etapa" }));
  assertEquals(r.status, 400);
  assertEquals(m.storage.chamadas.remove.length, 0);
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

// --- excluir_boletim ---------------------------------------------------------------------------

const EXCLUIR_BOLETIM = { acao: "excluir_boletim", boletim_id: BOLETIM_ID };

Deno.test("excluir_boletim: apaga mensagens e arquivos e responde com o resumo", async () => {
  const { handler, delecoes, removidosBoletins, rpcs } = montar();
  const res = await handler(pedir(EXCLUIR_BOLETIM));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    ok: true,
    numero: "CO-FZ/2026-001",
    data: "2026-11-10",
    revisoes: 2,
    mensagens: { apagadas: 2, falhas: 0 },
  });
  assertEquals(delecoes, [
    { chat_id: -1001234, message_id: 10 },
    { chat_id: -1001234, message_id: 11 },
  ]);
  assertEquals(removidosBoletins, [["e/n.pdf", "e/n-clima.png"]]);
  assertEquals(rpcs[rpcs.length - 1], {
    jwt: JWT_ADMIN,
    nome: "admin_excluir_boletim",
    args: { p_id: BOLETIM_ID },
  });
});

Deno.test("excluir_boletim: 'not found' conta como apagada; outras falhas contam como falha", async () => {
  const { handler } = montar({}, {
    telegram: {
      10: {
        tipo: "http",
        status: 400,
        description: "Bad Request: message to delete not found",
      },
      11: { tipo: "http", status: 403, description: "Forbidden" },
    },
  });
  const res = await handler(pedir(EXCLUIR_BOLETIM));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).mensagens, { apagadas: 1, falhas: 1 });
});

Deno.test("excluir_boletim: falha de rede no Telegram não derruba a resposta", async () => {
  const { handler } = montar({}, {
    telegram: { 10: { tipo: "rede", motivo: "timeout" } },
  });
  const res = await handler(pedir(EXCLUIR_BOLETIM));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).mensagens, { apagadas: 1, falhas: 1 });
});

Deno.test("excluir_boletim: chat nulo conta todas as mensagens como falha sem chamar o Telegram", async () => {
  const { handler, delecoes } = montar({}, {
    boletim: { ...BOLETIM_RETORNO, chat_id: null },
  });
  const res = await handler(pedir(EXCLUIR_BOLETIM));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).mensagens, { apagadas: 0, falhas: 2 });
  assertEquals(delecoes, []);
});

Deno.test("excluir_boletim: erro ao remover arquivos vira arquivos_erro; sem arquivos não chama o Storage", async () => {
  const falho = montar({}, { removerBoletinsErro: "503" });
  const r1 = await (await falho.handler(pedir(EXCLUIR_BOLETIM))).json();
  assertEquals(r1.ok, true);
  assertEquals(r1.arquivos_erro, "503");

  const vazio = montar({}, {
    boletim: { ...BOLETIM_RETORNO, arquivos: [], mensagens: [] },
  });
  const r2 = await (await vazio.handler(pedir(EXCLUIR_BOLETIM))).json();
  assertEquals(r2.mensagens, { apagadas: 0, falhas: 0 });
  assertEquals("arquivos_erro" in r2, false);
  assertEquals(vazio.removidosBoletins, []);
});

Deno.test("excluir_boletim: erros do banco viram 401, 403, 404, 409 e 400", async () => {
  const casos: [string, string, number, string?][] = [
    ["x", "28000", 401],
    ["Apenas admins", "42501", 403],
    ["Boletim não encontrado", "P0002", 404, "Boletim não encontrado."],
    [
      "Há uma emissão ou um envio em andamento para este dia.",
      "55006",
      409,
      "Há uma emissão ou um envio em andamento para este dia.",
    ],
    ["inválido", "22023", 400, "inválido"],
  ];
  for (const [msg, code, status, erro] of casos) {
    const { handler, delecoes } = montar({}, { boletimErro: [msg, code] });
    const res = await handler(pedir(EXCLUIR_BOLETIM));
    assertEquals(res.status, status, code);
    if (erro) assertEquals((await res.json()).erro, erro);
    else await res.body?.cancel();
    assertEquals(delecoes, []);
  }
  const { handler } = montar({}, { boletimErro: ["boom", "XX000"] });
  const res = await handler(pedir(EXCLUIR_BOLETIM));
  assertEquals(res.status, 500);
  await res.body?.cancel();
});

Deno.test("excluir_boletim: boletim_id ausente ou que não é UUID dá 400 sem chamar o banco", async () => {
  for (
    const corpo of [{ acao: "excluir_boletim" }, {
      acao: "excluir_boletim",
      boletim_id: "abc",
    }, { acao: "excluir_boletim", boletim_id: 3 }]
  ) {
    const { handler, rpcs } = montar();
    const res = await handler(pedir(corpo));
    assertEquals(res.status, 400);
    await res.body?.cancel();
    assertEquals(rpcs.filter((r) => r.nome === "admin_excluir_boletim"), []);
  }
});
