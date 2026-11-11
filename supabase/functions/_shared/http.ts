// CORS e respostas JSON das Edge Functions chamadas pelo navegador (auth-telegram, admin-sessao).

/** Lista de origens a partir de `ALLOWED_ORIGINS` (separadas por vírgula). */
export function listarOrigens(valor: string | undefined): string[] {
  return (valor ?? "").split(",").map((s) => s.trim()).filter((s) => s !== "");
}

/** Cabeçalhos CORS: só ecoa a origem se ela estiver na lista. */
export function cabecalhosCors(
  origem: string | null,
  permitidas: string[],
): Record<string, string> {
  const h: Record<string, string> = { Vary: "Origin" };
  if (origem && permitidas.includes(origem)) {
    h["Access-Control-Allow-Origin"] = origem;
    h["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    h["Access-Control-Allow-Headers"] =
      "authorization, apikey, content-type, x-client-info";
    h["Access-Control-Max-Age"] = "86400";
  }
  return h;
}

export function json(
  corpo: unknown,
  status: number,
  cors: Record<string, string>,
): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
