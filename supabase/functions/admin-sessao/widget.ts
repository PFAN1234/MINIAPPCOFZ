// Validação dos dados do Telegram Login Widget (só Web Crypto, sem dependências).
// Segue https://core.telegram.org/widgets/login#checking-authorization
//
// data_check_string: todos os campos recebidos, exceto `hash`, em ordem alfabética, no
// formato `chave=valor`, unidos por "\n". Chave secreta: SHA-256 do token do bot (bytes,
// não hex). Hash esperado: hex(HMAC-SHA-256(chave secreta, data_check_string)).
// Diferente do Mini App (initData), aqui não há a etapa com "WebAppData".
import { igualConstante } from "../_shared/init_data.ts";

export interface UsuarioWidget {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

export type ResultadoWidget =
  | { ok: true; usuario: UsuarioWidget; authDate: Date }
  | { ok: false; motivo: string };

export const IDADE_MAXIMA_WIDGET_MS = 24 * 60 * 60 * 1000;
export const FUTURO_MAXIMO_WIDGET_MS = 5 * 60 * 1000;

const encoder = new TextEncoder();

function paraHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Campos como texto (sem `hash`), na forma que o Telegram assina. */
function camposTexto(
  dados: Record<string, unknown>,
): [string, string][] | null {
  const pares: [string, string][] = [];
  for (const [k, v] of Object.entries(dados)) {
    if (k === "hash" || v === undefined || v === null) continue;
    if (typeof v === "string") pares.push([k, v]);
    else if (typeof v === "number" && Number.isFinite(v)) {
      pares.push([k, String(v)]);
    } else return null;
  }
  return pares;
}

export function montarDataCheckStringWidget(
  dados: Record<string, unknown>,
): string | null {
  const pares = camposTexto(dados);
  if (pares === null) return null;
  pares.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return pares.map(([k, v]) => `${k}=${v}`).join("\n");
}

/** hash hexadecimal que o Telegram calcularia para estes campos. */
export async function calcularHashWidget(
  dados: Record<string, unknown>,
  botToken: string,
): Promise<string | null> {
  const dcs = montarDataCheckStringWidget(dados);
  if (dcs === null) return null;
  const segredo = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(botToken)),
  );
  const chave = await crypto.subtle.importKey(
    "raw",
    segredo,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return paraHex(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", chave, encoder.encode(dcs)),
    ),
  );
}

export async function validarLoginWidget(
  dados: unknown,
  botToken: string,
  agora: Date = new Date(),
): Promise<ResultadoWidget> {
  if (!botToken) return { ok: false, motivo: "token do bot ausente" };
  if (typeof dados !== "object" || dados === null || Array.isArray(dados)) {
    return { ok: false, motivo: "dados ausentes" };
  }
  const d = dados as Record<string, unknown>;
  if (typeof d.hash !== "string" || d.hash === "") {
    return { ok: false, motivo: "hash ausente" };
  }
  const esperado = await calcularHashWidget(d, botToken);
  if (esperado === null) {
    return { ok: false, motivo: "campo com tipo inválido" };
  }
  if (!igualConstante(esperado, d.hash.toLowerCase())) {
    return { ok: false, motivo: "hash inválido" };
  }

  const auth = typeof d.auth_date === "number"
    ? d.auth_date
    : typeof d.auth_date === "string" && /^\d+$/.test(d.auth_date)
    ? Number(d.auth_date)
    : NaN;
  if (!Number.isSafeInteger(auth) || auth <= 0) {
    return { ok: false, motivo: "auth_date ausente ou inválido" };
  }
  const authDate = new Date(auth * 1000);
  const diff = agora.getTime() - authDate.getTime();
  if (diff > IDADE_MAXIMA_WIDGET_MS) {
    return { ok: false, motivo: "auth_date expirado" };
  }
  if (diff < -FUTURO_MAXIMO_WIDGET_MS) {
    return { ok: false, motivo: "auth_date no futuro" };
  }

  const id = typeof d.id === "number"
    ? d.id
    : typeof d.id === "string" && /^\d+$/.test(d.id)
    ? Number(d.id)
    : NaN;
  if (!Number.isSafeInteger(id) || id <= 0) {
    return { ok: false, motivo: "id ausente ou inválido" };
  }
  if (typeof d.first_name !== "string") {
    return { ok: false, motivo: "first_name ausente" };
  }
  const usuario: UsuarioWidget = { id, first_name: d.first_name };
  if (typeof d.last_name === "string" && d.last_name !== "") {
    usuario.last_name = d.last_name;
  }
  if (typeof d.username === "string" && d.username !== "") {
    usuario.username = d.username;
  }
  return { ok: true, usuario, authDate };
}
