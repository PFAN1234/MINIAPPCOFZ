import { expect, test } from '@playwright/test'

const URL_TELEGRAM_JS = 'https://telegram.org/js/telegram-web-app.js'
const ID_REGISTRO = '00000000-0000-4000-8000-000000000101'

/** Telegram simulado que abre o Mini App por um link `startapp`. */
function telegramComParametro(parametro: string): string {
  return `
(() => {
  window.Telegram = {
    WebApp: {
      initData: 'query_id=AAE2e2e&user=%7B%22id%22%3A1%7D&hash=e2e',
      initDataUnsafe: { user: { id: 1 }, start_param: ${JSON.stringify(parametro)} },
      colorScheme: 'light',
      themeParams: {},
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
      ready() {},
      expand() {},
    },
  };
})();
`
}

test.beforeEach(async ({ page }) => {
  await page.route(URL_TELEGRAM_JS, (rota) =>
    rota.fulfill({ status: 200, contentType: 'application/javascript', body: '' }),
  )
})

test('pedir acesso à Obra Demonstração mostra "Aguardando aprovação"', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Outras obras', level: 2 })).toBeVisible()
  await page.getByRole('button', { name: /Solicitar acesso/ }).tap()
  await expect(page.getByText('Aguardando aprovação')).toBeVisible()
  await expect(page.getByRole('button', { name: /Solicitar acesso/ })).toHaveCount(0)
})

test('o gestor aprova o pedido da Maria no Controle de acesso', async ({ page }) => {
  // O Controle de acesso fica no Início, embaixo da Administração (gestor ou admin), com o selo de pedidos.
  await page.goto('/')
  await page.getByRole('link', { name: /^Controle de acesso/ }).tap()
  await expect(page).toHaveURL(/\/acessos$/)
  await expect(page.getByRole('heading', { name: 'Controle de acesso', level: 1 })).toBeVisible()

  const maria = page.getByRole('listitem').filter({ hasText: 'Maria Souza' })
  await expect(maria).toContainText('@maria')
  await expect(maria).toContainText('Pediu acesso')
  // Pedido pendente sem acesso: nenhuma opção marcada.
  const hto = maria.getByRole('group', { name: 'Acesso de Maria Souza em HTO' })
  await expect(hto.getByRole('button', { pressed: true })).toHaveCount(0)

  // Liberar como Equipe aprova o pedido.
  await hto.getByRole('button', { name: 'Equipe' }).tap()
  await expect(hto.getByRole('button', { name: 'Equipe' })).toHaveAttribute('aria-pressed', 'true')
  await expect(maria).not.toContainText('Pediu acesso')
})

test('link startapp registro_<id> abre o ambiente com o visualizador', async ({ page }) => {
  await page.addInitScript(telegramComParametro(`registro_${ID_REGISTRO}`))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Apto. 101', level: 1 })).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`aba=pendencias&registro=${ID_REGISTRO}`))
  const dialogo = page.getByRole('dialog')
  await expect(dialogo).toBeVisible()
  // Regressão: o visualizador de fotos deve cobrir a viewport inteira (tela cheia),
  // e não virar um painel dentro da página por colisão de classe CSS.
  const viewport = page.viewportSize()!
  await expect(dialogo).toHaveCSS('position', 'fixed')
  const caixa = (await dialogo.boundingBox())!
  expect(caixa.x).toBe(0)
  expect(caixa.y).toBe(0)
  expect(caixa.width).toBe(viewport.width)
  expect(caixa.height).toBe(viewport.height)
  await page.getByRole('button', { name: 'Fechar' }).tap()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.registro-destaque')).toContainText('Tomada da sala')
})
