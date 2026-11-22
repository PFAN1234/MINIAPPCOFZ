import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import type {
  ClienteTelegram,
  ResultadoTelegram,
} from "../_shared/telegram.ts";
import { criarHandler, LOTE_LEITURA } from "./handler.ts";

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

type Linha = { id: number; pasta: string; caminho: string; situacao: string };

/**
 * Banco e R2 falsos: tabela `arquivo` (consulta encadeada com eq, in, like, gt, order e limit),
 * `arquivo_remover` e `apagar` do R2, com o registro das chamadas.
 */
function armazenamentoFalso(
  inicial: Arquivos,
  opts: {
    falharRemover?: string;
    falharListar?: string;
    confirmados?: Arquivos;
  } = {},
) {
  let proximo = 1;
  const linhas: Linha[] = [];
  const semear = (a: Arquivos, situacao: string) => {
    for (const [pasta, cs] of Object.entries(a)) {
      for (const caminho of cs) {
        linhas.push({ id: proximo++, pasta, caminho, situacao });
      }
    }
  };
  semear(inicial, "excluir");
  semear(opts.confirmados ?? {}, "confirmado");
  const chamadas = {
    consultas: [] as number[],
    apagar: [] as string[][],
    remover: [] as number[][],
  };
  const consulta = () => {
    const filtros: ((l: Linha) => boolean)[] = [];
    let limite = Infinity;
    const q = {
      select: () => q,
      eq: (c: keyof Linha, v: unknown) => (filtros.push((l) => l[c] === v), q),
      in: (c: keyof Linha, vs: unknown[]) => (
        filtros.push((l) => vs.includes(l[c])), q
      ),
      like: (c: keyof Linha, padrao: string) => {
        assert(padrao.endsWith("/%") && !padrao.slice(0, -1).includes("%"));
        filtros.push((l) => String(l[c]).startsWith(padrao.slice(0, -1)));
        return q;
      },
      gt: (
        c: keyof Linha,
        v: number,
      ) => (filtros.push((l) => Number(l[c]) > v), q),
      order: () => q,
      limit: (n: number) => (limite = n, q),
      then: (
        ok: (
          r: { data: Linha[] | null; error: { message: string } | null },
        ) => unknown,
      ) => {
        chamadas.consultas.push(1);
        if (opts.falharListar) {
          return Promise.resolve({ data: null, error: { message: "fora" } })
            .then(ok);
        }
        const data = linhas.filter((l) => filtros.every((f) => f(l)))
          .sort((x, y) => x.id - y.id).slice(0, limite);
        return Promise.resolve({ data, error: null }).then(ok);
      },
    };
    return q;
  };
  const r2 = {
    apagar(chaves: string[]) {
      chamadas.apagar.push(chaves);
      if (
        opts.falharRemover &&
        chaves.some((c) => c.startsWith(`${opts.falharRemover}/`))
      ) {
        return Promise.reject(new Error("503"));
      }
      return Promise.resolve();
    },
  };
  const remover = (ids: number[]) => {
    chamadas.remover.push(ids);
    for (const id of ids) {
      const i = linhas.findIndex((l) => l.id === id);
      if (i >= 0) linhas.splice(i, 1);
    }
  };
  /** Caminhos que ainda constam em `arquivo` para a pasta. */
  const restantes = (pasta: string, situacao?: string) =>
    linhas.filter((l) =>
      l.pasta === pasta && (!situacao || l.situacao === situacao)
    )
      .map((l) => l.caminho).sort();
  return { consulta, r2, remover, chamadas, restantes };
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
    removerBoletinsErro?: boolean;
    confirmados?: Arquivos;
  } = {},
) {
  const seed: Arquivos = { ...arquivos };
  {
    const arqs = (opts.boletim ?? BOLETIM_RETORNO).arquivos as string[];
    if (!seed.boletins && arqs.length > 0) seed.boletins = arqs;
  }
  const armaz = armazenamentoFalso(seed, {
    ...opts,
    falharRemover: opts.removerBoletinsErro ? "boletins" : opts.falharRemover,
  });
  const delecoes: { chat_id: unknown; message_id: number }[] = [];
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
    from: (tabela: string) => {
      assertEquals(tabela, "arquivo");
      return armaz.consulta();
    },
    rpc: (nome: string, args: Record<string, unknown> = {}) => {
      rpcs.push({ jwt: null, nome, args });
      if (nome === "arquivo_remover") {
        armaz.remover(args.p_ids as number[]);
        return ok(null);
      }
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
    r2: armaz.r2,
    clienteUsuario,
    telegram,
  });
  const removidosBoletins = () =>
    armaz.chamadas.apagar.map((c) => c.filter((k) => k.startsWith("boletins/")))
      .filter((c) => c.length > 0);
  return { handler, armaz, rpcs, delecoes, removidosBoletins };
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
    documentos: [
      `${OBRA_ID}/${"1".repeat(8)}-serie/${"c".repeat(64)}.pdf`,
      `${OUTRA_OBRA}/${"2".repeat(8)}-serie/${"d".repeat(64)}.pdf`,
    ],
    issues: [],
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
    arquivos_removidos: {
      fotos: 250,
      plantas: 5,
      originais: 1,
      modelos: 0,
      documentos: 1,
      issues: 0,
    },
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
      p_removidos: {
        fotos: 250,
        plantas: 5,
        originais: 1,
        modelos: 0,
        documentos: 1,
        issues: 0,
      },
      p_erro: null,
    },
  });

  // Só as chaves `<pasta>/<obra_id>/...`, e arquivo_remover com os ids apagados.
  const apagadas = m.armaz.chamadas.apagar.flat();
  assertEquals(apagadas.length, 257);
  assert(
    apagadas.every((k) =>
      /^(fotos|plantas|originais|modelos|documentos|issues)\//.test(k) &&
      k.split("/")[1] === OBRA_ID
    ),
  );
  assertEquals(m.armaz.chamadas.remover.flat().length, 257);
  assertEquals(m.armaz.restantes("fotos"), [`${OUTRA_OBRA}/reg-1/f.jpg`]);
  assertEquals(m.armaz.restantes("plantas"), [
    `${OUTRA_OBRA}/R01/terreo/planta.webp`,
  ]);
  assertEquals(m.armaz.restantes("originais"), []);
});

Deno.test("excluir: só as linhas excluir da obra são apagadas no R2; confirmadas ficam", async () => {
  const m = montar(
    { fotos: [`${OBRA_ID}/reg-1/a.jpg`] },
    { confirmados: { fotos: [`${OBRA_ID}/reg-1/b.jpg`] } },
  );
  const r = await m.handler(pedir(EXCLUIR));
  assertEquals((await r.json()).pendente, false);
  assertEquals(m.armaz.chamadas.apagar, [[`fotos/${OBRA_ID}/reg-1/a.jpg`]]);
  assertEquals(m.armaz.chamadas.remover, [[1]]);
  assertEquals(m.armaz.restantes("fotos"), [`${OBRA_ID}/reg-1/b.jpg`]);
});

Deno.test("excluir: lê e apaga em páginas de até 1.000 chaves", async () => {
  const fotos: string[] = [];
  for (let i = 0; i < 2300; i++) fotos.push(`${OBRA_ID}/reg-1/f${i}.jpg`);
  const m = montar({ fotos });
  const corpo = await (await m.handler(pedir(EXCLUIR))).json();
  assertEquals(corpo.arquivos_removidos.fotos, 2300);
  assertEquals(
    m.armaz.chamadas.apagar.map((c) => c.length),
    [LOTE_LEITURA, LOTE_LEITURA, 300],
  );
  assertEquals(m.armaz.restantes("fotos"), []);
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
  assertEquals(m.armaz.chamadas.consultas.length, 0);
  assertEquals(m.armaz.chamadas.apagar.length, 0);
  assertEquals(m.rpcs.map((x) => x.nome), ["admin_excluir_obra"]);
});

Deno.test("excluir: quem não é admin recebe 403 e nada é removido", async () => {
  const m = montar(arquivosDaObra());
  const r = await m.handler(pedir(EXCLUIR, { jwt: JWT_COMUM }));
  assertEquals(r.status, 403);
  assertEquals(await r.json(), { erro: "Acesso negado" });
  assertEquals(m.armaz.chamadas.apagar.length, 0);
  assertEquals(m.rpcs.map((x) => x.nome), ["admin_excluir_obra"]);
});

Deno.test("sem JWT ou com JWT inválido: 401 sem chamar o banco", async () => {
  for (const jwt of [null, "jwt-falso"]) {
    const m = montar(arquivosDaObra());
    const r = await m.handler(pedir(EXCLUIR, { jwt }));
    assertEquals(r.status, 401);
    assertEquals(await r.json(), { erro: "Não autorizado" });
    assertEquals(m.rpcs, []);
    assertEquals(m.armaz.chamadas.consultas.length, 0);
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

Deno.test("excluir: falha no R2 depois do banco dá 200 pendente e registra o erro", async () => {
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
    documentos: 1,
    issues: 0,
  });
  const registro = m.rpcs.at(-1)!;
  assertEquals(registro.nome, "admin_registrar_limpeza");
  assertEquals(registro.args.p_removidos, corpo.arquivos_removidos);
  assertEquals(registro.args.p_erro, corpo.erro);
  assertEquals(m.armaz.restantes("plantas").length, 6);
  // A linha que falhou segue `excluir` para a manutenção; arquivo_remover só levou as apagadas.
  assertEquals(m.armaz.restantes("plantas", "excluir").length, 6);
});

Deno.test("excluir: falha ao ler arquivo também deixa pendente", async () => {
  const m = montar(arquivosDaObra(), { falharListar: "fotos" });
  const corpo = await (await m.handler(pedir(EXCLUIR))).json();
  assertEquals(corpo.pendente, true);
  assertMatch(corpo.erro, /leitura \(fora\)/);
  assertEquals(m.armaz.chamadas.apagar.length, 0);
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
  assertEquals(m.armaz.chamadas.apagar.length, 0);
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
    arquivos_removidos: {
      fotos: 1,
      plantas: 5,
      originais: 1,
      modelos: 0,
      documentos: 1,
      issues: 0,
    },
    pendente: false,
  });
  assertEquals(m.rpcs.map((x) => [x.jwt, x.nome]), [
    [JWT_ADMIN, "sou_admin"],
    [null, "admin_exclusao_para_limpar"],
    ...m.armaz.chamadas.remover.map(() => [null, "arquivo_remover"]),
    [null, "admin_registrar_limpeza"],
  ]);
  assertEquals(m.armaz.restantes("fotos"), [`${OUTRA_OBRA}/reg-1/f.jpg`]);
});

Deno.test("limpar: não admin 403, exclusão inexistente 404, id inválido 400", async () => {
  let m = montar(arquivosDaObra());
  let r = await m.handler(
    pedir({ acao: "limpar", exclusao_id: EXCLUSAO }, { jwt: JWT_COMUM }),
  );
  assertEquals(r.status, 403);
  assertEquals(m.armaz.chamadas.consultas.length, 0);

  m = montar(arquivosDaObra());
  r = await m.handler(
    pedir({ acao: "limpar", exclusao_id: OUTRA_OBRA }),
  );
  assertEquals(r.status, 404);
  assertEquals(m.armaz.chamadas.consultas.length, 0);

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
        removidos: {
          fotos: 250,
          plantas: 5,
          originais: 1,
          modelos: 0,
          documentos: 1,
          issues: 0,
        },
        pendente: false,
        erro: null,
      },
      {
        exclusao_id: EXCLUSAO_2,
        removidos: {
          fotos: 1,
          plantas: 1,
          originais: 0,
          modelos: 0,
          documentos: 1,
          issues: 0,
        },
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
  assertEquals(m.armaz.restantes("fotos"), []);
  assertEquals(m.armaz.restantes("plantas"), []);
});

Deno.test("excluir_etapa: etapa sem obras não toca no R2", async () => {
  const m = montar(arquivosDaObra());
  const r = await m.handler(pedir({ ...EXCLUIR_ETAPA, slug: "vazia" }));
  assertEquals(r.status, 200);
  assertEquals(await r.json(), { exclusoes: [], pendente: false, erro: null });
  assertEquals(m.armaz.chamadas.consultas.length, 0);
  assertEquals(m.armaz.chamadas.apagar.length, 0);
});

Deno.test("excluir_etapa: falha no R2 de uma obra deixa pendente sem parar as outras", async () => {
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
  assertEquals(m.armaz.restantes("fotos"), []);
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
  assertEquals(m.armaz.chamadas.apagar.length, 0);
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
  const { handler, delecoes, removidosBoletins, rpcs, armaz } = montar();
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
  assertEquals(removidosBoletins(), [
    ["boletins/e/n.pdf", "boletins/e/n-clima.png"],
  ]);
  assertEquals(armaz.chamadas.remover.length, 1);
  assertEquals(rpcs.find((x) => x.nome === "admin_excluir_boletim"), {
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

Deno.test("excluir_boletim: erro ao remover arquivos vira arquivos_erro; sem arquivos não chama o R2", async () => {
  const falho = montar({}, { removerBoletinsErro: true });
  const r1 = await (await falho.handler(pedir(EXCLUIR_BOLETIM))).json();
  assertEquals(r1.ok, true);
  assertMatch(r1.arquivos_erro, /boletins/);

  const vazio = montar({}, {
    boletim: { ...BOLETIM_RETORNO, arquivos: [], mensagens: [] },
  });
  const r2 = await (await vazio.handler(pedir(EXCLUIR_BOLETIM))).json();
  assertEquals(r2.mensagens, { apagadas: 0, falhas: 0 });
  assertEquals("arquivos_erro" in r2, false);
  assertEquals(vazio.removidosBoletins(), []);
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
