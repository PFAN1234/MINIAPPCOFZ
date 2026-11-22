// Lógica da Edge Function admin-excluir-obra, com dependências injetadas (testável sem rede).
// Exclui uma obra pelo site de administração (/admin/), no corpo JSON `{acao}`:
// - `excluir` `{slug, confirmacao}`: chama `admin_excluir_obra` como o admin (o banco confere
//   o admin e a confirmação, apaga as linhas e grava `obra_excluida`) e depois remove os
//   arquivos da obra no R2 (linhas `excluir` de `arquivo`, apagadas com `arquivo_remover`);
// - `limpar` `{exclusao_id}`: repete só a remoção dos arquivos (quando a primeira falhou);
// - `excluir_etapa` `{slug, confirmacao}`: chama `admin_excluir_etapa` como o admin (apaga a
//   etapa e todas as obras dela, uma linha de `obra_excluida` por obra) e limpa o R2 de
//   cada exclusão devolvida, como em `excluir`;
// - `excluir_boletim` `{boletim_id}`: chama `admin_excluir_boletim` como o admin (apaga o dia
//   inteiro do boletim no banco e devolve as mensagens do Telegram e os arquivos da pasta
//   `boletins`, já marcados `excluir`); depois apaga as mensagens no grupo (`deleteMessage`) e remove os arquivos.
//   Falhas dessa limpeza não derrubam a resposta: viram contagem (`falhas`) e `arquivos_erro`.
// Os arquivos de todas as pastas ficam em `<obra_id>/...`; o resultado vai para
// `admin_registrar_limpeza`. O token nunca vai para o log.
import { cabecalhosCors, json } from "../_shared/http.ts";
import { chaveObjeto, type ClienteR2 } from "../_shared/r2.ts";
import type { ClienteTelegram } from "../_shared/telegram.ts";

export const BUCKETS = [
  "fotos",
  "plantas",
  "originais",
  "modelos",
  "documentos",
  "issues",
] as const;
export type Bucket = typeof BUCKETS[number];
export type Contagem = Record<Bucket, number>;

/** Linhas de `arquivo` lidas por consulta (e, portanto, chaves por chamada ao R2). */
export const LOTE_LEITURA = 1000;

export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ErroSupabase = { message: string; code?: string } | null;

export interface ClienteRpc {
  rpc(
    nome: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: ErroSupabase }>;
}

/** Cliente com a chave secreta: confere o JWT, chama RPCs da service role e lê `arquivo`. */
export interface ClienteServico extends ClienteRpc {
  auth: {
    getUser(jwt: string): Promise<{
      data: { user: { id: string } | null };
      error: { message: string } | null;
    }>;
  };
  // deno-lint-ignore no-explicit-any
  from(tabela: string): any;
}

export interface Deps {
  origensPermitidas: string[];
  admin: ClienteServico;
  /** Cloudflare R2: só a remoção de objetos é usada aqui. */
  r2: Pick<ClienteR2, "apagar">;
  /** Cliente que fala com o banco como o dono do JWT (auth.uid() e exigir_admin valem). */
  clienteUsuario: (jwt: string) => ClienteRpc;
  /** Bot do Telegram, para apagar as mensagens de um boletim excluído. */
  telegram: ClienteTelegram;
}

class ErroLimpeza extends Error {}

function bearer(req: Request): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("Authorization") ?? "");
  return m ? m[1] : null;
}

function zerada(): Contagem {
  return {
    fotos: 0,
    plantas: 0,
    originais: 0,
    modelos: 0,
    documentos: 0,
    issues: 0,
  };
}

/** Linha de `arquivo` marcada para exclusão. */
interface LinhaExcluir {
  id: number;
  pasta: string;
  caminho: string;
}

/**
 * Apaga no R2 as linhas `excluir` de `arquivo` que `filtrar` deixar passar e chama
 * `arquivo_remover` com os ids apagados. Lê em páginas por id (o que falhar fica `excluir`
 * para a `manutencao`, sem travar a leitura). Uma pasta com falha não impede as outras: o
 * erro descreve as que falharam e `removidos` conta o que já saiu.
 */
export async function removerLinhas(
  deps: Pick<Deps, "r2"> & { admin: ClienteServico },
  pastas: readonly string[],
  // deno-lint-ignore no-explicit-any
  filtrar: (consulta: any) => any,
): Promise<{ removidos: Contagem; erro: string | null }> {
  const removidos = zerada();
  const falhas = new Set<string>();
  let ultimo = 0;
  for (;;) {
    // deno-lint-ignore no-explicit-any
    let consulta: any = deps.admin.from("arquivo").select("id, pasta, caminho")
      .eq("situacao", "excluir").in("pasta", [...pastas]);
    consulta = filtrar(consulta).gt("id", ultimo).order("id", {
      ascending: true,
    }).limit(LOTE_LEITURA);
    const { data, error } = await consulta;
    if (error) {
      falhas.add(`leitura (${error.message})`);
      break;
    }
    const linhas = (data ?? []) as LinhaExcluir[];
    if (linhas.length === 0) break;
    ultimo = linhas[linhas.length - 1].id;
    const porPasta = new Map<string, LinhaExcluir[]>();
    for (const l of linhas) {
      porPasta.set(l.pasta, [...porPasta.get(l.pasta) ?? [], l]);
    }
    for (const [pasta, grupo] of porPasta) {
      try {
        await deps.r2.apagar(grupo.map((l) => chaveObjeto(l.pasta, l.caminho)));
        const { error: eRem } = await deps.admin.rpc("arquivo_remover", {
          p_ids: grupo.map((l) => l.id),
        });
        if (eRem) throw new ErroLimpeza(eRem.message);
        if (pasta in removidos) removidos[pasta as Bucket] += grupo.length;
      } catch (e) {
        falhas.add(
          `${pasta} (${
            e instanceof ErroLimpeza ? e.message : "erro desconhecido"
          })`,
        );
      }
    }
    if (linhas.length < LOTE_LEITURA) break;
  }
  if (falhas.size === 0) return { removidos, erro: null };
  return {
    removidos,
    erro: `Falha ao remover arquivos do R2: ${[...falhas].join("; ")}`.slice(
      0,
      500,
    ),
  };
}

/** Remove os arquivos `<obraId>/...` (linhas `excluir` já marcadas pelo banco). */
export function removerArquivos(
  deps: Pick<Deps, "r2"> & { admin: ClienteServico },
  obraId: string,
): Promise<{ removidos: Contagem; erro: string | null }> {
  // Guarda contra prefixo vazio ou estranho: nunca varrer além da obra.
  if (!UUID.test(obraId)) throw new Error("obra_id inválido");
  return removerLinhas(
    deps,
    BUCKETS,
    (q) => q.like("caminho", `${obraId}/%`),
  );
}

const NAO_AUTORIZADO = { erro: "Não autorizado" };
const ACESSO_NEGADO = { erro: "Acesso negado" };
const CORPO_INVALIDO = { erro: "Corpo inválido" };
const NAO_ENCONTRADA = { erro: "Obra não encontrada" };
const ETAPA_NAO_ENCONTRADA = { erro: "Etapa não encontrada" };
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
    const { removidos, erro } = await removerArquivos(deps, obraId);
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

  /** Limpeza de uma exclusão da etapa; uma falha não impede as outras. */
  async function limparExclusao(exclusaoId: string) {
    try {
      const { data: obraId, error } = await deps.admin.rpc(
        "admin_exclusao_para_limpar",
        { p_id: exclusaoId },
      );
      if (error) {
        throw new Error(`admin_exclusao_para_limpar: ${error.message}`);
      }
      if (typeof obraId !== "string" || !UUID.test(obraId)) {
        throw new Error("admin_exclusao_para_limpar: resposta inesperada");
      }
      const l = await limparERegistrar(exclusaoId, obraId);
      return {
        exclusao_id: exclusaoId,
        removidos: l.arquivos_removidos,
        pendente: l.pendente,
        erro: l.erro ?? null,
      };
    } catch (e) {
      console.error(
        `admin-excluir-obra: limpeza de ${exclusaoId} falhou:`,
        e instanceof Error ? e.message : "erro desconhecido",
      );
      return {
        exclusao_id: exclusaoId,
        removidos: zerada(),
        pendente: true,
        erro: "Não foi possível remover os arquivos desta obra. Tente de novo.",
      };
    }
  }

  async function excluirEtapa(
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
      "admin_excluir_etapa",
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
          return json(ETAPA_NAO_ENCONTRADA, 404, cors);
        default:
          throw new Error(`admin_excluir_etapa: ${error.message}`);
      }
    }
    const r = (data ?? {}) as Record<string, unknown>;
    const ids = r.exclusoes;
    if (
      !Array.isArray(ids) ||
      !ids.every((id) => typeof id === "string" && UUID.test(id))
    ) {
      throw new Error("admin_excluir_etapa: resposta inesperada");
    }
    const exclusoes = [];
    for (const id of ids as string[]) exclusoes.push(await limparExclusao(id));
    const pendentes = exclusoes.filter((x) => x.pendente).length;
    return json(
      {
        exclusoes,
        pendente: pendentes > 0,
        erro: pendentes > 0
          ? `Sobraram arquivos no R2 de ${pendentes} obra(s) excluída(s). Tente de novo em "Obras excluídas".`
          : null,
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

  async function excluirBoletim(
    jwt: string,
    corpo: Record<string, unknown>,
    cors: Record<string, string>,
  ) {
    const { boletim_id: boletimId } = corpo;
    if (typeof boletimId !== "string" || !UUID.test(boletimId)) {
      return json(CORPO_INVALIDO, 400, cors);
    }
    const { data, error } = await deps.clienteUsuario(jwt).rpc(
      "admin_excluir_boletim",
      { p_id: boletimId },
    );
    if (error) {
      switch (error.code) {
        case "28000":
          return json(NAO_AUTORIZADO, 401, cors);
        case "42501":
          return json(ACESSO_NEGADO, 403, cors);
        case "P0002":
          return json({ erro: "Boletim não encontrado." }, 404, cors);
        case "55006":
          return json({ erro: error.message }, 409, cors);
        case "22023":
          return json({ erro: error.message }, 400, cors);
        default:
          throw new Error(`admin_excluir_boletim: ${error.message}`);
      }
    }
    const r = (data ?? {}) as Record<string, unknown>;
    if (
      typeof r.numero !== "string" || typeof r.data !== "string" ||
      typeof r.revisoes !== "number" || !Array.isArray(r.mensagens) ||
      !Array.isArray(r.arquivos)
    ) {
      throw new Error("admin_excluir_boletim: resposta inesperada");
    }
    const mensagens = r.mensagens as (number | string)[];
    const arquivos = (r.arquivos as unknown[]).filter((a): a is string =>
      typeof a === "string" && a !== ""
    );
    const chatId = r.chat_id ?? null;

    // O boletim já saiu do banco: o que falhar daqui para a frente só é contado.
    let apagadas = 0;
    let falhas = 0;
    for (const messageId of mensagens) {
      if (chatId === null) {
        falhas++;
        continue;
      }
      try {
        const d = await deps.telegram.chamar("deleteMessage", {
          chat_id: chatId,
          message_id: messageId,
        });
        if (
          d.tipo === "ok" ||
          (d.tipo === "http" && d.status === 400 &&
            /not found/i.test(d.description))
        ) {
          apagadas++;
        } else {
          falhas++;
          console.warn(
            `admin-excluir-obra: mensagem ${messageId} do boletim não apagada (${
              d.tipo === "http" ? `${d.status}: ${d.description}` : d.motivo
            })`,
          );
        }
      } catch (e) {
        falhas++;
        console.warn(
          `admin-excluir-obra: mensagem ${messageId} do boletim sem resposta (${
            e instanceof Error ? e.name : "erro desconhecido"
          })`,
        );
      }
    }

    let arquivosErro: string | undefined;
    if (arquivos.length > 0) {
      try {
        const { erro } = await removerLinhas(
          deps,
          ["boletins"],
          (q) => q.in("caminho", arquivos),
        );
        if (erro) arquivosErro = erro;
      } catch (e) {
        arquivosErro = e instanceof Error ? e.message : "erro desconhecido";
      }
      if (arquivosErro !== undefined) {
        console.warn(
          `admin-excluir-obra: arquivos do boletim não removidos: ${arquivosErro}`,
        );
      }
    }

    return json(
      {
        ok: true,
        numero: r.numero,
        data: r.data,
        revisoes: r.revisoes,
        mensagens: { apagadas, falhas },
        ...(arquivosErro !== undefined ? { arquivos_erro: arquivosErro } : {}),
      },
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
        case "excluir_etapa":
          return await excluirEtapa(jwt, corpo, cors);
        case "excluir_boletim":
          return await excluirBoletim(jwt, corpo, cors);
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
