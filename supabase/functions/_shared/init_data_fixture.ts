// Ferramenta de teste: gera initData assinado como o Telegram faria.
import { calcularHash } from "./init_data.ts";

/** Gera um initData (query string) válido para os campos e o token dados. */
export async function assinarInitData(
  campos: Record<string, string>,
  botToken: string,
): Promise<string> {
  const params = new URLSearchParams(campos);
  params.delete("hash");
  const hash = await calcularHash(params, botToken);
  params.set("hash", hash);
  return params.toString();
}
