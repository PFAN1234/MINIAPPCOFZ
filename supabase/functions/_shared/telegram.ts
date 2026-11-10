// Cliente mínimo da Bot API do Telegram (só `fetch`, sem dependências).
// O token vai na URL da Bot API: por isso a URL nunca é logada nem devolvida em erros.

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export type ResultadoTelegram<T = unknown> =
  | { tipo: "ok"; resultado: T }
  | {
    tipo: "http";
    status: number;
    description: string;
    retryAfter?: number;
  }
  | { tipo: "rede"; motivo: "timeout" | "falha" };

export interface OpcoesChamada {
  timeoutMs?: number;
}

export interface ClienteTelegram {
  chamar<T = unknown>(
    metodo: string,
    corpo?: Record<string, unknown> | FormData,
    opcoes?: OpcoesChamada,
  ): Promise<ResultadoTelegram<T>>;
}

export const TIMEOUT_PADRAO_MS = 30_000;

export function criarClienteTelegram(
  token: string,
  fetchFn: FetchFn = (i, init) => fetch(i, init),
  timeoutPadraoMs: number = TIMEOUT_PADRAO_MS,
): ClienteTelegram {
  return {
    async chamar<T = unknown>(
      metodo: string,
      corpo: Record<string, unknown> | FormData = {},
      opcoes: OpcoesChamada = {},
    ): Promise<ResultadoTelegram<T>> {
      const url = `https://api.telegram.org/bot${token}/${metodo}`;
      const init: RequestInit = {
        method: "POST",
        signal: AbortSignal.timeout(opcoes.timeoutMs ?? timeoutPadraoMs),
      };
      if (corpo instanceof FormData) {
        init.body = corpo;
      } else {
        init.headers = { "Content-Type": "application/json" };
        init.body = JSON.stringify(corpo);
      }

      let resposta: Response;
      let json: unknown = null;
      try {
        resposta = await fetchFn(url, init);
        json = await resposta.json().catch(() => null);
      } catch (e) {
        // Sem a mensagem do erro: ela pode conter a URL (e, nela, o token).
        const nome = e instanceof Error ? e.name : "";
        return {
          tipo: "rede",
          motivo: nome === "TimeoutError" || nome === "AbortError"
            ? "timeout"
            : "falha",
        };
      }

      const corpoApi = (json && typeof json === "object" ? json : {}) as {
        ok?: boolean;
        result?: T;
        description?: string;
        error_code?: number;
        parameters?: { retry_after?: number };
      };
      if (resposta.ok && corpoApi.ok === true) {
        return { tipo: "ok", resultado: corpoApi.result as T };
      }
      const status = resposta.ok
        ? (corpoApi.error_code ?? 400)
        : resposta.status;
      const retryAfter = corpoApi.parameters?.retry_after;
      return {
        tipo: "http",
        status,
        description: typeof corpoApi.description === "string"
          ? corpoApi.description
          : "",
        ...(typeof retryAfter === "number" ? { retryAfter } : {}),
      };
    },
  };
}

/** Link do Mini App: https://t.me/<bot>/<app>, com `?startapp=<param>` se houver. */
export function linkApp(
  botUsername: string,
  appName: string,
  startapp?: string,
): string {
  const base = `https://t.me/${botUsername}/${appName}`;
  return startapp ? `${base}?startapp=${startapp}` : base;
}

/** Escapa texto para `parse_mode: "HTML"`. */
export function escaparHtml(texto: string): string {
  return texto.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(
    ">",
    "&gt;",
  );
}
