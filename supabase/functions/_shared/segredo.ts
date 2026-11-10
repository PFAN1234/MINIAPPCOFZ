// Segredo interno (cron → função, SQL → bot, webhook do Telegram), guardado no Vault
// e lido por RPC restrita à service role. Cache em memória de 5 min.
import { igualConstante } from "./init_data.ts";

export const TTL_CACHE_MS = 5 * 60 * 1000;
export const CABECALHO_SEGREDO_INTERNO = "x-segredo-interno";

export interface ClienteRpc {
  rpc(
    nome: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export interface Segredos {
  /** Segredo interno, ou `null` se não existir ou a leitura falhar. */
  interno(): Promise<string | null>;
  /** `hex(HMAC_SHA256(key = segredo_interno, msg = "telegram-webhook"))`. */
  secretTokenWebhook(): Promise<string | null>;
  /** O pedido traz `x-segredo-interno` igual ao segredo interno? */
  conferirInterno(req: Request): Promise<boolean>;
  /** O valor do cabeçalho do webhook do Telegram confere? */
  conferirWebhook(valor: string | null): Promise<boolean>;
}

const encoder = new TextEncoder();

export async function derivarSecretTokenWebhook(
  segredoInterno: string,
): Promise<string> {
  const chave = await crypto.subtle.importKey(
    "raw",
    encoder.encode(segredoInterno),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const assinatura = new Uint8Array(
    await crypto.subtle.sign("HMAC", chave, encoder.encode("telegram-webhook")),
  );
  return Array.from(assinatura, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function criarSegredos(
  admin: ClienteRpc,
  agora: () => number = () => Date.now(),
): Segredos {
  let cache: { valor: string; expira: number } | null = null;

  const interno = async (): Promise<string | null> => {
    if (cache && cache.expira > agora()) return cache.valor;
    try {
      const { data, error } = await admin.rpc("segredo_interno");
      if (error || typeof data !== "string" || data === "") return null;
      cache = { valor: data, expira: agora() + TTL_CACHE_MS };
      return data;
    } catch {
      return null;
    }
  };

  const secretTokenWebhook = async () => {
    const s = await interno();
    return s === null ? null : await derivarSecretTokenWebhook(s);
  };

  return {
    interno,
    secretTokenWebhook,
    async conferirInterno(req) {
      const recebido = req.headers.get(CABECALHO_SEGREDO_INTERNO);
      const s = await interno();
      if (recebido === null || s === null) return false;
      return igualConstante(recebido, s);
    },
    async conferirWebhook(valor) {
      const esperado = await secretTokenWebhook();
      if (valor === null || esperado === null) return false;
      return igualConstante(valor, esperado);
    },
  };
}
