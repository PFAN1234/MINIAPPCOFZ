// Lógica da Edge Function admin-excluir-obra, com dependências injetadas (testável sem rede).
// Exclui uma obra pelo site de administração (/admin/), no corpo JSON `{acao}`:
// - `excluir` `{slug, confirmacao}`: chama `admin_excluir_obra` como o admin (o banco confere
//   o admin e a confirmação, apaga as linhas e grava `obra_excluida`) e depois remove os
//   arquivos da obra no Storage com a chave secreta;
// - `limpar` `{exclusao_id}`: repete só a remoção dos arquivos (quando a primeira falhou).
// Os arquivos de todos os buckets ficam em `<obra_id>/...`; o resultado vai para
// `admin_registrar_limpeza`. O token nunca vai para o log.
import { cabecalhosCors, json } from "../_shared/http.ts";

export const BUCKETS = ["fotos", "plantas", "originais", "modelos"] as const;
export type Bucket = typeof BUCKETS[number];
export type Contagem = Record<Bucket, number>;

/** Itens por página no `list` e por chamada no `remove` do Storage. */
export const LOTE_LISTAGEM = 100;
export const LOTE_REMOCAO = 100;

export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ErroSupabase = { message: string; code?: string } | null;

export interface ClienteRpc {
  rpc(
    nome: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: ErroSupabase }>;
}

/** Item do `list` do Storage: pastas vêm com `id === null`. */
export interface ItemStorage {
  name: string;
  id: string | null;
}

export interface BucketStorage {
  list(
    prefixo: string,
    opcoes: { limit: number; offset: number; sortBy?: { column: string } },
  ): PromiseLike<
    { data: ItemStorage[] | null; error: { message: string } | null }
  >;
  remove(
    caminhos: string[],
  ): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
}

/** Cliente com a chave secreta: confere o JWT, chama RPCs da service role e mexe no Storage. */
export interface ClienteServico extends ClienteRpc {
  auth: {
    getUser(jwt: string): Promise<{
      data: { user: { id: string } | null };
      error: { message: string } | null;
    }>;
  };
  storage: { from(bucket: string): BucketStorage };
}

export interface Deps {
  origensPermitidas: string[];
  admin: ClienteServico;
  /** Cliente que fala com o banco como o dono do JWT (auth.uid() e exigir_admin valem). */
  clienteUsuario: (jwt: string) => ClienteRpc;
}

class ErroLimpeza extends Error {}

function bearer(req: Request): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("Authorization") ?? "");
  return m ? m[1] : null;
}

function zerada(): Contagem {
  return { fotos: 0, plantas: 0, originais: 0, modelos: 0 };
}

/** Todos os caminhos de arquivos sob `prefixo`, descendo nas pastas (listagem paginada). */
export async function listarRecursivo(
  bucket: BucketStorage,
  prefixo: string,
): Promise<string[]> {
  const arquivos: string[] = [];
  const pastas = [prefixo];
  while (pastas.length > 0) {
    const pasta = pastas.pop()!;
    for (let offset = 0;; offset += LOTE_LISTAGEM) {
      const { data, error } = await bucket.list(pasta, {
        limit: LOTE_LISTAGEM,
        offset,
        sortBy: { column: "name" },
      });
      if (error) throw new ErroLimpeza(error.message);
      const itens = data ?? [];
      for (const item of itens) {
        const caminho = `${pasta}/${item.name}`;
        if (item.id === null) pastas.push(caminho);
        else arquivos.push(caminho);
      }
      if (itens.length < LOTE_LISTAGEM) break;
    }
  }
  return arquivos;
}

/**
 * Remove todos os arquivos `<obraId>/...` dos quatro buckets. Lista tudo antes de remover
 * (a paginação por offset não muda no meio). Um bucket com falha não impede os outros; o
 * erro descreve os que falharam e `removidos` conta o que já saiu.
 */
export async function removerArquivos(
  admin: ClienteServico,
  obraId: string,
): Promise<{ removidos: Contagem; erro: string | null }> {
  // Guarda contra prefixo vazio ou estranho: nunca listar a raiz de um bucket.
  if (!UUID.test(obraId)) throw new Error("obra_id inválido");
  const removidos = zerada();
  const falhas: string[] = [];
  for (const nome of BUCKETS) {
    const bucket = admin.storage.from(nome);
    try {
      const caminhos = await listarRecursivo(bucket, obraId);
      for (let i = 0; i < caminhos.length; i += LOTE_REMOCAO) {
        const lote = caminhos.slice(i, i + LOTE_REMOCAO);
        const { data, error } = await bucket.remove(lote);
        if (error) throw new ErroLimpeza(error.message);
        removidos[nome] += Array.isArray(data) ? data.length : lote.length;
      }
    } catch (e) {
      falhas.push(
        `${nome} (${
          e instanceof ErroLimpeza ? e.message : "erro desconhecido"
        })`,
      );
    }
  }
  if (falhas.length === 0) return { removidos, erro: null };
  return {
    removidos,
    erro: `Falha ao remover arquivos do Storage: ${falhas.join("; ")}`.slice(
      0,
      500,
    ),
  };
}

const NAO_AUTORIZADO = { erro: "Não autorizado" };
const ACESSO_NEGADO = { erro: "Acesso negado" };
const CORPO_INVALIDO = { erro: "Corpo inválido" };
const NAO_ENCONTRADA = { erro: "Obra não encontrada" };
const ERRO_INTERNO = { erro: "Erro interno" };

export function criarHandler(deps: Deps) {
  /** Usuário do JWT (validado pelo Auth com a chave secreta), ou null. */
  async function usuarioDe(jwt: string | null): Promise<string | null> {
    if (!jwt) return null;
    const { data, error } = await deps.admin.auth.getUser(jwt);
    return error ? null : data?.user?.id ?? null;
  }

  /** Remove os arquivos e registra o resultado; monta a parte comum da resposta. */
  async function limparERegistrar(exclusaoId: string, obraId: string) {
    const { removidos, erro } = await removerArquivos(deps.admin, obraId);
    const { error } = await deps.admin.rpc("admin_registrar_limpeza", {
      p_id: exclusaoId,
      p_removidos: removidos,
      p_erro: erro,
    });
    let falha = erro;
    if (error) {
      console.error(
        `admin-excluir-obra: admin_registrar_limpeza: ${error.message}`,
      );
      falha ??=
        "Os arquivos foram removidos, mas não foi possível registrar a limpeza. Tente de novo.";
    }
    if (erro) {
      console.warn(`admin-excluir-obra: limpeza incompleta (${exclusaoId})`);
    }
    return {
      arquivos_removidos: removidos,
      pendente: falha !== null,
      ...(falha !== null ? { erro: falha } : {}),
    };
  }

  async function excluir(
    jwt: string,
    corpo: Record<string, unknown>,
    cors: Record<string, string>,
  ) {
    const { slug, confirmacao } = corpo;
    if (
      typeof slug !== "string" || slug === "" ||
      typeof confirmacao !== "string"
    ) {
      return json(CORPO_INVALIDO, 400, cors);
    }
    const { data, error } = await deps.clienteUsuario(jwt).rpc(
      "admin_excluir_obra",
      { p_slug: slug, p_confirmacao: confirmacao },
    );
    if (error) {
      switch (error.code) {
        case "28000":
          return json(NAO_AUTORIZADO, 401, cors);
        case "42501":
          return json(ACESSO_NEGADO, 403, cors);
        case "22023":
          return json({ erro: error.message }, 400, cors);
        case "P0002":
          return json(NAO_ENCONTRADA, 404, cors);
        default:
          throw new Error(`admin_excluir_obra: ${error.message}`);
      }
    }
    const r = (data ?? {}) as Record<string, unknown>;
    if (
      typeof r.exclusao_id !== "string" || typeof r.obra_id !== "string" ||
      !UUID.test(r.obra_id)
    ) {
      throw new Error("admin_excluir_obra: resposta inesperada");
    }
    const limpeza = await limparERegistrar(r.exclusao_id, r.obra_id);
    return json(
      {
        ok: true,
        exclusao_id: r.exclusao_id,
        obra_id: r.obra_id,
        resumo: r.resumo ?? null,
        ...limpeza,
      },
      200,
      cors,
    );
  }

  async function limpar(
    jwt: string,
    corpo: Record<string, unknown>,
    cors: Record<string, string>,
  ) {
    const { exclusao_id: exclusaoId } = corpo;
    if (typeof exclusaoId !== "string" || !UUID.test(exclusaoId)) {
      return json(CORPO_INVALIDO, 400, cors);
    }
    const { data: ehAdmin, error } = await deps.clienteUsuario(jwt).rpc(
      "sou_admin",
    );
    if (error) {
      if (error.code === "28000") return json(NAO_AUTORIZADO, 401, cors);
      throw new Error(`sou_admin: ${error.message}`);
    }
    if (ehAdmin !== true) return json(ACESSO_NEGADO, 403, cors);

    const { data: obraId, error: eObra } = await deps.admin.rpc(
      "admin_exclusao_para_limpar",
      { p_id: exclusaoId },
    );
    if (eObra) {
      if (eObra.code === "P0002") {
        return json({ erro: "Exclusão não encontrada" }, 404, cors);
      }
      throw new Error(`admin_exclusao_para_limpar: ${eObra.message}`);
    }
    if (typeof obraId !== "string" || !UUID.test(obraId)) {
      throw new Error("admin_exclusao_para_limpar: resposta inesperada");
    }
    const limpeza = await limparERegistrar(exclusaoId, obraId);
    return json(
      { ok: true, exclusao_id: exclusaoId, obra_id: obraId, ...limpeza },
      200,
      cors,
    );
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
      return json({ erro: "Método não permitido" }, 405, {
        ...cors,
        Allow: "POST, OPTIONS",
      });
    }

    try {
      const jwt = bearer(req);
      if (!jwt || !(await usuarioDe(jwt))) {
        return json(NAO_AUTORIZADO, 401, cors);
      }

      let corpo: Record<string, unknown>;
      try {
        const c = await req.json();
        if (typeof c !== "object" || c === null || Array.isArray(c)) {
          throw new Error("corpo não é objeto");
        }
        corpo = c as Record<string, unknown>;
      } catch {
        return json(CORPO_INVALIDO, 400, cors);
      }

      switch (corpo.acao) {
        case "excluir":
          return await excluir(jwt, corpo, cors);
        case "limpar":
          return await limpar(jwt, corpo, cors);
        default:
          return json(CORPO_INVALIDO, 400, cors);
      }
    } catch (e) {
      console.error(
        "admin-excluir-obra: falha:",
        e instanceof Error ? e.message : "erro desconhecido",
      );
      return json(ERRO_INTERNO, 500, cors);
    }
  };
}
