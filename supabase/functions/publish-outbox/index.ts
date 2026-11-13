// Edge Function publish-outbox: publica no tópico do Telegram os registros e encerramentos
// pendentes, envia ao grupo da etapa os boletins emitidos (PDF) e avisa os pedidos de acesso.
// Acionada pelo cron e pelos gatilhos do banco.
import { createClient } from "npm:@supabase/supabase-js@2";
import { criarSegredos } from "../_shared/segredo.ts";
import { criarClienteTelegram } from "../_shared/telegram.ts";
import { criarHandler } from "./handler.ts";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SECRET_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const handler = criarHandler({
  telegram: criarClienteTelegram(Deno.env.get("TELEGRAM_BOT_TOKEN") ?? ""),
  admin,
  segredos: criarSegredos(admin),
  botUsername: Deno.env.get("TELEGRAM_BOT_USERNAME") ?? "diarioobra_cofz_bot",
  appName: Deno.env.get("TELEGRAM_APP_NAME") ?? "fiscalcofz",
});

Deno.serve(handler);
