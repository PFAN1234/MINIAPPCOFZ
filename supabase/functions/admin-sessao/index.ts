// Edge Function admin-sessao: entrada no site de administração (/admin/).
import { createClient } from "npm:@supabase/supabase-js@2";
import { listarOrigens } from "../_shared/http.ts";
import { criarHandler } from "./handler.ts";

const opcoes = { auth: { persistSession: false, autoRefreshToken: false } };

function criarCliente() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const chave = Deno.env.get("SUPABASE_SECRET_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, chave, opcoes);
}

function urlAdmin(valor: string | undefined): string {
  const base = (valor ?? "").trim() || "https://miniappcofz.vercel.app/admin/";
  return base.endsWith("/") ? base : `${base}/`;
}

const handler = criarHandler({
  botToken: Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "",
  origensPermitidas: listarOrigens(
    Deno.env.get("ALLOWED_ORIGINS") ?? "https://miniappcofz.vercel.app",
  ),
  urlAdmin: urlAdmin(Deno.env.get("ADMIN_URL")),
  admin: criarCliente(),
  criarClienteSessao: criarCliente,
});

Deno.serve(handler);
