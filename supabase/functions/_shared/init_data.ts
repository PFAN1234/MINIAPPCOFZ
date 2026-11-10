// Validação do initData do Telegram Mini App (só Web Crypto, sem dependências).
// Segue https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
//
// Método por hash: o data_check_string contém todos os campos recebidos, exceto
// `hash`, em ordem alfabética, no formato `chave=valor`, unidos por "\n".
// O campo `signature` (usado só na validação de terceiros, Ed25519) NÃO é
// excluído aqui: a documentação descreve `signature` como assinatura de todos os
// parâmetros "except hash", ou seja, ele faz parte do que o Telegram assina por hash.

export interface UsuarioTelegram {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

export type ResultadoInitData =
  | { ok: true; usuario: UsuarioTelegram; authDate: Date }
  | { ok: false; motivo: string };

export const IDADE_MAXIMA_MS = 24 * 60 * 60 * 1000;
export const FUTURO_MAXIMO_MS = 5 * 60 * 1000;

const encoder = new TextEncoder();

async function hmacSha256(
  chave: Uint8Array,
  mensagem: Uint8Array,
): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey(
    "raw",
    chave as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", k, mensagem as BufferSource),
  );
}

function paraHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Comparação em tempo constante (em relação ao conteúdo) de duas strings. */
export function igualConstante(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let dif = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) dif |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return dif === 0;
}

/** Monta o data_check_string a partir dos campos (sem `hash`). */
export function montarDataCheckString(params: URLSearchParams): string {
  const pares: [string, string][] = [];
  for (const [k, v] of params.entries()) {
    if (k !== "hash") pares.push([k, v]);
  }
  pares.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return pares.map(([k, v]) => `${k}=${v}`).join("\n");
}

/** Calcula o hash hexadecimal esperado para os campos dados. */
export async function calcularHash(
  params: URLSearchParams,
  botToken: string,
): Promise<string> {
  const segredo = await hmacSha256(
    encoder.encode("WebAppData"),
    encoder.encode(botToken),
  );
  const assinatura = await hmacSha256(
    segredo,
    encoder.encode(montarDataCheckString(params)),
  );
  return paraHex(assinatura);
}

export async function validarInitData(
  initData: string,
  botToken: string,
  agora: Date = new Date(),
): Promise<ResultadoInitData> {
  if (typeof initData !== "string" || initData === "") {
    return { ok: false, motivo: "initData vazio" };
  }
  if (!botToken) return { ok: false, motivo: "token do bot ausente" };

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return { ok: false, motivo: "initData malformado" };
  }

  const hashRecebido = params.get("hash");
  if (!hashRecebido) return { ok: false, motivo: "hash ausente" };

  const hashEsperado = await calcularHash(params, botToken);
  if (!igualConstante(hashEsperado, hashRecebido.toLowerCase())) {
    return { ok: false, motivo: "hash inválido" };
  }

  const authBruto = params.get("auth_date");
  if (!authBruto || !/^\d+$/.test(authBruto)) {
    return { ok: false, motivo: "auth_date ausente ou inválido" };
  }
  const authDate = new Date(Number(authBruto) * 1000);
  const diff = agora.getTime() - authDate.getTime();
  if (diff > IDADE_MAXIMA_MS) {
    return { ok: false, motivo: "auth_date expirado" };
  }
  if (diff < -FUTURO_MAXIMO_MS) {
    return { ok: false, motivo: "auth_date no futuro" };
  }

  const userBruto = params.get("user");
  if (!userBruto) return { ok: false, motivo: "user ausente" };
  let user: unknown;
  try {
    user = JSON.parse(userBruto);
  } catch {
    return { ok: false, motivo: "user não é JSON" };
  }
  if (typeof user !== "object" || user === null) {
    return { ok: false, motivo: "user inválido" };
  }
  const u = user as Record<string, unknown>;
  if (typeof u.id !== "number" || !Number.isSafeInteger(u.id) || u.id <= 0) {
    return { ok: false, motivo: "user.id ausente ou inválido" };
  }
  if (typeof u.first_name !== "string") {
    return { ok: false, motivo: "user.first_name ausente" };
  }

  const usuario: UsuarioTelegram = { id: u.id, first_name: u.first_name };
  if (typeof u.last_name === "string" && u.last_name !== "") {
    usuario.last_name = u.last_name;
  }
  if (typeof u.username === "string" && u.username !== "") {
    usuario.username = u.username;
  }
  return { ok: true, usuario, authDate };
}
