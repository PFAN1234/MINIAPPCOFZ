import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

const URL_TELEGRAM_JS = 'https://telegram.org/js/telegram-web-app.js'
const FOTO = fileURLToPath(new URL('./fixtures/com-gps.jpg', import.meta.url))

test.beforeEach(async ({ page }) => {
  await page.route(URL_TELEGRAM_JS, (rota) =>
    rota.fulfill({ status: 200, contentType: 'application/javascript', body: '' }),
  )
  // Confirmações do app (encerrar, reenviar...) são aceitas.
  page.on('dialog', (dialogo) => void dialogo.accept())
})

async function abrirPendenciaDaTomada(page: Page) {
  await page.goto('/obras/hto')
  await expect(page.getByRole('heading', { name: 'HTO', level: 2 })).toBeVisible()
  await page.getByRole('link', { name: /^Pendências \d+/ }).tap()
  await expect(page).toHaveURL(/\/obras\/hto\/pendencias$/)
  await expect(page.getByRole('tab', { name: 'Abertas (3)' })).toBeVisible()
  await page.getByRole('link', { name: /Tomada da sala/ }).tap()
  await expect(page.getByRole('heading', { name: 'Apto. 101', level: 2 })).toBeVisible()
}

async function preencherEncerramento(page: Page) {
  await page
    .locator('input[type="file"][aria-label="Escolher fotos da galeria"]')
    .setInputFiles(FOTO)
  await expect(page.getByRole('img', { name: 'Foto 1' })).toBeVisible()
  await expect(page.getByText('Preparando…')).toHaveCount(0)
  await page.getByLabel('Observação').fill('Espelho trocado e tomada testada.')
  await expect(page.getByRole('button', { name: 'Encerrar pendência' })).toBeEnabled()
}

test('Pendências → abrir → encerrar com foto e observação → aparece em Resolvidas', async ({ page }) => {
  await abrirPendenciaDaTomada(page)
  await preencherEncerramento(page)
  await page.getByRole('button', { name: 'Encerrar pendência' }).click()

  await expect(page).toHaveURL(/\/obras\/hto\/pendencias$/)
  await expect(page.getByRole('status').filter({ hasText: 'Encerramento salvo no aparelho' })).toBeVisible()
  // O envio corre em segundo plano; a pendência sai de Abertas e vai para Resolvidas.
  await expect(page.getByRole('tab', { name: 'Resolvidas (2)' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Abertas (2)' })).toBeVisible()
  await page.getByRole('tab', { name: /Resolvidas/ }).tap()
  await page.getByRole('link', { name: /Tomada da sala/ }).tap()
  await expect(page.getByRole('heading', { name: 'Resolução', level: 3 })).toBeVisible()
  await expect(page.getByText('Espelho trocado e tomada testada.')).toBeVisible()
  await expect(page.getByText(/Encerrada por Você \(teste\)/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Encerrar pendência' })).toHaveCount(0)
})

test('encerrar sem sinal fica na fila e é enviado quando o sinal volta', async ({ page, context }) => {
  await abrirPendenciaDaTomada(page)
  await preencherEncerramento(page)
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Encerrar pendência' }).click()
  await expect(page).toHaveURL(/\/obras\/hto\/pendencias$/)
  await expect(page.getByRole('status').filter({ hasText: 'Encerramento salvo no aparelho' })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: '1 item aguardando envio' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Abertas (3)' })).toBeVisible()

  // O detalhe mostra o encerramento no aparelho e esconde o formulário.
  await page.getByRole('link', { name: /Tomada da sala/ }).tap()
  await expect(page.getByText('Encerramento salvo no aparelho · aguardando envio')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Encerrar pendência' })).toHaveCount(0)

  await context.setOffline(false)
  await expect(page.getByRole('heading', { name: 'Resolução', level: 3 })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('1 item aguardando envio')).toHaveCount(0)
})

test('Gestão: mudar o papel de um participante e reenviar uma publicação', async ({ page }) => {
  await page.goto('/obras/hto')
  await page.getByRole('link', { name: /^Gestão/ }).tap()
  await expect(page.getByRole('heading', { name: 'Gestão', level: 2 })).toBeVisible()

  const papel = page.getByLabel('Papel de Marcos Teixeira')
  await expect(papel).toHaveValue('equipe')
  await papel.selectOption('gestor')
  await expect(papel).toHaveValue('gestor')
  // Persiste: a lista recarregada mostra o papel novo.
  await page.reload()
  await expect(page.getByLabel('Papel de Marcos Teixeira')).toHaveValue('gestor')

  const falhou = page.locator('li', { hasText: 'Guarda-corpo com fixação folgada.' })
  await expect(falhou).toContainText('Falhou')
  await falhou.getByRole('button', { name: 'Reenviar' }).tap()
  await expect(page.getByText('Guarda-corpo com fixação folgada.')).toHaveCount(0)
  await expect(page.getByText('Instalação do forro de gesso finalizada.')).toBeVisible()
})
