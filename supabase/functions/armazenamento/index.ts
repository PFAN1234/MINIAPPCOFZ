// Edge Function armazenamento: URLs assinadas do Cloudflare R2 (envio, leitura), confirmação,
// exclusão e manutenção diária dos arquivos. Modo usuário (Bearer JWT) ou interno (cron).
import { createClient } from "npm:@supabase/supabase-js@2";
import { listarOrigens } from "../_shared/http.ts";
import { configDoAmbiente, criarR2 } from "../_shared/r2.ts";
import { criarSegredos } from "../_shared/segredo.ts";
import { criarHandler } from "./handler.ts";

const opcoes = { auth: { persistSession: false, autoRefreshToken: false } };
const url = Deno.env.get("SUPABASE_URL")!;

const admin = createClient(
  url,
  Deno.env.get("SUPABASE_SECRET_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  opcoes,
);

/** Cliente com a chave pública e o JWT do usuário: o banco vê auth.uid() dele. */
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
  admin,
  clienteUsuario: criarClienteUsuario,
  segredos: criarSegredos(admin),
  r2: criarR2(configDoAmbiente((n) => Deno.env.get(n))),
  async idDoArquivo(pasta, caminho) {
    const { data, error } = await admin.from("arquivo").select("id")
      .eq("pasta", pasta).eq("caminho", caminho).maybeSingle();
    if (error) throw new Error(`arquivo: ${error.message}`);
    return data ? Number(data.id) : null;
  },
  async registrarSemRegistro(linhas) {
    const { error } = await admin.from("orfao_storage").upsert(
      linhas.map((l) => ({ ...l, origem: "sem_registro" })),
      { onConflict: "bucket,caminho", ignoreDuplicates: true },
    );
    if (error) throw new Error(`orfao_storage: ${error.message}`);
  },
});

Deno.serve(handler);
