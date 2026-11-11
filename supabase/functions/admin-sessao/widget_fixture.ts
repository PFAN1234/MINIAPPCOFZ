// Ferramenta de teste: dados do Login Widget assinados como o Telegram faria.
import { calcularHashWidget } from "./widget.ts";

export async function assinarWidget(
  campos: Record<string, string | number>,
  botToken: string,
): Promise<Record<string, string | number>> {
  const hash = await calcularHashWidget(campos, botToken);
  return { ...campos, hash: hash! };
}
