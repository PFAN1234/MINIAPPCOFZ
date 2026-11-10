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

test('o gestor aprova o pedido da Maria', async ({ page }) => {
  await page.goto('/obras/hto')
  await page.getByRole('link', { name: /^Gestão/ }).tap()
  await expect(page).toHaveURL(/\/obras\/hto\/gestao$/)
  await expect(page.getByRole('heading', { name: 'Pedidos de acesso', level: 3 })).toBeVisible()
  await expect(page.getByText('Maria Souza')).toBeVisible()
  await expect(page.getByText('@maria')).toBeVisible()
  await page.getByRole('button', { name: /Aprovar/ }).tap()
  await expect(page.getByText('Nenhum pedido de acesso pendente.')).toBeVisible()
})

test('link startapp registro_<id> abre o ambiente com o visualizador', async ({ page }) => {
  await page.addInitScript(telegramComParametro(`registro_${ID_REGISTRO}`))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Apto. 101', level: 2 })).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`aba=pendencias&registro=${ID_REGISTRO}`))
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Fechar' }).tap()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.registro-destaque')).toContainText('Tomada da sala')
})
