// Edge Function auth-telegram: troca o initData do Mini App por uma sessão Supabase.
import { createClient } from "npm:@supabase/supabase-js@2";
import { criarHandler, listarOrigens } from "./handler.ts";

const opcoes = { auth: { persistSession: false, autoRefreshToken: false } };

function criarCliente() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const chave = Deno.env.get("SUPABASE_SECRET_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, chave, opcoes);
}

const handler = criarHandler({
  botToken: Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "",
  origensPermitidas: listarOrigens(Deno.env.get("ALLOWED_ORIGINS")),
  admin: criarCliente(),
  criarClienteSessao: criarCliente,
});

Deno.serve(handler);
