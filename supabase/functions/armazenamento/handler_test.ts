import { assert, assertEquals } from "jsr:@std/assert@1";
import { chaveObjeto, criarR2 } from "../_shared/r2.ts";
import {
  criarHandler,
  type Deps,
  type LinhaOrfao,
  VALIDADE_ENVIO,
} from "./handler.ts";

const ORIGEM = "https://miniappcofz.vercel.app";
const JWT = "jwt-do-usuario";
const UID = "11111111-2222-4333-8444-555555555555";
const SEGREDO = "segredo-interno";
const AGORA = Date.UTC(2026, 10, 22, 12, 0, 0);

type Resposta = { data: unknown; error: { message: string } | null };
type Rpcs = Record<string, (args: Record<string, unknown>) => Resposta>;

interface Fake {
  deps: Deps;
  chamadas: { cliente: "usuario" | "servico"; nome: string; args: unknown }[];
  apagados: string[][];
  orfaos: LinhaOrfao[][];
  urls: { metodo: string; chave: string; segundos: number; cab?: unknown }[];
}

function montar(opts: {
  usuario?: Rpcs;
  servico?: Rpcs;
  cabecalho?: { tamanho: number; tipo: string } | null;
  objetos?: { chave: string; tamanho: number }[];
  id?: number | null;
} = {}): Fake {
  const f: Fake = { chamadas: [], apagados: [], orfaos: [], urls: [] } as never;
  const rpc =
    (cliente: "usuario" | "servico", mapa: Rpcs) =>
    (nome: string, args: Record<string, unknown> = {}) => {
      f.chamadas.push({ cliente, nome, args });
      const fn = mapa[nome];
      return Promise.resolve(
        fn ? fn(args) : { data: null, error: { message: `sem dublê ${nome}` } },
      );
    };
  f.deps = {
    origensPermitidas: [ORIGEM],
    admin: {
      rpc: rpc("servico", opts.servico ?? {}),
      auth: {
        getUser: (jwt: string) =>
          Promise.resolve(
            jwt === JWT
              ? { data: { user: { id: UID } }, error: null }
              : { data: { user: null }, error: { message: "inválido" } },
          ),
      },
    },
    clienteUsuario: (jwt) => {
      assertEquals(jwt, JWT);
      return { rpc: rpc("usuario", opts.usuario ?? {}) };
    },
    segredos: {
      conferirInterno: (req) =>
        Promise.resolve(req.headers.get("x-segredo-interno") === SEGREDO),
    },
    r2: {
      urlAssinada: (metodo, chave, segundos, cab) => {
        f.urls.push({ metodo, chave, segundos, cab });
        return Promise.resolve(`https://r2.exemplo/${chave}?exp=${segundos}`);
      },
      cabecalho: () => Promise.resolve(opts.cabecalho ?? null),
      apagar: (chaves) => {
        f.apagados.push(chaves);
        return Promise.resolve();
      },
      listar: () => Promise.resolve({ objetos: opts.objetos ?? [] }),
    },
    idDoArquivo: () => Promise.resolve(opts.id ?? null),
    registrarSemRegistro: (l) => {
      f.orfaos.push(l);
      return Promise.resolve();
    },
    agora: () => AGORA,
  };
  return f;
}

function chamar(
  f: Fake,
  corpo: unknown,
  modo: "usuario" | "interno" | "nenhum" | "segredo_errado" | "jwt_ruim" =
    "usuario",
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Origin: ORIGEM,
  };
  if (modo === "usuario") headers.Authorization = `Bearer ${JWT}`;
  if (modo === "jwt_ruim") headers.Authorization = "Bearer outro";
  if (modo === "interno") headers["x-segredo-interno"] = SEGREDO;
  if (modo === "segredo_errado") headers["x-segredo-interno"] = "errado";
  return criarHandler(f.deps)(
    new Request("https://f.exemplo/armazenamento", {
      method: "POST",
      headers,
      body: JSON.stringify(corpo),
    }),
  );
}

const ENVIO = {
  acao: "enviar",
  pasta: "fotos",
  caminho: "o/r/f.jpg",
  tamanho: 1234,
  tipo: "image/jpeg",
};

Deno.test("CORS: OPTIONS responde 204 e GET é 405", async () => {
  const f = montar();
  const h = criarHandler(f.deps);
  const r = await h(
    new Request("https://f.exemplo/", {
      method: "OPTIONS",
      headers: { Origin: ORIGEM },
    }),
  );
  assertEquals(r.status, 204);
  assertEquals(r.headers.get("Access-Control-Allow-Origin"), ORIGEM);
  const g = await h(new Request("https://f.exemplo/", { method: "GET" }));
  assertEquals(g.status, 405);
});

Deno.test("sem sessão ou JWT inválido: 401 sem_sessao", async () => {
  for (const modo of ["nenhum", "jwt_ruim"] as const) {
    const f = montar();
    const r = await chamar(f, ENVIO, modo);
    assertEquals(r.status, 401);
    assertEquals(await r.json(), { erro: "sem_sessao" });
    assertEquals(f.chamadas.length, 0);
  }
});

Deno.test("modo interno com segredo errado: 403 e nada acontece", async () => {
  const f = montar();
  const r = await chamar(f, { acao: "manutencao" }, "segredo_errado");
  assertEquals(r.status, 403);
  assertEquals(await r.json(), { erro: "sem_permissao" });
  assertEquals(f.chamadas.length + f.apagados.length + f.urls.length, 0);
});

Deno.test("enviar (usuário): RPC com o JWT e URL de PUT com content-length assinado", async () => {
  const f = montar({
    usuario: {
      arquivo_preparar_envio: () => ({ data: "enviar", error: null }),
    },
  });
  const r = await chamar(f, ENVIO);
  assertEquals(r.status, 200);
  const c = await r.json();
  assertEquals(c.situacao, "enviar");
  assertEquals(c.metodo, "PUT");
  assertEquals(c.cabecalhos, { "content-type": "image/jpeg" });
  assertEquals(c.url, "https://r2.exemplo/fotos/o/r/f.jpg?exp=600");
  assertEquals(c.expira_em, new Date(AGORA + 600_000).toISOString());
  assertEquals(f.chamadas[0], {
    cliente: "usuario",
    nome: "arquivo_preparar_envio",
    args: {
      p_pasta: "fotos",
      p_caminho: "o/r/f.jpg",
      p_tamanho: 1234,
      p_tipo: "image/jpeg",
    },
  });
  assertEquals(f.urls[0], {
    metodo: "PUT",
    chave: "fotos/o/r/f.jpg",
    segundos: VALIDADE_ENVIO,
    cab: { "content-type": "image/jpeg", "content-length": "1234" },
  });
});

Deno.test("enviar: ja_confirmado não devolve URL", async () => {
  const f = montar({
    usuario: {
      arquivo_preparar_envio: () => ({ data: "ja_confirmado", error: null }),
    },
  });
  const r = await chamar(f, ENVIO);
  assertEquals(r.status, 200);
  assertEquals(await r.json(), { situacao: "ja_confirmado" });
  assertEquals(f.urls.length, 0);
});

Deno.test("enviar: erros do banco viram {erro} com o status certo", async () => {
  const casos: [string, number][] = [
    ["sem_permissao", 403],
    ["sem_sessao", 401],
    ["fora_do_limite", 400],
    ["caminho_invalido", 400],
    ["em_exclusao", 409],
  ];
  for (const [msg, status] of casos) {
    const f = montar({
      usuario: {
        arquivo_preparar_envio: () => ({ data: null, error: { message: msg } }),
      },
    });
    const r = await chamar(f, ENVIO);
    assertEquals(r.status, status, msg);
    assertEquals(await r.json(), { erro: msg });
    assertEquals(f.urls.length, 0);
  }
});

Deno.test("enviar: erro de banco desconhecido é 500 sem vazar a mensagem", async () => {
  const f = montar({
    usuario: {
      arquivo_preparar_envio: () => ({
        data: null,
        error: { message: "detalhe interno" },
      }),
    },
  });
  const r = await chamar(f, ENVIO);
  assertEquals(r.status, 500);
  assertEquals(await r.json(), { erro: "erro_interno" });
});

Deno.test("enviar: entrada inválida e caminho inseguro não chegam ao banco", async () => {
  const f = montar();
  const ruins: [unknown, string][] = [
    [{ ...ENVIO, tamanho: "10" }, "entrada_invalida"],
    [{ ...ENVIO, tamanho: -1 }, "entrada_invalida"],
    [{ ...ENVIO, tipo: "" }, "entrada_invalida"],
    [{ ...ENVIO, pasta: "outra" }, "caminho_invalido"],
    [{ ...ENVIO, caminho: "../x.jpg" }, "caminho_invalido"],
    [{ ...ENVIO, caminho: "/x.jpg" }, "caminho_invalido"],
    [{ acao: "desconhecida" }, "entrada_invalida"],
  ];
  for (const [corpo, erro] of ruins) {
    const r = await chamar(f, corpo);
    assertEquals(r.status, 400);
    assertEquals(await r.json(), { erro });
  }
  assertEquals(f.chamadas.length, 0);
});

Deno.test("enviar (interno): sem RPC, só a URL", async () => {
  const f = montar();
  const r = await chamar(f, ENVIO, "interno");
  assertEquals(r.status, 200);
  assertEquals((await r.json()).situacao, "enviar");
  assertEquals(f.chamadas.length, 0);
  assertEquals(f.urls.length, 1);
});

Deno.test("confirmar (usuário): HEAD vai para arquivo_confirmar com o autor", async () => {
  const f = montar({
    cabecalho: { tamanho: 1234, tipo: "image/jpeg" },
    servico: { arquivo_confirmar: () => ({ data: "confirmado", error: null }) },
  });
  const r = await chamar(f, {
    acao: "confirmar",
    pasta: "fotos",
    caminho: "o/r/f.jpg",
  });
  assertEquals(r.status, 200);
  assertEquals(await r.json(), { situacao: "confirmado" });
  assertEquals(f.chamadas[0], {
    cliente: "servico",
    nome: "arquivo_confirmar",
    args: {
      p_pasta: "fotos",
      p_caminho: "o/r/f.jpg",
      p_tamanho: 1234,
      p_tipo: "image/jpeg",
      p_autor: UID,
    },
  });
});

Deno.test("confirmar: HEAD divergente do registro é 409", async () => {
  const f = montar({
    cabecalho: { tamanho: 99, tipo: "image/jpeg" },
    servico: { arquivo_confirmar: () => ({ data: "divergente", error: null }) },
  });
  const r = await chamar(f, {
    acao: "confirmar",
    pasta: "fotos",
    caminho: "o/r/f.jpg",
  });
  assertEquals(r.status, 409);
  assertEquals(await r.json(), { erro: "divergente" });
});

Deno.test("confirmar: objeto ausente no R2 é 404 e o banco nem é chamado", async () => {
  const f = montar({ cabecalho: null });
  const r = await chamar(f, {
    acao: "confirmar",
    pasta: "fotos",
    caminho: "o/r/f.jpg",
  });
  assertEquals(r.status, 404);
  assertEquals(await r.json(), { erro: "nao_encontrado" });
  assertEquals(f.chamadas.length, 0);
});

Deno.test("confirmar: banco sem linha pendente é 404", async () => {
  const f = montar({
    cabecalho: { tamanho: 1, tipo: "image/jpeg" },
    servico: {
      arquivo_confirmar: () => ({ data: "nao_encontrado", error: null }),
    },
    usuario: { arquivo_pode_ler: () => ({ data: [], error: null }) },
  });
  const r = await chamar(f, {
    acao: "confirmar",
    pasta: "fotos",
    caminho: "o/r/f.jpg",
  });
  assertEquals(r.status, 404);
});

Deno.test("confirmar de novo uma linha já confirmada devolve confirmado", async () => {
  const f = montar({
    cabecalho: { tamanho: 1, tipo: "image/jpeg" },
    servico: {
      arquivo_confirmar: () => ({ data: "nao_encontrado", error: null }),
    },
    usuario: {
      arquivo_pode_ler: () => ({
        data: [{ pasta: "fotos", caminho: "o/r/f.jpg" }],
        error: null,
      }),
    },
  });
  const r = await chamar(f, {
    acao: "confirmar",
    pasta: "fotos",
    caminho: "o/r/f.jpg",
  });
  assertEquals(r.status, 200);
  assertEquals(await r.json(), { situacao: "confirmado" });
});

Deno.test("confirmar (interno): usa arquivo_registrar_servico e respeita o limite", async () => {
  const f = montar({
    cabecalho: { tamanho: 5, tipo: "application/pdf" },
    servico: {
      arquivo_registrar_servico: () => ({ data: null, error: null }),
    },
  });
  const corpo = { acao: "confirmar", pasta: "boletins", caminho: "e/n.pdf" };
  const r = await chamar(f, corpo, "interno");
  assertEquals(r.status, 200);
  assertEquals(f.chamadas[0].nome, "arquivo_registrar_servico");
  assertEquals(f.chamadas[0].args, {
    p_pasta: "boletins",
    p_caminho: "e/n.pdf",
    p_tamanho: 5,
    p_tipo: "application/pdf",
  });

  const g = montar({
    cabecalho: { tamanho: 5, tipo: "text/html" },
    servico: {
      arquivo_registrar_servico: () => ({
        data: null,
        error: { message: "fora_do_limite" },
      }),
    },
  });
  const r2 = await chamar(g, corpo, "interno");
  assertEquals(r2.status, 400);
  assertEquals(await r2.json(), { erro: "fora_do_limite" });
});

const PODE_LER = (args: Record<string, unknown>) => {
  // O banco só libera o que é de fotos/ok.
  const itens = args.p_itens as { pasta: string; caminho: string }[];
  return {
    data: itens.filter((i) => i.caminho.startsWith("ok")),
    error: null,
  };
};

Deno.test("ler (usuário): só devolve URLs dos itens permitidos", async () => {
  const f = montar({ usuario: { arquivo_pode_ler: PODE_LER } });
  const r = await chamar(f, {
    acao: "ler",
    itens: [
      { pasta: "fotos", caminho: "ok/a.jpg" },
      { pasta: "fotos", caminho: "negado/b.jpg" },
    ],
  });
  assertEquals(r.status, 200);
  const c = await r.json();
  assertEquals(Object.keys(c.urls), ["fotos/ok/a.jpg"]);
  assertEquals(
    c.urls["fotos/ok/a.jpg"],
    "https://r2.exemplo/fotos/ok/a.jpg?exp=3600",
  );
  assertEquals(c.expira_em, new Date(AGORA + 3600_000).toISOString());
  assertEquals(f.urls.length, 1);
  assertEquals(f.urls[0].metodo, "GET");
});

Deno.test("ler: organizacao vale 7 dias", async () => {
  const f = montar({ usuario: { arquivo_pode_ler: PODE_LER } });
  const r = await chamar(f, {
    acao: "ler",
    itens: [{ pasta: "organizacao", caminho: "ok/logo.png" }],
  });
  const c = await r.json();
  assertEquals(f.urls[0].segundos, 604800);
  assert(c.urls["organizacao/ok/logo.png"].endsWith("exp=604800"));
  assertEquals(c.expira_em, new Date(AGORA + 604800_000).toISOString());
});

Deno.test("ler: negação do banco e excesso de itens", async () => {
  const f = montar({
    usuario: {
      arquivo_pode_ler: () => ({
        data: null,
        error: { message: "sem_sessao" },
      }),
    },
  });
  const itens = [{ pasta: "fotos", caminho: "ok/a.jpg" }];
  const r = await chamar(f, { acao: "ler", itens });
  assertEquals(r.status, 401);

  const g = montar();
  const muitos = Array.from({ length: 201 }, (_, i) => ({
    pasta: "fotos",
    caminho: `ok/${i}.jpg`,
  }));
  const r2 = await chamar(g, { acao: "ler", itens: muitos });
  assertEquals(r2.status, 400);
  assertEquals(await r2.json(), { erro: "fora_do_limite" });
});

Deno.test("excluir (usuário): marca, apaga no R2 e remove a linha", async () => {
  const f = montar({
    id: 7,
    usuario: { arquivo_marcar_exclusao: () => ({ data: null, error: null }) },
    servico: { arquivo_remover: () => ({ data: null, error: null }) },
  });
  const r = await chamar(f, {
    acao: "excluir",
    pasta: "fotos",
    caminho: "o/r/f.jpg",
  });
  assertEquals(r.status, 200);
  assertEquals(await r.json(), { situacao: "excluido" });
  assertEquals(f.chamadas.map((c) => c.nome), [
    "arquivo_marcar_exclusao",
    "arquivo_remover",
  ]);
  assertEquals(f.chamadas[1].args, { p_ids: [7] });
  assertEquals(f.apagados, [["fotos/o/r/f.jpg"]]);
});

Deno.test("excluir: sem permissão não apaga nada", async () => {
  const f = montar({
    usuario: {
      arquivo_marcar_exclusao: () => ({
        data: null,
        error: { message: "sem_permissao" },
      }),
    },
  });
  const r = await chamar(f, {
    acao: "excluir",
    pasta: "fotos",
    caminho: "o/r/f.jpg",
  });
  assertEquals(r.status, 403);
  assertEquals(await r.json(), { erro: "sem_permissao" });
  assertEquals(f.apagados.length, 0);
});

Deno.test("excluir (interno): não usa RPC de usuário", async () => {
  const f = montar({
    id: 3,
    servico: { arquivo_remover: () => ({ data: null, error: null }) },
  });
  const r = await chamar(
    f,
    { acao: "excluir", pasta: "modelos", caminho: "m.ifc" },
    "interno",
  );
  assertEquals(r.status, 200);
  assertEquals(f.chamadas.map((c) => c.cliente), ["servico"]);
  assertEquals(f.apagados, [["modelos/m.ifc"]]);
});

Deno.test("manutencao: recusada no modo usuário", async () => {
  const f = montar();
  const r = await chamar(f, { acao: "manutencao" });
  assertEquals(r.status, 403);
  assertEquals(await r.json(), { erro: "sem_permissao" });
  assertEquals(f.chamadas.length + f.apagados.length, 0);
});

Deno.test("manutencao: apaga a fila e só registra objetos sem linha (nunca os apaga)", async () => {
  const f = montar({
    objetos: [
      { chave: "fotos/a/com-registro.jpg", tamanho: 10 },
      { chave: "fotos/b/sem-registro.jpg", tamanho: 20 },
      { chave: "solto.bin", tamanho: 5 },
    ],
    servico: {
      arquivo_fila_manutencao: () => ({
        data: [
          { id: 1, pasta: "fotos", caminho: "x/excluir.jpg" },
          { id: 2, pasta: "plantas", caminho: "y/velho.webp" },
        ],
        error: null,
      }),
      arquivo_remover: () => ({ data: null, error: null }),
      arquivo_sem_registro: (args) => ({
        data: (args.p_chaves as string[]).filter((c) =>
          !c.includes("com-registro")
        ),
        error: null,
      }),
    },
  });
  const r = await chamar(f, { acao: "manutencao" }, "interno");
  assertEquals(r.status, 200);
  assertEquals(await r.json(), { removidos: 2, sem_registro: 2 });
  // Só a fila foi apagada no R2; os objetos sem registro não.
  assertEquals(f.apagados, [["fotos/x/excluir.jpg", "plantas/y/velho.webp"]]);
  assertEquals(f.orfaos, [[
    { bucket: "fotos", caminho: "b/sem-registro.jpg", tamanho: 20 },
    { bucket: "solto.bin", caminho: "", tamanho: 5 },
  ]]);
});

Deno.test("manutencao: bucket vazio e fila vazia não gravam nada", async () => {
  const f = montar({
    servico: {
      arquivo_fila_manutencao: () => ({ data: [], error: null }),
    },
  });
  const r = await chamar(f, { acao: "manutencao" }, "interno");
  assertEquals(await r.json(), { removidos: 0, sem_registro: 0 });
  assertEquals(f.apagados.length + f.orfaos.length, 0);
});

Deno.test("integração leve: handler com criarR2 real gera URL assinada de PUT", async () => {
  const f = montar({
    usuario: {
      arquivo_preparar_envio: () => ({ data: "enviar", error: null }),
    },
  });
  const r2 = criarR2({
    contaId: "c",
    chaveId: "k",
    segredo: "s",
    bucket: "b",
  });
  f.deps.r2.urlAssinada = r2.urlAssinada;
  const c = await (await chamar(f, ENVIO)).json();
  const u = new URL(c.url);
  assertEquals(u.pathname, `/b/${chaveObjeto("fotos", "o/r/f.jpg")}`);
  assertEquals(
    u.searchParams.get("X-Amz-SignedHeaders"),
    "content-length;content-type;host",
  );
  assertEquals(u.searchParams.get("X-Amz-Expires"), "600");
});
