// Lógica da Edge Function armazenamento, com dependências injetadas (testável sem rede).
// Entrega URLs assinadas do R2 e mantém a tabela `arquivo`. POST com JSON `{acao, ...}`:
// - `enviar` `{pasta, caminho, tamanho, tipo}`: `arquivo_preparar_envio` (modo usuário) e URL de PUT
//   (600 s), ou `{situacao:'ja_confirmado'}`;
// - `confirmar` `{pasta, caminho}`: HEAD no R2 e `arquivo_confirmar` (usuário) ou
//   `arquivo_registrar_servico` (interno);
// - `ler` `{itens:[{pasta,caminho}]}`: `arquivo_pode_ler` (usuário) e URLs de GET (3.600 s;
//   `organizacao` 604.800 s);
// - `excluir` `{pasta, caminho}`: marca, apaga no R2 e remove a linha;
// - `manutencao`: só modo interno; apaga o que está na fila e registra em `orfao_storage` os
//   objetos do bucket sem linha em `arquivo` (nunca apaga objeto sem registro).
// Modos: `Authorization: Bearer <JWT da sessão>` (usuário) ou `x-segredo-interno` (interno).
import { cabecalhosCors, json } from "../_shared/http.ts";
import { chaveObjeto, type ClienteR2 } from "../_shared/r2.ts";
import { CABECALHO_SEGREDO_INTERNO } from "../_shared/segredo.ts";

export const VALIDADE_ENVIO = 600;
export const VALIDADE_LEITURA = 3600;
export const VALIDADE_ORGANIZACAO = 604800;
export const MAX_ITENS_LEITURA = 200;
/** Linhas da fila por chamada da RPC e rodadas máximas por execução da manutenção. */
export const LOTE_FILA = 500;
export const MAX_RODADAS_FILA = 10;
/** Chaves por chamada de `arquivo_sem_registro`. */
export const LOTE_SEM_REGISTRO = 1000;

type ErroSupabase = { message: string; code?: string } | null;

export interface ClienteRpc {
  rpc(
    nome: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: ErroSupabase }>;
}

/** Cliente com a chave de serviço: chama RPCs da service role e confere o JWT. */
export interface ClienteServico extends ClienteRpc {
  auth: {
    getUser(jwt: string): Promise<{
      data: { user: { id: string } | null };
      error: { message: string } | null;
    }>;
  };
}

export interface LinhaOrfao {
  bucket: string;
  caminho: string;
  tamanho: number;
}

export interface Deps {
  origensPermitidas: string[];
  admin: ClienteServico;
  /** Cliente que fala com o banco como o dono do JWT (auth.uid() vale). */
  clienteUsuario: (jwt: string) => ClienteRpc;
  segredos: { conferirInterno(req: Request): Promise<boolean> };
  r2: Pick<
    ClienteR2,
    "urlAssinada" | "cabecalho" | "apagar" | "listar"
  >;
  /** `id` da linha em `arquivo`, ou null. */
  idDoArquivo(pasta: string, caminho: string): Promise<number | null>;
  /** Grava em `orfao_storage` com `origem='sem_registro'` (sem sobrescrever o que já existe). */
  registrarSemRegistro(linhas: LinhaOrfao[]): Promise<void>;
  agora?: () => number;
}

const ERROS_BANCO: Record<string, number> = {
  sem_sessao: 401,
  sem_permissao: 403,
  caminho_invalido: 400,
  fora_do_limite: 400,
  em_exclusao: 409,
};

class ErroHttp extends Error {
  constructor(public status: number, public codigo: string) {
    super(codigo);
  }
}

/** Erro do banco vira ErroHttp pela mensagem; o que não for conhecido é falha interna. */
function lancarSeErro(erro: ErroSupabase, rpc: string): void {
  if (!erro) return;
  const status = ERROS_BANCO[erro.message.trim()];
  if (status !== undefined) throw new ErroHttp(status, erro.message.trim());
  throw new Error(`${rpc}: ${erro.message}`);
}

function bearer(req: Request): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("Authorization") ?? "");
  return m ? m[1] : null;
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

/** Chave do R2 de pasta e caminho; 400 `caminho_invalido` se forem inaceitáveis. */
function chaveDe(pasta: unknown, caminho: unknown): {
  pasta: string;
  caminho: string;
  chave: string;
} {
  const p = texto(pasta);
  const c = texto(caminho);
  if (p === null || c === null) throw new ErroHttp(400, "entrada_invalida");
  try {
    return { pasta: p, caminho: c, chave: chaveObjeto(p, c) };
  } catch {
    throw new ErroHttp(400, "caminho_invalido");
  }
}

export function criarHandler(deps: Deps) {
  const agora = deps.agora ?? (() => Date.now());
  const expiraEm = (segundos: number) =>
    new Date(agora() + segundos * 1000).toISOString();

  /** Modo da chamada: `{interno:true}` ou `{uid}`. Lança 401/403 se não confere. */
  async function identificar(
    req: Request,
  ): Promise<{ interno: true } | { interno: false; uid: string; jwt: string }> {
    if (req.headers.has(CABECALHO_SEGREDO_INTERNO)) {
      if (!(await deps.segredos.conferirInterno(req))) {
        throw new ErroHttp(403, "sem_permissao");
      }
      return { interno: true };
    }
    const jwt = bearer(req);
    if (!jwt) throw new ErroHttp(401, "sem_sessao");
    const { data, error } = await deps.admin.auth.getUser(jwt);
    const uid = error ? null : data?.user?.id ?? null;
    if (!uid) throw new ErroHttp(401, "sem_sessao");
    return { interno: false, uid, jwt };
  }

  type Chamador = Awaited<ReturnType<typeof identificar>>;

  async function enviar(c: Chamador, corpo: Record<string, unknown>) {
    const { pasta, caminho, chave } = chaveDe(corpo.pasta, corpo.caminho);
    const tamanho = corpo.tamanho;
    const tipo = texto(corpo.tipo);
    if (
      typeof tamanho !== "number" || !Number.isSafeInteger(tamanho) ||
      tamanho < 0 || tipo === null
    ) {
      throw new ErroHttp(400, "entrada_invalida");
    }
    if (!c.interno) {
      const { data, error } = await deps.clienteUsuario(c.jwt).rpc(
        "arquivo_preparar_envio",
        {
          p_pasta: pasta,
          p_caminho: caminho,
          p_tamanho: tamanho,
          p_tipo: tipo,
        },
      );
      lancarSeErro(error, "arquivo_preparar_envio");
      if (data === "ja_confirmado") return { situacao: "ja_confirmado" };
      if (data !== "enviar") {
        throw new Error("arquivo_preparar_envio: resposta inesperada");
      }
    }
    const url = await deps.r2.urlAssinada("PUT", chave, VALIDADE_ENVIO, {
      "content-type": tipo,
      "content-length": String(tamanho),
    });
    return {
      situacao: "enviar",
      url,
      metodo: "PUT",
      cabecalhos: { "content-type": tipo },
      expira_em: expiraEm(VALIDADE_ENVIO),
    };
  }

  async function confirmar(c: Chamador, corpo: Record<string, unknown>) {
    const { pasta, caminho, chave } = chaveDe(corpo.pasta, corpo.caminho);
    const cab = await deps.r2.cabecalho(chave);
    if (cab === null) throw new ErroHttp(404, "nao_encontrado");
    if (c.interno) {
      const { error } = await deps.admin.rpc("arquivo_registrar_servico", {
        p_pasta: pasta,
        p_caminho: caminho,
        p_tamanho: cab.tamanho,
        p_tipo: cab.tipo,
      });
      lancarSeErro(error, "arquivo_registrar_servico");
      return { situacao: "confirmado" };
    }
    const { data, error } = await deps.admin.rpc("arquivo_confirmar", {
      p_pasta: pasta,
      p_caminho: caminho,
      p_tamanho: cab.tamanho,
      p_tipo: cab.tipo,
      p_autor: c.uid,
    });
    lancarSeErro(error, "arquivo_confirmar");
    if (data === "confirmado") return { situacao: "confirmado" };
    if (data === "divergente") throw new ErroHttp(409, "divergente");
    if (data === "nao_encontrado") {
      // Confirmar de novo (resposta anterior perdida) não é erro: se a linha já está
      // confirmada e o usuário pode lê-la, devolve confirmado.
      const lido = await deps.clienteUsuario(c.jwt).rpc("arquivo_pode_ler", {
        p_itens: [{ pasta, caminho }],
      });
      lancarSeErro(lido.error, "arquivo_pode_ler");
      if (Array.isArray(lido.data) && lido.data.length > 0) {
        return { situacao: "confirmado" };
      }
      throw new ErroHttp(404, "nao_encontrado");
    }
    throw new Error("arquivo_confirmar: resposta inesperada");
  }

  async function ler(c: Chamador, corpo: Record<string, unknown>) {
    const itens = corpo.itens;
    if (!Array.isArray(itens)) throw new ErroHttp(400, "entrada_invalida");
    if (itens.length > MAX_ITENS_LEITURA) {
      throw new ErroHttp(400, "fora_do_limite");
    }
    const pedidos = itens.map((i) => {
      if (typeof i !== "object" || i === null) {
        throw new ErroHttp(400, "entrada_invalida");
      }
      const { pasta, caminho, chave } = chaveDe(
        (i as Record<string, unknown>).pasta,
        (i as Record<string, unknown>).caminho,
      );
      return { pasta, caminho, chave };
    });

    let permitidos = pedidos;
    if (!c.interno) {
      const { data, error } = await deps.clienteUsuario(c.jwt).rpc(
        "arquivo_pode_ler",
        {
          p_itens: pedidos.map((p) => ({ pasta: p.pasta, caminho: p.caminho })),
        },
      );
      lancarSeErro(error, "arquivo_pode_ler");
      if (!Array.isArray(data)) {
        throw new Error("arquivo_pode_ler: resposta inesperada");
      }
      // Só vale o que o banco devolveu e que foi pedido (a chave vem do pedido validado).
      const liberados = new Set(
        data.map((d) => `${d?.pasta}/${d?.caminho}`),
      );
      permitidos = pedidos.filter((p) => liberados.has(p.chave));
    }

    const urls: Record<string, string> = {};
    let menor = VALIDADE_ORGANIZACAO;
    for (const p of permitidos) {
      const segundos = p.pasta === "organizacao"
        ? VALIDADE_ORGANIZACAO
        : VALIDADE_LEITURA;
      menor = Math.min(menor, segundos);
      urls[p.chave] = await deps.r2.urlAssinada("GET", p.chave, segundos);
    }
    return { urls, expira_em: expiraEm(menor) };
  }

  async function excluir(c: Chamador, corpo: Record<string, unknown>) {
    const { pasta, caminho, chave } = chaveDe(corpo.pasta, corpo.caminho);
    if (!c.interno) {
      const { error } = await deps.clienteUsuario(c.jwt).rpc(
        "arquivo_marcar_exclusao",
        { p_pasta: pasta, p_caminho: caminho },
      );
      lancarSeErro(error, "arquivo_marcar_exclusao");
    }
    const id = await deps.idDoArquivo(pasta, caminho);
    await deps.r2.apagar([chave]);
    if (id !== null) {
      const { error } = await deps.admin.rpc("arquivo_remover", {
        p_ids: [id],
      });
      lancarSeErro(error, "arquivo_remover");
    }
    return { situacao: "excluido" };
  }

  async function manutencao(c: Chamador) {
    if (!c.interno) throw new ErroHttp(403, "sem_permissao");

    // 1. Fila: o que está marcado para excluir ou pendente há mais de 7 dias.
    let removidos = 0;
    for (let rodada = 0; rodada < MAX_RODADAS_FILA; rodada++) {
      const { data, error } = await deps.admin.rpc("arquivo_fila_manutencao", {
        p_limite: LOTE_FILA,
      });
      lancarSeErro(error, "arquivo_fila_manutencao");
      const fila = (Array.isArray(data) ? data : []) as {
        id: number;
        pasta: string;
        caminho: string;
      }[];
      if (fila.length === 0) break;
      const chaves: string[] = [];
      for (const l of fila) {
        try {
          chaves.push(chaveObjeto(l.pasta, l.caminho));
        } catch {
          // Linha com chave inaceitável: não há objeto a apagar, só a linha.
        }
      }
      await deps.r2.apagar(chaves);
      const { error: eRem } = await deps.admin.rpc("arquivo_remover", {
        p_ids: fila.map((l) => l.id),
      });
      lancarSeErro(eRem, "arquivo_remover");
      removidos += fila.length;
      if (fila.length < LOTE_FILA) break;
    }

    // 2. Objetos do bucket sem linha: só vão para `orfao_storage`, nunca são apagados.
    const orfaos: LinhaOrfao[] = [];
    let lote: { chave: string; tamanho: number }[] = [];
    const conferirLote = async () => {
      if (lote.length === 0) return;
      const { data, error } = await deps.admin.rpc("arquivo_sem_registro", {
        p_chaves: lote.map((o) => o.chave),
      });
      lancarSeErro(error, "arquivo_sem_registro");
      const sem = new Set(Array.isArray(data) ? data as string[] : []);
      for (const o of lote) {
        if (!sem.has(o.chave)) continue;
        const i = o.chave.indexOf("/");
        orfaos.push({
          bucket: i < 0 ? o.chave : o.chave.slice(0, i),
          caminho: i < 0 ? "" : o.chave.slice(i + 1),
          tamanho: o.tamanho,
        });
      }
      lote = [];
    };
    let continuacao: string | undefined;
    do {
      const pagina = await deps.r2.listar("", continuacao);
      for (const o of pagina.objetos) {
        lote.push(o);
        if (lote.length >= LOTE_SEM_REGISTRO) await conferirLote();
      }
      continuacao = pagina.proxima;
    } while (continuacao);
    await conferirLote();
    if (orfaos.length > 0) await deps.registrarSemRegistro(orfaos);

    return { removidos, sem_registro: orfaos.length };
  }

  return async (req: Request): Promise<Response> => {
    const cors = cabecalhosCors(
      req.headers.get("Origin"),
      deps.origensPermitidas,
    );
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (req.method !== "POST") {
      return json({ erro: "metodo_nao_permitido" }, 405, {
        ...cors,
        Allow: "POST, OPTIONS",
      });
    }

    try {
      const chamador = await identificar(req);

      let corpo: Record<string, unknown>;
      try {
        const b = await req.json();
        if (typeof b !== "object" || b === null || Array.isArray(b)) {
          throw new Error("corpo não é objeto");
        }
        corpo = b as Record<string, unknown>;
      } catch {
        throw new ErroHttp(400, "entrada_invalida");
      }

      switch (corpo.acao) {
        case "enviar":
          return json(await enviar(chamador, corpo), 200, cors);
        case "confirmar":
          return json(await confirmar(chamador, corpo), 200, cors);
        case "ler":
          return json(await ler(chamador, corpo), 200, cors);
        case "excluir":
          return json(await excluir(chamador, corpo), 200, cors);
        case "manutencao":
          return json(await manutencao(chamador), 200, cors);
        default:
          throw new ErroHttp(400, "entrada_invalida");
      }
    } catch (e) {
      if (e instanceof ErroHttp) {
        return json({ erro: e.codigo }, e.status, cors);
      }
      console.error(
        "armazenamento: falha:",
        e instanceof Error ? e.message : "erro desconhecido",
      );
      return json({ erro: "erro_interno" }, 500, cors);
    }
  };
}
