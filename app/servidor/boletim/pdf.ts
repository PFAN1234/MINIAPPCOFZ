/**
 * Chromium headless e PDF. Na Vercel (ou outro ambiente serverless), o Chromium do
 * `@sparticuz/chromium` com o `playwright-core`; fora dela, o executável de `PW_CHROMIUM` ou o
 * Chromium do Playwright instalado na máquina (`npx playwright install chromium`).
 */
import { chromium, type Browser } from 'playwright-core'

/** Está numa função serverless (Vercel/AWS Lambda)? */
export function ehServerless(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.VERCEL || env.AWS_LAMBDA_FUNCTION_NAME || env.AWS_EXECUTION_ENV)
}

export async function abrirNavegador(): Promise<Browser> {
  if (ehServerless()) {
    const { default: Chromium } = await import('@sparticuz/chromium')
    // Sem WebGL: o boletim não precisa e a inicialização fica mais leve.
    Chromium.setGraphicsMode = false
    return chromium.launch({ executablePath: await Chromium.executablePath(), args: Chromium.args, headless: true })
  }
  const executavel = process.env.PW_CHROMIUM || process.env.CHROMIUM_PATH
  return chromium.launch({ headless: true, ...(executavel ? { executablePath: executavel } : {}) })
}

/** A4, margens da prévia v2, fundo impresso e rodapé com número e paginação. */
export async function gerarPdf(navegador: Browser, html: string, rodape: string): Promise<Buffer> {
  const contexto = await navegador.newContext({ locale: 'pt-BR' })
  try {
    const pagina = await contexto.newPage()
    await pagina.setContent(html, { waitUntil: 'load' })
    await pagina.evaluate(() => document.fonts.ready.then(() => undefined))
    return await pagina.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: rodape,
      margin: { top: '12mm', bottom: '16mm', left: '12mm', right: '12mm' },
      preferCSSPageSize: true,
    })
  } finally {
    await contexto.close()
  }
}
