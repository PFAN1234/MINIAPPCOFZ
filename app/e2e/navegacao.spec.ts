import { expect, test, type Locator, type Page } from '@playwright/test'

/** Estado que o Telegram simulado expõe em `window.__tg`. */
interface EstadoTelegram {
  ready: number
  expand: number
  show: number
  hide: number
  visivel: boolean
  handlers(): number
  disparar(): void
}

declare global {
  interface Window {
    __tg: EstadoTelegram
  }
}

const URL_TELEGRAM_JS = 'https://telegram.org/js/telegram-web-app.js'

/**
 * `window.Telegram.WebApp` falso, definido antes de o app carregar. `initData`
 * preenchido faz `dentroDoTelegram()` valer; as chamadas ficam em `window.__tg`.
 */
const TELEGRAM_FALSO = `
(() => {
  const handlers = new Set();
  const tg = {
    ready: 0,
    expand: 0,
    show: 0,
    hide: 0,
    visivel: false,
    handlers: () => handlers.size,
    disparar: () => { for (const cb of [...handlers]) cb(); },
  };
  window.__tg = tg;
  window.Telegram = {
    WebApp: {
      initData: 'query_id=AAE2e2e&user=%7B%22id%22%3A1%7D&hash=e2e',
      colorScheme: 'light',
      themeParams: {},
      BackButton: {
        show() { tg.show++; tg.visivel = true; },
        hide() { tg.hide++; tg.visivel = false; },
        onClick(cb) { handlers.add(cb); },
        offClick(cb) { handlers.delete(cb); },
      },
      ready() { tg.ready++; },
      expand() { tg.expand++; },
    },
  };
})();
`

test.beforeEach(async ({ page }) => {
  // O index.html carrega o script oficial da internet; aqui ele vira um arquivo vazio,
  // para não depender de rede e não sobrescrever o Telegram simulado.
  await page.route(URL_TELEGRAM_JS, (rota) =>
    rota.fulfill({ status: 200, contentType: 'application/javascript', body: '' }),
  )
})

async function abrirAmbienteApto101(page: Page) {
  await page.goto('/obras/hto/ambientes/terreo-apto-101')
  await expect(page.getByRole('heading', { name: 'Apto. 101', level: 1 })).toBeVisible()
}

/** Fundo do primeiro ancestral do elemento que tem fundo: cor ou degradê (o topo azul, no caso do h1). */
async function fundoDoAncestral(alvo: Locator): Promise<string> {
  return alvo.evaluate((el) => {
    for (let atual = el.parentElement; atual; atual = atual.parentElement) {
      const estilo = getComputedStyle(atual)
      if (estilo.backgroundImage !== 'none') return estilo.backgroundImage
      const cor = estilo.backgroundColor
      if (cor !== 'rgba(0, 0, 0, 0)' && cor !== 'transparent') return cor
    }
    return ''
  })
}

test.describe('topo azul', () => {
  for (const [rota, titulo] of [
    ['/', 'Obras'],
    ['/obras/hto', 'HTO'],
    ['/obras/hto/ambientes/terreo-apto-101', 'Apto. 101'],
    ['/registros', 'Registros'],
  ]) {
    test(`o h1 "${titulo}" fica no topo azul, no alto da tela`, async ({ page }) => {
      await page.goto(rota)
      const h1 = page.getByRole('heading', { level: 1, name: titulo, exact: true })
      await expect(h1).toBeVisible()
      expect(await fundoDoAncestral(h1)).toContain('rgb(11, 22, 37)')
      // Nada entre o topo e o cabeçalho do Telegram: o azul começa no y = 0.
      const topo = await h1.locator('xpath=ancestor::header[1]').boundingBox()
      expect(topo?.y).toBe(0)
    })
  }

  test('sem sinal, a faixa aparece logo abaixo do topo azul', async ({ page, context }) => {
    await page.goto('/obras/hto')
    const h1 = page.getByRole('heading', { level: 1, name: 'HTO' })
    await expect(h1).toBeVisible()
    await context.setOffline(true)
    const faixa = page.getByRole('status').filter({ hasText: 'Sem conexão' })
    await expect(faixa).toBeVisible()
    const topo = (await h1.locator('xpath=ancestor::header[1]').boundingBox())!
    const caixa = (await faixa.boundingBox())!
    expect(topo.y).toBe(0)
    expect(caixa.y).toBeCloseTo(topo.y + topo.height, 0)
    await context.setOffline(false)
  })

  test('"Voltar" e os itens da barra inferior têm alvo de toque de 44 px ou mais', async ({ page }) => {
    await page.goto('/obras/hto')
    await expect(page.getByRole('heading', { level: 1, name: 'HTO' })).toBeVisible()
    const alvos = [
      page.getByRole('button', { name: 'Voltar' }),
      ...['Início', 'Registros', 'Relatórios'].map((nome) =>
        page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: new RegExp(`^${nome}`) }),
      ),
    ]
    for (const alvo of alvos) {
      const caixa = (await alvo.boundingBox())!
      expect(caixa.width).toBeGreaterThanOrEqual(44)
      expect(caixa.height).toBeGreaterThanOrEqual(44)
    }
  })
})

test.describe('fora do Telegram', () => {
  test('Obras → HTO → Apto. 101 pela lista, e Voltar retorna à obra', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Obras', level: 1, exact: true })).toBeVisible()

    await page.getByRole('link', { name: /^HTO\b/ }).click()
    await expect(page.getByRole('heading', { name: 'HTO', level: 1 })).toBeVisible()

    // A obra abre na planta; a lista de ambientes fica na segunda aba.
    await page.getByRole('tab', { name: 'Lista' }).click()
    await page.getByRole('link', { name: /^Apto\. 101\b/ }).click()
    await expect(page).toHaveURL(/\/obras\/hto\/ambientes\/terreo-apto-101$/)
    await expect(page.getByRole('heading', { name: 'Apto. 101', level: 1 })).toBeVisible()
    await expect(page.getByText(/23,88\s*m²/)).toBeVisible()

    await page.getByRole('button', { name: 'Voltar' }).click()
    await expect(page).toHaveURL(/\/obras\/hto\?aba=lista$/)
    await expect(page.getByRole('heading', { name: 'HTO', level: 1 })).toBeVisible()
  })

  test('tocar no pino "Apto. 101" da planta abre o Ambiente', async ({ page }) => {
    await page.goto('/obras/hto?aba=planta&pav=terreo')
    const pino = page.getByRole('button', { name: 'Apto. 101', exact: true })
    await expect(pino).toBeVisible()

    // Com a planta inteira na tela, o pino do Despensa (vizinho) cobre o do Apto. 101.
    // Aproxima com a roda do mouse, centrada no pino, antes de tocar. O cartão de observações
    // fica acima da planta: rola até o pino para a roda cair sobre a planta.
    await pino.scrollIntoViewIfNeeded()
    const caixa = await pino.boundingBox()
    if (!caixa) throw new Error('Pino "Apto. 101" sem posição na tela')
    await page.mouse.move(caixa.x + caixa.width / 2, caixa.y + caixa.height / 2)
    for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -300)

    await pino.tap()
    await expect(page).toHaveURL(/\/obras\/hto\/ambientes\/terreo-apto-101$/)
    await expect(page.getByRole('heading', { name: 'Apto. 101', level: 1 })).toBeVisible()
  })

  test('"Onde fica" leva à planta centrada no ambiente', async ({ page }) => {
    await abrirAmbienteApto101(page)

    await page.getByRole('button', { name: /Onde fica/ }).tap()
    await expect(page).toHaveURL(/foco=terreo-apto-101/)
    const url = new URL(page.url())
    expect(url.pathname).toBe('/obras/hto')
    expect(url.searchParams.get('aba')).toBe('planta')
    expect(url.searchParams.get('foco')).toBe('terreo-apto-101')

    await expect(page.locator('.planta-foco strong', { hasText: 'Apto. 101' })).toBeVisible()
  })
})

test.describe('Telegram simulado', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(TELEGRAM_FALSO)
  })

  test('BackButton aparece nas telas internas, o Voltar do cabeçalho some e o callback volta à tela anterior', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Obras', level: 1, exact: true })).toBeVisible()
    const inicial = await page.evaluate(() => window.__tg)
    expect(inicial.ready).toBeGreaterThan(0)
    expect(inicial.expand).toBeGreaterThan(0)
    expect(await page.evaluate(() => window.__tg.visivel)).toBe(false)

    await page.getByRole('link', { name: /^HTO\b/ }).click()
    await expect(page.getByRole('heading', { name: 'HTO', level: 1 })).toBeVisible()
    expect(await page.evaluate(() => window.__tg.visivel)).toBe(true)
    await expect(page.getByRole('button', { name: 'Voltar' })).toHaveCount(0)

    await page.getByRole('tab', { name: 'Lista' }).click()
    await page.getByRole('link', { name: /^Apto\. 101\b/ }).click()
    await expect(page.getByRole('heading', { name: 'Apto. 101', level: 1 })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Voltar' })).toHaveCount(0)
    expect(await page.evaluate(() => window.__tg.handlers())).toBe(1)

    await page.evaluate(() => window.__tg.disparar())
    await expect(page).toHaveURL(/\/obras\/hto\?aba=lista$/)
    await expect(page.getByRole('heading', { name: 'HTO', level: 1 })).toBeVisible()
  })
})
