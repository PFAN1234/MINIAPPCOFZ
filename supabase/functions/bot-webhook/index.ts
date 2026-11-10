// Edge Function bot-webhook: recebe os updates do bot do Telegram e configura o webhook.
import { createClient } from "npm:@supabase/supabase-js@2";
import { criarSegredos } from "../_shared/segredo.ts";
import { criarClienteTelegram } from "../_shared/telegram.ts";
import { criarHandler } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(
  url,
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
  urlFuncao: `${url}/functions/v1/bot-webhook`,
});

Deno.serve(handler);
