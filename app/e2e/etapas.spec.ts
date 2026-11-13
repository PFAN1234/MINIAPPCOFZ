import { expect, test } from '@playwright/test'

const URL_TELEGRAM_JS = 'https://telegram.org/js/telegram-web-app.js'

test.beforeEach(async ({ page }) => {
  await page.route(URL_TELEGRAM_JS, (rota) =>
    rota.fulfill({ status: 200, contentType: 'application/javascript', body: '' }),
  )
})

test('a faixa de identidade mostra a OM e "Fiscal Bot" em todas as telas', async ({ page }) => {
  await page.goto('/')
  const faixa = page.getByTestId('faixa-identidade')
  await expect(faixa).toContainText('CO-FZ')
  await expect(faixa).toContainText('Fiscal Bot')
  await page.goto('/obras/hto/ambientes/terreo-apto-101')
  await expect(page.getByRole('heading', { level: 1, name: 'Apto. 101' })).toBeVisible()
  await expect(page.getByTestId('faixa-identidade')).toContainText('CO-FZ')
  await expect(page).toHaveTitle('Fiscal Bot')
})

test('trocar de etapa na tela inicial muda as obras e fica lembrado', async ({ page }) => {
  await page.goto('/')
  const abas = page.getByRole('tablist', { name: 'Etapa' })
  await expect(abas).toBeVisible()
  await expect(abas.getByRole('tab', { selected: true })).toHaveText('2ª ETAPA')
  await expect(page.getByRole('link', { name: /^HTO/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Outras obras', level: 2 })).toBeVisible()

  await abas.getByRole('tab', { name: '3ª ETAPA' }).click()
  await expect(page.getByRole('link', { name: /Bloco de Alojamentos/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /^HTO/ })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Outras obras', level: 2 })).toHaveCount(0)

  await page.reload()
  await expect(page.getByRole('tablist', { name: 'Etapa' }).getByRole('tab', { selected: true })).toHaveText('3ª ETAPA')
  await expect(page.getByRole('link', { name: /Bloco de Alojamentos/ })).toBeVisible()
})
