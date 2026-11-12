// Edge Function admin-excluir-obra: exclui uma obra (banco e arquivos do Storage) pelo site
// de administração (/admin/).
import { createClient } from "npm:@supabase/supabase-js@2";
import { listarOrigens } from "../_shared/http.ts";
import { criarHandler } from "./handler.ts";

const opcoes = { auth: { persistSession: false, autoRefreshToken: false } };
const url = Deno.env.get("SUPABASE_URL")!;

function criarClienteServico() {
  const chave = Deno.env.get("SUPABASE_SECRET_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, chave, opcoes);
}

/** Cliente com a chave pública e o JWT do admin: o banco vê auth.uid() dele. */
function criarClienteUsuario(jwt: string) {
  const chave = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
    Deno.env.get("SUPABASE_ANON_KEY")!;
  return createClient(url, chave, {
    ...opcoes,
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

const handler = criarHandler({
  origensPermitidas: listarOrigens(
    Deno.env.get("ALLOWED_ORIGINS") ?? "https://miniappcofz.vercel.app",
  ),
  admin: criarClienteServico(),
  clienteUsuario: criarClienteUsuario,
});

Deno.serve(handler);
