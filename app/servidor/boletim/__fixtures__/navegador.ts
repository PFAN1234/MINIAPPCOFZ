/**
 * Chromium para os testes do gerador: o de `PW_CHROMIUM` ou o do Playwright instalado. Sem ele
 * (job `app` do CI), os testes que abrem o navegador são pulados; com `BOLETIM_EXIGIR_CHROMIUM=1`
 * (job `e2e`, na imagem do Playwright) a falta vira erro.
 */
import { existsSync } from 'node:fs'
import { chromium } from 'playwright-core'

export function chromiumDisponivel(): boolean {
  if (process.env.BOLETIM_EXIGIR_CHROMIUM === '1') return true
  const caminho = process.env.PW_CHROMIUM || process.env.CHROMIUM_PATH || chromium.executablePath()
  return existsSync(caminho)
}
