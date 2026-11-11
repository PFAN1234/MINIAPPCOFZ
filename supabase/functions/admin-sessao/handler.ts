// Lógica da Edge Function admin-sessao, com dependências injetadas (testável sem rede).
// Entrada no site de administração (/admin/) por três ações, no corpo JSON `{acao}`:
// - `criar`: o Mini App (JWT do usuário no Authorization) pede um link de uso único (2 min);
// - `trocar`: o site troca o token do link por uma sessão do mesmo usuário;
// - `widget`: o site troca os dados do Telegram Login Widget por uma sessão.
// Só admins do Mini App (tabela admin_app) recebem link ou sessão. Erros são genéricos.
import { cabecalhosCors, json } from "../_shared/http.ts";
import {
  type ClienteGerarLink,
  type ClienteSessao,
  emitirSessao,
} from "../_shared/sessao.ts";
import { validarLoginWidget } from "./widget.ts";

export const TOKEN_FORMATO = /^[A-Za-z0-9_-]{43}$/;

type ErroSupabase = { message: string; code?: string } | null;

export interface ClienteAdmin extends ClienteGerarLink {
  rpc(
    nome: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: ErroSupabase }>;
  auth: ClienteGerarLink["auth"] & {
    getUser(jwt: string): Promise<{
      data: { user: { id: string } | null };
      error: { message: string } | null;
    }>;
  };
}

export interface Deps {
  botToken: string;
  origensPermitidas: string[];
  /** Endereço do site, com barra final (ex.: https://miniappcofz.vercel.app/admin/). */
  urlAdmin: string;
  admin: ClienteAdmin;
  criarClienteSessao: () => ClienteSessao;
  agora?: () => Date;
  /** Token aleatório do link; padrão: 32 bytes em base64url. */
  gerarToken?: () => string;
}

interface UsuarioAdmin {
  usuario_id: string;
  email: string | null;
  nome: string;
  username: string | null;
}

/** 32 bytes aleatórios em base64url, sem `=` (43 caracteres). */
export function gerarTokenAleatorio(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-")
    .replaceAll("/", "_").replace(/=+$/, "");
}

/** SHA-256 em hexadecimal: é o que vai para o banco (o token em claro nunca vai). */
export async function sha256Hex(texto: string): Promise<string> {
  const d = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(texto),
  );
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function bearer(req: Request): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("Authorization") ?? "");
  return m ? m[1] : null;
}

function primeiraLinha(data: unknown): UsuarioAdmin | null {
  const linha = Array.isArray(data) ? data[0] : data;
  if (!linha || typeof linha !== "object") return null;
  const l = linha as Record<string, unknown>;
  if (typeof l.usuario_id !== "string") return null;
  return {
    usuario_id: l.usuario_id,
    email: typeof l.email === "string" ? l.email : null,
    nome: typeof l.nome === "string" ? l.nome : "",
    username: typeof l.username === "string" ? l.username : null,
  };
}

const NAO_AUTORIZADO = { erro: "Não autorizado" };
const ACESSO_NEGADO = { erro: "Acesso negado" };
const ERRO_INTERNO = { erro: "Erro interno" };

export function criarHandler(deps: Deps) {
  const gerarToken = deps.gerarToken ?? gerarTokenAleatorio;

  async function sessaoDe(u: UsuarioAdmin) {
    if (!u.email) throw new Error("usuário do Auth sem e-mail");
    const sessao = await emitirSessao(
      deps.admin,
      deps.criarClienteSessao,
      u.email,
    );
    return {
      ...sessao,
      usuario: { id: u.usuario_id, nome: u.nome, username: u.username },
    };
  }

  async function criar(req: Request, cors: Record<string, string>) {
    const jwt = bearer(req);
    if (!jwt) return json(ACESSO_NEGADO, 403, cors);
    const { data, error } = await deps.admin.auth.getUser(jwt);
    const id = data?.user?.id;
    if (error || !id) return json(ACESSO_NEGADO, 403, cors);

    const token = gerarToken();
    const { data: expira, error: eRpc } = await deps.admin.rpc(
      "admin_entrada_criar",
      { p_usuario: id, p_token_hash: await sha256Hex(token) },
    );
    if (eRpc) {
      if (eRpc.code === "42501") return json(ACESSO_NEGADO, 403, cors);
      throw new Error(`admin_entrada_criar: ${eRpc.message}`);
    }
    return json(
      { url: `${deps.urlAdmin}#entrar=${token}`, expira_em: expira },
      200,
      cors,
    );
  }

  async function trocar(token: unknown, cors: Record<string, string>) {
    if (typeof token !== "string") {
      return json({ erro: "Corpo inválido" }, 400, cors);
    }
    if (!TOKEN_FORMATO.test(token)) return json(NAO_AUTORIZADO, 401, cors);
    const { data, error } = await deps.admin.rpc("admin_entrada_consumir", {
      p_token_hash: await sha256Hex(token),
    });
    if (error) throw new Error(`admin_entrada_consumir: ${error.message}`);
    const u = primeiraLinha(data);
    // Inexistente, expirado, já usado ou não é mais admin: mesma resposta.
    if (!u) return json(NAO_AUTORIZADO, 401, cors);
    return json(await sessaoDe(u), 200, cors);
  }

  async function widget(dados: unknown, cors: Record<string, string>) {
    const v = await validarLoginWidget(
      dados,
      deps.botToken,
      deps.agora?.() ?? new Date(),
    );
    if (!v.ok) {
      console.warn(`admin-sessao: widget rejeitado (${v.motivo})`);
      return json(NAO_AUTORIZADO, 401, cors);
    }
    const { data, error } = await deps.admin.rpc("admin_por_telegram", {
      p_telegram_id: v.usuario.id,
    });
    if (error) throw new Error(`admin_por_telegram: ${error.message}`);
    const u = primeiraLinha(data);
    // Usuário inexistente ou que não é admin: mesma resposta (não cria usuário).
    if (!u) return json(ACESSO_NEGADO, 403, cors);
    return json(await sessaoDe(u), 200, cors);
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

    let corpo: Record<string, unknown>;
    try {
      const c = await req.json();
      if (typeof c !== "object" || c === null || Array.isArray(c)) {
        throw new Error("corpo não é objeto");
      }
      corpo = c as Record<string, unknown>;
    } catch {
      return json({ erro: "Corpo inválido" }, 400, cors);
    }

    try {
      switch (corpo.acao) {
        case "criar":
          return await criar(req, cors);
        case "trocar":
          return await trocar(corpo.token, cors);
        case "widget":
          return await widget(corpo.dados, cors);
        default:
          return json({ erro: "Corpo inválido" }, 400, cors);
      }
    } catch (e) {
      console.error(
        "admin-sessao: falha:",
        e instanceof Error ? e.message : "erro desconhecido",
      );
      return json(ERRO_INTERNO, 500, cors);
    }
  };
}
