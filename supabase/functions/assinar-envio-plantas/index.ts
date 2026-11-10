// Edge Function assinar-envio-plantas: URLs assinadas para enviar as imagens das plantas.
// Acionada só por SQL (pg_net) com o segredo interno do Vault. Autocontida (sem _shared)
// para ser publicada com poucos arquivos.
import { createClient } from "npm:@supabase/supabase-js@2";
import { criarHandler } from "./handler.ts";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SECRET_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

async function resumo(texto: string): Promise<Uint8Array> {
  const dados = new TextEncoder().encode(texto);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", dados));
}

// Compara os resumos SHA-256 em tempo constante (tamanho fixo).
async function iguais(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([resumo(a), resumo(b)]);
  let dif = 0;
  for (let i = 0; i < x.length; i++) dif |= x[i] ^ y[i];
  return dif === 0;
}

const segredos = {
  async conferirInterno(req: Request): Promise<boolean> {
    const recebido = req.headers.get("x-segredo-interno");
    if (!recebido) return false;
    const { data, error } = await admin.rpc("segredo_interno");
    if (error || typeof data !== "string" || data === "") return false;
    return await iguais(recebido, data);
  },
};

Deno.serve(criarHandler({ admin, segredos }));
