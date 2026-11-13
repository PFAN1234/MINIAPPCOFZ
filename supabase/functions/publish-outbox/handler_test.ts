import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import { criarSegredos } from "../_shared/segredo.ts";
import type { ResultadoTelegram } from "../_shared/telegram.ts";
import {
  backoffMinutos,
  cortarTexto,
  criarHandler,
  formatarData,
  formatarDia,
  legendaBoletim,
  nomeMostrado,
} from "./handler.ts";

const AGORA = new Date("2026-11-10T15:00:00Z");
const TOKEN = "123456:TOKEN-SECRETO";
const OBRA = {
  id: "obra-1",
  nome: "HTO",
  slug: "hto",
  telegram_chat_id: -1001,
  telegram_thread_id: 55,
};

// deno-lint-ignore no-explicit-any
type Linha = Record<string, any>;
type Tabelas = Record<string, Linha[]>;

/** Banco falso: filtros `eq`, `is`, `not`, `in`, `order`, `limit` e `update`. */
function tabelaFalsa(
  tabelas: Tabelas,
  atualizacoes: Linha[],
  listaComErro: string[] = [],
) {
  return (nome: string) => {
    let linhas = [...(tabelas[nome] ?? [])];
    let alteracao: Linha | null = null;
    const b = {
      select: () => b,
      update: (v: Linha) => {
        alteracao = v;
        return b;
      },
      eq: (c: string, v: unknown) => {
        linhas = linhas.filter((l) => l[c] === v);
        return b;
      },
      is: (c: string, v: unknown) => {
        linhas = linhas.filter((l) => (l[c] ?? null) === v);
        return b;
      },
      not: (c: string, _op: string, v: unknown) => {
        linhas = linhas.filter((l) => (l[c] ?? null) !== v);
        return b;
      },
      lt: (c: string, v: number) => {
        linhas = linhas.filter((l) => l[c] < v);
        return b;
      },
      in: (c: string, vs: unknown[]) => {
        linhas = linhas.filter((l) => vs.includes(l[c]));
        return b;
      },
      order: () => b,
      limit: (n: number) => {
        linhas = linhas.slice(0, n);
        return b;
      },
      maybeSingle: () =>
        Promise.resolve({ data: linhas[0] ?? null, error: null }),
      // deno-lint-ignore no-explicit-any
      then: (res: any, rej: any) => {
        if (alteracao) {
          atualizacoes.push({
            tabela: nome,
            ids: linhas.map((l) => l.id),
            ...alteracao,
          });
          return Promise.resolve({ data: null, error: null }).then(res, rej);
        }
        if (listaComErro.includes(nome)) {
          return Promise.resolve({ data: null, error: { message: "caiu" } })
            .then(res, rej);
        }
        return Promise.resolve({ data: linhas, error: null }).then(res, rej);
      },
    };
    return b;
  };
}

interface Opcoes {
  publicacoes?: Linha[];
  tabelas?: Tabelas;
  /** Respostas do Telegram, em ordem; a última se repete. */
  respostas?: ResultadoTelegram[];
  storageErro?: boolean;
  obra?: Linha;
  finalizarErro?: boolean;
  reivindicarErro?: boolean;
  /** Tabelas cuja leitura de lista (sem `maybeSingle`) devolve erro. */
  listaComErro?: string[];
}

const fotoLinha = (registro: string, i: number, extra = {}) => ({
  id: `f${i}`,
  registro_id: registro,
  storage_path: `obra-1/${registro}/f${i}.jpg`,
  ordem: i,
  ...extra,
});

function tabelasBase(): Tabelas {
  return {
    obra: [OBRA],
    pavimento: [{ id: "pav-1", nome: "Térreo" }],
    ambiente: [{
      id: "amb-1",
      nome_operacional: "Apto. 101",
      pavimento_id: "pav-1",
    }],
    usuario: [
      { id: "u1", nome: "Fulano", username: "fulano" },
      { id: "u2", nome: "Gestora" },
    ],
    registro: [{
      id: "reg-1",
      obra_id: "obra-1",
      ambiente_id: "amb-1",
      tipo: "servico",
      legenda: "Reboco concluído",
      autor_id: "u1",
      // 17:32 UTC = 14:32 em São Paulo
      capturado_em: "2026-11-10T17:32:00Z",
    }],
    foto: [fotoLinha("reg-1", 0)],
    encerramento: [],
    publicacao_telegram: [],
    solicitacao_acesso: [],
  };
}

function montar(o: Opcoes = {}) {
  const tabelas = { ...tabelasBase(), ...(o.tabelas ?? {}) };
  if (o.obra) tabelas.obra = [o.obra];
  const atualizacoes: Linha[] = [];
  const finalizacoes: Linha[] = [];
  const chamadas: {
    metodo: string;
    corpo: Record<string, unknown> | FormData;
  }[] = [];
  const baixadas: string[] = [];
  let n = 0;
  const respostas = o.respostas ?? [{
    tipo: "ok",
    resultado: { message_id: 500 },
  }];
  const from = tabelaFalsa(tabelas, atualizacoes, o.listaComErro);
  const admin = {
    from,
    rpc: (nome: string, args: Linha = {}) => {
      if (nome === "segredo_interno") {
        return Promise.resolve({ data: "SEG", error: null });
      }
      if (nome === "reivindicar_publicacoes") {
        assertEquals(args, { p_limite: 10 });
        return Promise.resolve(
          o.reivindicarErro
            ? { data: null, error: { message: "falhou" } }
            : { data: o.publicacoes ?? [], error: null },
        );
      }
      assertEquals(nome, "finalizar_publicacao");
      finalizacoes.push(args);
      return Promise.resolve(
        o.finalizarErro
          ? { data: null, error: { message: "falhou" } }
          : { data: null, error: null },
      );
    },
    storage: {
      from: (b: string) => {
        assert(b === "fotos" || b === "boletins", b);
        return {
          download: (caminho: string) => {
            baixadas.push(b === "fotos" ? caminho : `${b}:${caminho}`);
            return Promise.resolve(
              o.storageErro
                ? { data: null, error: { message: "não achou" } }
                : { data: new Blob(["jpeg"]), error: null },
            );
          },
        };
      },
    },
  };
  const handler = criarHandler({
    telegram: {
      chamar: <T>(
        metodo: string,
        corpo?: Record<string, unknown> | FormData,
      ) => {
        chamadas.push({ metodo, corpo: corpo ?? {} });
        const r = respostas[Math.min(n++, respostas.length - 1)];
        return Promise.resolve(r as ResultadoTelegram<T>);
      },
    },
    admin,
    segredos: criarSegredos(admin),
    botUsername: "diarioobra_cofz_bot",
    appName: "diario",
    agora: () => AGORA,
  });
  return { handler, chamadas, finalizacoes, atualizacoes, baixadas };
}

const rodar = (
  handler: (r: Request) => Promise<Response>,
  segredo: string | null = "SEG",
) =>
  handler(
    new Request("https://f.test/publish-outbox", {
      method: "POST",
      headers: segredo === null ? {} : { "x-segredo-interno": segredo },
      body: "{}",
    }),
  );

const pub = (extra = {}) => ({
  id: 1,
  obra_id: "obra-1",
  registro_id: "reg-1",
  encerramento_id: null,
  tentativas: 1,
  ...extra,
});

const form = (c: { corpo: Record<string, unknown> | FormData }) =>
  c.corpo as FormData;

function textoVisivel(html: string): string {
  return html.replace(/<[^>]+>/g, "").replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

Deno.test("utilitários: backoff, data em São Paulo e corte", () => {
  assertEquals(
    [1, 2, 3, 4, 7, 8, 9, 20].map(backoffMinutos),
    [1, 2, 4, 8, 60, 60, 60, 60],
  );
  assertEquals(formatarData("2026-11-10T17:32:00Z"), "10/11 14:32");
  // Virada de dia: 02:30 UTC ainda é 23:30 do dia anterior em São Paulo.
  assertEquals(formatarData("2026-11-10T02:30:00Z"), "09/11 23:30");
  assertEquals(cortarTexto("abc", 5), "abc");
  assertEquals(cortarTexto("abcdef", 4), "abc…");
  assertEquals(cortarTexto("a😀b😀c", 4), "a😀…");
});

Deno.test("sem o segredo interno → 401 e nada é reivindicado", async () => {
  const m = montar({ publicacoes: [pub()] });
  assertEquals((await rodar(m.handler, "errado")).status, 401);
  assertEquals((await rodar(m.handler, null)).status, 401);
  assertEquals(m.chamadas.length + m.finalizacoes.length, 0);
});

Deno.test("GET → 405", async () => {
  const r = await montar().handler(
    new Request("https://f.test/", { method: "GET" }),
  );
  assertEquals(r.status, 405);
});

Deno.test("rodada vazia devolve o resumo", async () => {
  const r = await rodar(montar().handler);
  assertEquals(r.status, 200);
  assertEquals((await r.json()).reivindicadas, 0);
});

Deno.test("erro ao reivindicar → 500", async () => {
  const r = await rodar(montar({ reivindicarErro: true }).handler);
  assertEquals(r.status, 500);
});

Deno.test("foto única: sendPhoto, multipart, legenda HTML e publicado", async () => {
  const m = montar({ publicacoes: [pub()] });
  const r = await rodar(m.handler);
  assertEquals((await r.json()).publicadas, 1);
  assertEquals(m.baixadas, ["obra-1/reg-1/f0.jpg"]);
  assertEquals(m.chamadas.length, 1);
  assertEquals(m.chamadas[0].metodo, "sendPhoto");
  const f = form(m.chamadas[0]);
  assertEquals(f.get("chat_id"), "-1001");
  assertEquals(f.get("message_thread_id"), "55");
  assertEquals(f.get("parse_mode"), "HTML");
  assert(f.get("photo") instanceof File);
  assertEquals(
    f.get("caption"),
    [
      "🔧 <b>Serviço</b> · Apto. 101",
      "HTO · Térreo",
      "Reboco concluído",
      "👤 Fulano · 10/11 14:32",
      '<a href="https://t.me/diarioobra_cofz_bot/diario?startapp=registro_reg-1">Abrir no Fiscal Bot</a>',
    ].join("\n"),
  );
  assertEquals(m.finalizacoes, [{
    p_id: 1,
    p_estado: "publicado",
    p_message_ids: [500],
    p_erro: null,
    p_proxima: null,
  }]);
});

Deno.test("pendência usa o rótulo ⚠️ Pendência", async () => {
  const t = tabelasBase();
  t.registro[0].tipo = "pendencia";
  const m = montar({ publicacoes: [pub()], tabelas: t });
  await rodar(m.handler);
  assert(
    String(form(m.chamadas[0]).get("caption")).startsWith(
      "⚠️ <b>Pendência</b> · Apto. 101\n",
    ),
  );
});

Deno.test("várias fotos: sendMediaGroup com attach:// e legenda na primeira", async () => {
  const t = tabelasBase();
  t.foto = [0, 1, 2].map((i) => fotoLinha("reg-1", i));
  const m = montar({
    publicacoes: [pub()],
    tabelas: t,
    respostas: [{
      tipo: "ok",
      resultado: [{ message_id: 11 }, { message_id: 12 }, { message_id: 13 }],
    }],
  });
  await rodar(m.handler);
  assertEquals(m.chamadas[0].metodo, "sendMediaGroup");
  const f = form(m.chamadas[0]);
  const media = JSON.parse(String(f.get("media")));
  assertEquals(media.map((x: { media: string }) => x.media), [
    "attach://f0",
    "attach://f1",
    "attach://f2",
  ]);
  assertEquals(media[0].parse_mode, "HTML");
  assert(String(media[0].caption).includes("Reboco concluído"));
  assertFalse("caption" in media[1]);
  for (const i of [0, 1, 2]) assert(f.get(`f${i}`) instanceof File);
  assertEquals(f.get("message_thread_id"), "55");
  assertEquals(m.finalizacoes[0].p_message_ids, [11, 12, 13]);
});

Deno.test("legenda: HTML escapado e texto visível limitado a 1024", async () => {
  const t = tabelasBase();
  t.registro[0].legenda = "<script>&" + "x".repeat(3000);
  t.ambiente[0].nome_operacional = "Sala <A> & B";
  const m = montar({ publicacoes: [pub()], tabelas: t });
  await rodar(m.handler);
  const caption = String(form(m.chamadas[0]).get("caption"));
  assert(caption.includes("&lt;script&gt;&amp;xxx"));
  assert(caption.includes("Sala &lt;A&gt; &amp; B"));
  assertFalse(caption.includes("<script>"));
  const visivel = textoVisivel(caption);
  assertEquals(visivel.length, 1024);
  assert(
    visivel.includes("…\n👤 Fulano · 10/11 14:32\nAbrir no Fiscal Bot"),
  );
  // O link (rodapé) permanece inteiro.
  assert(caption.endsWith("Abrir no Fiscal Bot</a>"));
});

Deno.test("obra sem tópico: pendente em 15 min, sem chamar o Telegram", async () => {
  const m = montar({
    publicacoes: [pub()],
    obra: { ...OBRA, telegram_chat_id: null, telegram_thread_id: null },
  });
  const r = await rodar(m.handler);
  assertEquals((await r.json()).pendentes, 1);
  assertEquals(m.chamadas.length, 0);
  assertEquals(m.finalizacoes, [{
    p_id: 1,
    p_estado: "pendente",
    p_message_ids: null,
    p_erro: "Obra sem tópico vinculado.",
    p_proxima: new Date(AGORA.getTime() + 15 * 60_000).toISOString(),
  }]);
});

Deno.test("falha ao baixar a foto: pendente com backoff, sem enviar", async () => {
  const m = montar({
    publicacoes: [pub({ tentativas: 3 })],
    storageErro: true,
  });
  await rodar(m.handler);
  assertEquals(m.chamadas.length, 0);
  assertEquals(m.finalizacoes[0].p_estado, "pendente");
  assertEquals(
    m.finalizacoes[0].p_proxima,
    new Date(AGORA.getTime() + 4 * 60_000).toISOString(),
  );
});

Deno.test("429: pendente no retry_after", async () => {
  const m = montar({
    publicacoes: [pub()],
    respostas: [{
      tipo: "http",
      status: 429,
      description: "Too Many Requests",
      retryAfter: 42,
    }],
  });
  await rodar(m.handler);
  assertEquals(m.finalizacoes[0].p_estado, "pendente");
  assertEquals(m.finalizacoes[0].p_erro, "Too Many Requests");
  assertEquals(
    m.finalizacoes[0].p_proxima,
    new Date(AGORA.getTime() + 42_000).toISOString(),
  );
});

Deno.test("400: pendente com backoff; na 8ª tentativa vira falhou", async () => {
  const resp: ResultadoTelegram = {
    tipo: "http",
    status: 400,
    description: "Bad Request: chat not found",
  };
  const a = montar({
    publicacoes: [pub({ tentativas: 3 })],
    respostas: [resp],
  });
  await rodar(a.handler);
  assertEquals(a.finalizacoes[0].p_estado, "pendente");
  assertEquals(a.finalizacoes[0].p_erro, "Bad Request: chat not found");
  assertEquals(
    a.finalizacoes[0].p_proxima,
    new Date(AGORA.getTime() + 4 * 60_000).toISOString(),
  );

  const b = montar({
    publicacoes: [pub({ tentativas: 7 })],
    respostas: [resp],
  });
  await rodar(b.handler);
  assertEquals(b.finalizacoes[0].p_estado, "pendente");
  assertEquals(
    b.finalizacoes[0].p_proxima,
    new Date(AGORA.getTime() + 60 * 60_000).toISOString(),
  );

  const c = montar({
    publicacoes: [pub({ tentativas: 8 })],
    respostas: [resp],
  });
  const r = await rodar(c.handler);
  assertEquals(c.finalizacoes[0].p_estado, "falhou");
  assertEquals(c.finalizacoes[0].p_proxima, null);
  assertEquals((await r.json()).falhas, 1);
});

Deno.test("403 segue a mesma regra do 400", async () => {
  const m = montar({
    publicacoes: [pub({ tentativas: 8 })],
    respostas: [{ tipo: "http", status: 403, description: "bot was kicked" }],
  });
  await rodar(m.handler);
  assertEquals(m.finalizacoes[0].p_estado, "falhou");
});

Deno.test("erro de rede e 5xx → incerto, sem nova tentativa", async () => {
  for (
    const resp of [
      { tipo: "rede", motivo: "timeout" },
      { tipo: "rede", motivo: "falha" },
      { tipo: "http", status: 502, description: "Bad Gateway" },
    ] as ResultadoTelegram[]
  ) {
    const m = montar({ publicacoes: [pub()], respostas: [resp] });
    const r = await rodar(m.handler);
    assertEquals((await r.json()).incertas, 1);
    assertEquals(m.finalizacoes[0].p_estado, "incerto");
    assertEquals(m.finalizacoes[0].p_proxima, null);
    assert(String(m.finalizacoes[0].p_erro).length > 0);
  }
});

Deno.test("o token nunca aparece nas respostas nem nos logs", async () => {
  const logs: string[] = [];
  const antes = [console.warn, console.error];
  console.warn = console.error = (...a: unknown[]) => logs.push(a.join(" "));
  try {
    const m = montar({
      publicacoes: [pub()],
      respostas: [{ tipo: "rede", motivo: "falha" }],
    });
    const r = await rodar(m.handler);
    assertFalse((await r.text()).includes(TOKEN));
    assertFalse(JSON.stringify(m.finalizacoes).includes(TOKEN));
  } finally {
    [console.warn, console.error] = antes;
  }
  assertFalse(logs.join("\n").includes(TOKEN));
});

Deno.test("encerramento: reply_parameters, observação e gestor", async () => {
  const t = tabelasBase();
  t.registro[0].tipo = "pendencia";
  t.encerramento = [{
    id: "enc-1",
    registro_id: "reg-1",
    gestor_id: "u2",
    observacao: "Refeito <ok>",
    encerrado_em: "2026-11-11T12:05:00Z",
  }];
  t.foto = [{
    id: "fe",
    encerramento_id: "enc-1",
    storage_path: "obra-1/reg-1/fe.jpg",
    ordem: 0,
  }];
  t.publicacao_telegram = [
    {
      id: 1,
      registro_id: "reg-1",
      estado: "publicado",
      message_ids: [321, 322],
    },
  ];
  const m = montar({
    publicacoes: [pub({ id: 2, registro_id: null, encerramento_id: "enc-1" })],
    tabelas: t,
  });
  await rodar(m.handler);
  assertEquals(m.baixadas, ["obra-1/reg-1/fe.jpg"]);
  const f = form(m.chamadas[0]);
  assertEquals(JSON.parse(String(f.get("reply_parameters"))), {
    message_id: 321,
    allow_sending_without_reply: true,
  });
  assertEquals(
    f.get("caption"),
    [
      "✅ <b>Pendência resolvida</b> · Apto. 101",
      "HTO · Térreo",
      "Refeito &lt;ok&gt;",
      "👤 Gestora · 11/11 09:05",
      '<a href="https://t.me/diarioobra_cofz_bot/diario?startapp=registro_reg-1">Abrir no Fiscal Bot</a>',
    ].join("\n"),
  );
  assertEquals(m.finalizacoes[0].p_id, 2);
  assertEquals(m.finalizacoes[0].p_estado, "publicado");
});

Deno.test("encerramento sem publicação anterior e sem observação", async () => {
  const t = tabelasBase();
  t.registro[0].tipo = "pendencia";
  t.encerramento = [{
    id: "enc-1",
    registro_id: "reg-1",
    gestor_id: "u2",
    observacao: null,
    encerrado_em: "2026-11-11T12:05:00Z",
  }];
  t.foto = [{
    id: "fe",
    encerramento_id: "enc-1",
    storage_path: "obra-1/reg-1/fe.jpg",
    ordem: 0,
  }];
  const m = montar({
    publicacoes: [pub({ registro_id: null, encerramento_id: "enc-1" })],
    tabelas: t,
  });
  await rodar(m.handler);
  const f = form(m.chamadas[0]);
  assertEquals(f.get("reply_parameters"), null);
  assertEquals(String(f.get("caption")).split("\n").length, 4);
});

Deno.test("falha ao finalizar não derruba a rodada", async () => {
  const m = montar({ publicacoes: [pub()], finalizarErro: true });
  const r = await rodar(m.handler);
  assertEquals(r.status, 200);
});

const pedido = (extra = {}) => ({
  id: "sol-1",
  obra_id: "obra-1",
  usuario_id: "u1",
  estado: "pendente",
  notificada_em: null,
  criado_em: "2026-11-10T14:00:00Z",
  ...extra,
});

Deno.test("aviso de pedido de acesso: envia e grava notificada_em", async () => {
  const t = tabelasBase();
  t.solicitacao_acesso = [
    pedido(),
    pedido({ id: "sol-2", notificada_em: "2026-11-10T14:30:00Z" }),
    pedido({ id: "sol-3", estado: "aprovada" }),
  ];
  const m = montar({ tabelas: t });
  const r = await rodar(m.handler);
  assertEquals((await r.json()).avisos_enviados, 1);
  assertEquals(m.chamadas.length, 1);
  assertEquals(m.chamadas[0].metodo, "sendMessage");
  assertEquals(m.chamadas[0].corpo, {
    chat_id: -1001,
    message_thread_id: 55,
    text:
      '🔑 <b>Fulano</b> (@fulano) pediu acesso ao Fiscal Bot.\nGestores: <a href="https://t.me/diarioobra_cofz_bot/diario?startapp=acessos_hto">ver pedidos</a>',
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
  assertEquals(m.atualizacoes, [{
    tabela: "solicitacao_acesso",
    ids: ["sol-1"],
    notificada_em: AGORA.toISOString(),
  }]);
});

Deno.test("aviso: nome escapado e sem @username quando não há", async () => {
  const t = tabelasBase();
  t.usuario = [{ id: "u1", nome: "Ana <&> Souza", username: null }];
  t.solicitacao_acesso = [pedido()];
  const m = montar({ tabelas: t });
  await rodar(m.handler);
  assert(
    String((m.chamadas[0].corpo as Linha).text).startsWith(
      "🔑 <b>Ana &lt;&amp;&gt; Souza</b> pediu acesso",
    ),
  );
});

Deno.test("aviso: falha do Telegram não grava notificada_em", async () => {
  const t = tabelasBase();
  t.solicitacao_acesso = [pedido()];
  const m = montar({
    tabelas: t,
    respostas: [{ tipo: "http", status: 400, description: "chat not found" }],
  });
  const r = await rodar(m.handler);
  const corpo = await r.json();
  assertEquals(corpo.avisos_enviados, 0);
  assertEquals(corpo.avisos_falhos, 1);
  assertEquals(m.atualizacoes, []);
});

Deno.test("aviso: no máximo 5 por rodada e só de obra vinculada", async () => {
  const t = tabelasBase();
  t.obra.push({
    id: "obra-2",
    nome: "Outra",
    slug: "outra",
    telegram_chat_id: null,
    telegram_thread_id: null,
  });
  t.solicitacao_acesso = [
    ...[1, 2, 3, 4, 5, 6, 7].map((i) => pedido({ id: `s${i}` })),
    pedido({ id: "so", obra_id: "obra-2" }),
  ];
  const m = montar({ tabelas: t });
  const r = await rodar(m.handler);
  assertEquals((await r.json()).avisos_enviados, 5);
  assertEquals(m.chamadas.length, 5);
});

Deno.test("aviso: obra arquivada não recebe aviso de pedido", async () => {
  const t = tabelasBase();
  t.obra = [{ ...OBRA, arquivada_em: "2026-11-12T10:00:00Z" }];
  t.solicitacao_acesso = [pedido()];
  const m = montar({ tabelas: t });
  const r = await rodar(m.handler);
  assertEquals((await r.json()).avisos_enviados, 0);
  assertEquals(m.chamadas.length, 0);
  assertEquals(m.atualizacoes, []);
});

Deno.test("nome mostrado: nome de exibição, senão o do Telegram", () => {
  assertEquals(
    nomeMostrado({ nome: "Patricio", nome_exibicao: "CP PATRICIO" }),
    "CP PATRICIO",
  );
  assertEquals(
    nomeMostrado({ nome: "Patricio", nome_exibicao: null }),
    "Patricio",
  );
  assertEquals(nomeMostrado({ nome: "Patricio" }), "Patricio");
  assertEquals(nomeMostrado(null), null);
});

Deno.test("registro: autor pelo nome de exibição", async () => {
  const t = tabelasBase();
  t.usuario[0].nome_exibicao = "CP PATRICIO";
  const m = montar({ publicacoes: [pub()], tabelas: t });
  await rodar(m.handler);
  const legenda = String(form(m.chamadas[0]).get("caption"));
  assert(legenda.includes("\n👤 CP PATRICIO · 10/11 14:32\n"));
  assertFalse(legenda.includes("Fulano"));
});

Deno.test("encerramento: quem encerrou pelo nome de exibição (escapado)", async () => {
  const t = tabelasBase();
  t.registro[0].tipo = "pendencia";
  t.usuario[1].nome_exibicao = "SGT <B>";
  t.encerramento = [{
    id: "enc-1",
    registro_id: "reg-1",
    gestor_id: "u2",
    observacao: null,
    encerrado_em: "2026-11-11T12:05:00Z",
  }];
  t.foto = [{
    id: "fe",
    encerramento_id: "enc-1",
    storage_path: "obra-1/reg-1/fe.jpg",
    ordem: 0,
  }];
  const m = montar({
    publicacoes: [pub({ id: 2, registro_id: null, encerramento_id: "enc-1" })],
    tabelas: t,
  });
  await rodar(m.handler);
  const legenda = String(form(m.chamadas[0]).get("caption"));
  assert(legenda.includes("\n👤 SGT &lt;B&gt; · 11/11 09:05\n"));
  assertFalse(legenda.includes("Gestora"));
});

Deno.test("aviso: nome de exibição e mantém o @username", async () => {
  const t = tabelasBase();
  t.usuario[0].nome_exibicao = "CP PATRICIO";
  t.solicitacao_acesso = [pedido()];
  const m = montar({ tabelas: t });
  await rodar(m.handler);
  assert(
    String((m.chamadas[0].corpo as Linha).text).startsWith(
      "🔑 <b>CP PATRICIO</b> (@fulano) pediu acesso",
    ),
  );
});

// --- Boletim ------------------------------------------------------------------------------------

const ETAPA = { id: "etapa-1", nome: "2ª ETAPA", telegram_chat_id: -1009 };
const BOLETIM = {
  id: "bol-1",
  etapa_id: "etapa-1",
  data: "2026-11-13",
  revisao: 0,
  numero: "BA2/261113/COFZ",
  pdf_path: "etapa-1/BA2261113COFZ.pdf",
};

const pubBoletim = (extra = {}) => ({
  id: 7,
  obra_id: null,
  registro_id: null,
  encerramento_id: null,
  boletim_id: "bol-1",
  tentativas: 1,
  ...extra,
});

function tabelasBoletim(etapa: Linha = ETAPA, boletim: Linha = BOLETIM) {
  return { ...tabelasBase(), etapa: [etapa], boletim: [boletim] };
}

Deno.test("legenda do boletim: número, etapa, data e retificação", () => {
  assertEquals(formatarDia("2026-11-13"), "13/11/2026");
  assertEquals(
    legendaBoletim(BOLETIM, "2ª ETAPA"),
    "📄 <b>Boletim BA2/261113/COFZ</b>\n2ª ETAPA · 13/11/2026",
  );
  assertEquals(
    legendaBoletim(
      { ...BOLETIM, numero: "BA2/261113/COFZ-R1", revisao: 1 },
      "Etapa <A> & B",
    ),
    "📄 <b>Boletim BA2/261113/COFZ-R1</b>\nEtapa &lt;A&gt; &amp; B · 13/11/2026 · retificação R1",
  );
});

Deno.test("boletim: sendDocument no grupo da etapa (tópico Geral) com o PDF", async () => {
  const m = montar({
    publicacoes: [pubBoletim()],
    tabelas: tabelasBoletim(),
    respostas: [{ tipo: "ok", resultado: { message_id: 900 } }],
  });
  const r = await rodar(m.handler);
  assertEquals((await r.json()).publicadas, 1);
  assertEquals(m.baixadas, ["boletins:etapa-1/BA2261113COFZ.pdf"]);
  assertEquals(m.chamadas.length, 1);
  assertEquals(m.chamadas[0].metodo, "sendDocument");
  const f = form(m.chamadas[0]);
  assertEquals(f.get("chat_id"), "-1009");
  assertFalse(f.has("message_thread_id"));
  assertEquals(f.get("parse_mode"), "HTML");
  assertEquals(
    f.get("caption"),
    "📄 <b>Boletim BA2/261113/COFZ</b>\n2ª ETAPA · 13/11/2026",
  );
  const doc = f.get("document");
  assert(doc instanceof File);
  assertEquals(doc.name, "BA2261113COFZ.pdf");
  assertEquals(m.finalizacoes, [{
    p_id: 7,
    p_estado: "publicado",
    p_message_ids: [900],
    p_erro: null,
    p_proxima: null,
  }]);
});

Deno.test("boletim: retificação na legenda", async () => {
  const m = montar({
    publicacoes: [pubBoletim()],
    tabelas: tabelasBoletim(ETAPA, {
      ...BOLETIM,
      revisao: 2,
      numero: "BA2/261113/COFZ-R2",
      pdf_path: "etapa-1/BA2261113COFZ-R2.pdf",
    }),
  });
  await rodar(m.handler);
  assertEquals(
    form(m.chamadas[0]).get("caption"),
    "📄 <b>Boletim BA2/261113/COFZ-R2</b>\n2ª ETAPA · 13/11/2026 · retificação R2",
  );
  assertEquals(m.baixadas, ["boletins:etapa-1/BA2261113COFZ-R2.pdf"]);
});

const BOLETIM_R1 = {
  ...BOLETIM,
  id: "bol-2",
  revisao: 1,
  numero: "BA2/261113/COFZ-R1",
  pdf_path: "etapa-1/BA2261113COFZ-R1.pdf",
};

/** Retificação R1 (publicação 7) com o original publicado (mensagens 900 e 901) e outras linhas que não devem ser tocadas. */
function cenarioRetificacao(extra: Partial<Opcoes> = {}, revisao = 1) {
  const atual = revisao > 0 ? BOLETIM_R1 : BOLETIM;
  const tabelas: Tabelas = tabelasBoletim(ETAPA, atual);
  tabelas.boletim = [
    atual,
    BOLETIM,
    { ...BOLETIM, id: "bol-outro-dia", data: "2026-11-12", revisao: 0 },
    { ...BOLETIM, id: "bol-outra-etapa", etapa_id: "etapa-2", revisao: 0 },
  ];
  tabelas.publicacao_telegram = [
    {
      id: 1,
      boletim_id: "bol-1",
      estado: "publicado",
      message_ids: [900, 901],
    },
    { id: 2, boletim_id: "bol-1", estado: "falhou", message_ids: [777] },
    {
      id: 3,
      boletim_id: "bol-outro-dia",
      estado: "publicado",
      message_ids: [555],
    },
    {
      id: 4,
      boletim_id: "bol-outra-etapa",
      estado: "publicado",
      message_ids: [666],
    },
  ];
  return montar({
    publicacoes: [pubBoletim({ boletim_id: atual.id })],
    tabelas,
    ...extra,
  });
}

Deno.test("boletim: retificação apaga a mensagem da revisão anterior depois de enviar", async () => {
  const m = cenarioRetificacao({
    respostas: [
      { tipo: "ok", resultado: { message_id: 950 } },
      { tipo: "ok", resultado: true },
    ],
  });
  const r = await rodar(m.handler);
  assertEquals((await r.json()).publicadas, 1);
  assertEquals(m.chamadas.map((c) => c.metodo), [
    "sendDocument",
    "deleteMessage",
    "deleteMessage",
  ]);
  assertEquals(m.chamadas[1].corpo, { chat_id: -1009, message_id: 900 });
  assertEquals(m.chamadas[2].corpo, { chat_id: -1009, message_id: 901 });
  assertEquals(m.finalizacoes[0].p_estado, "publicado");
  assertEquals(m.finalizacoes[0].p_message_ids, [950]);
});

Deno.test("boletim: falha ao apagar a anterior só vai para o log; a nova continua publicada", async () => {
  const aviso = console.warn;
  const avisos: string[] = [];
  console.warn = (...a: unknown[]) => avisos.push(a.join(" "));
  try {
    const http = cenarioRetificacao({
      respostas: [
        { tipo: "ok", resultado: { message_id: 950 } },
        {
          tipo: "http",
          status: 400,
          description: "message can't be deleted",
        },
        { tipo: "rede", motivo: "timeout" },
      ],
    });
    await rodar(http.handler);
    assertEquals(http.chamadas.length, 3);
    assertEquals(http.finalizacoes[0].p_estado, "publicado");
    assertEquals(http.finalizacoes[0].p_message_ids, [950]);
    assert(avisos.some((a) => a.includes("não apagada (400)")));
    assert(avisos.some((a) => a.includes("sem resposta ao apagar")));

    const leitura = cenarioRetificacao({
      listaComErro: ["publicacao_telegram"],
    });
    await rodar(leitura.handler);
    assertEquals(leitura.chamadas.map((c) => c.metodo), ["sendDocument"]);
    assertEquals(leitura.finalizacoes[0].p_estado, "publicado");
    assert(avisos.some((a) => a.includes("não foi possível apagar")));
  } finally {
    console.warn = aviso;
  }
});

Deno.test("boletim: revisão 0 não apaga nada", async () => {
  const m = cenarioRetificacao({}, 0);
  await rodar(m.handler);
  assertEquals(m.chamadas.map((c) => c.metodo), ["sendDocument"]);
  assertEquals(m.finalizacoes[0].p_estado, "publicado");
});

Deno.test("boletim: etapa sem grupo → pendente em 15 min, sem chamar o Telegram", async () => {
  const m = montar({
    publicacoes: [pubBoletim()],
    tabelas: tabelasBoletim({ ...ETAPA, telegram_chat_id: null }),
  });
  const r = await rodar(m.handler);
  assertEquals((await r.json()).pendentes, 1);
  assertEquals(m.chamadas.length + m.baixadas.length, 0);
  assertEquals(m.finalizacoes, [{
    p_id: 7,
    p_estado: "pendente",
    p_message_ids: null,
    p_erro: "Etapa sem grupo vinculado.",
    p_proxima: new Date(AGORA.getTime() + 15 * 60_000).toISOString(),
  }]);
});

Deno.test("boletim: falha ao baixar o PDF → backoff; na 8ª tentativa, falhou", async () => {
  const m = montar({
    publicacoes: [pubBoletim({ tentativas: 3 })],
    tabelas: tabelasBoletim(),
    storageErro: true,
  });
  await rodar(m.handler);
  assertEquals(m.chamadas.length, 0);
  assertEquals(m.finalizacoes[0].p_estado, "pendente");
  assertEquals(m.finalizacoes[0].p_erro, "Falha ao baixar o PDF do Storage.");
  assertEquals(
    m.finalizacoes[0].p_proxima,
    new Date(AGORA.getTime() + 4 * 60_000).toISOString(),
  );
  const m8 = montar({
    publicacoes: [pubBoletim({ tentativas: 8 })],
    tabelas: tabelasBoletim(),
    storageErro: true,
  });
  await rodar(m8.handler);
  assertEquals(m8.finalizacoes[0].p_estado, "falhou");
});

Deno.test("boletim: inexistente ou sem PDF → falhou; erros do Telegram como as demais", async () => {
  const sem = montar({
    publicacoes: [pubBoletim({ boletim_id: "outro" })],
    tabelas: tabelasBoletim(),
  });
  await rodar(sem.handler);
  assertEquals(sem.finalizacoes[0].p_estado, "falhou");
  assertEquals(sem.finalizacoes[0].p_erro, "Boletim não encontrado.");

  const semPdf = montar({
    publicacoes: [pubBoletim()],
    tabelas: tabelasBoletim(ETAPA, { ...BOLETIM, pdf_path: null }),
  });
  await rodar(semPdf.handler);
  assertEquals(semPdf.finalizacoes[0].p_erro, "Boletim sem PDF.");

  const rede = montar({
    publicacoes: [pubBoletim()],
    tabelas: tabelasBoletim(),
    respostas: [{ tipo: "rede", motivo: "timeout" }],
  });
  await rodar(rede.handler);
  assertEquals(rede.finalizacoes[0].p_estado, "incerto");

  const limite = montar({
    publicacoes: [pubBoletim()],
    tabelas: tabelasBoletim(),
    respostas: [{
      tipo: "http",
      status: 429,
      description: "Too Many Requests",
      retryAfter: 12,
    }],
  });
  await rodar(limite.handler);
  assertEquals(limite.finalizacoes[0].p_estado, "pendente");
  assertEquals(
    limite.finalizacoes[0].p_proxima,
    new Date(AGORA.getTime() + 12_000).toISOString(),
  );
});

Deno.test("boletim e registro na mesma rodada", async () => {
  const m = montar({
    publicacoes: [pub(), pubBoletim()],
    tabelas: tabelasBoletim(),
  });
  const r = await rodar(m.handler);
  assertEquals((await r.json()).publicadas, 2);
  assertEquals(m.chamadas.map((c) => c.metodo), ["sendPhoto", "sendDocument"]);
});
