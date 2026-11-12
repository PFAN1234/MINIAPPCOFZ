import { existsSync, readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

const FRAG_LOCAL = new URL('../public/modelos/hto/ARQ.frag', import.meta.url)

test.beforeEach(async ({ page }) => {
  await page.route('**/modelos/hto/manifesto.json', (rota) =>
    rota.fulfill({
      json: { modelos: [{ sigla: 'ARQ', revisao: 'R06', arquivo: 'ARQ.frag', bytes: 1, hash: 'e2e-ra' }] },
    }),
  )
})

test('ambiente sem geometria não oferece a realidade aumentada', async ({ page }) => {
  await page.goto('/obras/hto/ambientes/terreo-jardim-2')
  await expect(page.getByRole('button', { name: 'Novo registro' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Comparar com o modelo (RA)' })).toHaveCount(0)
})

test('teste do aparelho mostra câmera e WebGL', async ({ page }) => {
  await page.goto('/ra-teste')
  await page.getByRole('button', { name: 'Iniciar teste' }).click()
  await expect(page.getByText(/\d+×\d+ a \d+ qps/)).toBeVisible()
  await expect(page.getByText('fora do Telegram')).toBeVisible()
})

// Câmera simulada do Chromium (ver `playwright.config.ts`) e o ARQ.frag do repositório.
test.describe('com modelo', () => {
  test.skip(!existsSync(FRAG_LOCAL), 'ARQ.frag ausente: rode `npm run modelos -- --obra hto`')

  test('alinha por dois cantos e leva o par de fotos ao registro', async ({ page }) => {
    await page.route('**/modelos/hto/ARQ.frag*', (rota) =>
      rota.fulfill({ body: readFileSync(FRAG_LOCAL), contentType: 'application/octet-stream' }),
    )
    await page.goto('/obras/hto/ambientes/terreo-apto-101')
    await page.getByRole('button', { name: 'Comparar com o modelo (RA)' }).click()
    await page.getByRole('button', { name: 'Abrir câmera' }).click()

    const toque = page.getByTestId('ra-toque')
    await toque.click({ position: { x: 80, y: 600 } })
    await page.getByRole('button', { name: 'Canto 1' }).click()
    await expect(page.getByText(/Canto 1 marcado/)).toBeVisible()
    await toque.click({ position: { x: 320, y: 620 } })
    // O canto já usado fica bloqueado.
    await expect(page.getByRole('button', { name: 'Canto 1' })).toHaveAttribute('aria-disabled', 'true')
    await page.getByRole('button', { name: 'Canto 2' }).click()

    const disparo = page.getByRole('button', { name: 'Tirar foto', exact: true })
    await expect(disparo).toBeEnabled()
    await disparo.click()
    await page.getByRole('button', { name: 'Usar 2 fotos' }).click()

    // De volta ao formulário, com as duas fotos (limpa e com o modelo).
    await expect(page.getByRole('heading', { name: 'Novo registro' })).toBeVisible()
    await expect(page.locator('.fotos-grade li')).toHaveCount(2)
    await expect(page.locator('.foto-pronta')).toHaveCount(2)

    await page.getByText('Serviço', { exact: true }).click()
    await page.getByLabel('Legenda').fill('Conferência das tomadas com o modelo')
    await page.getByRole('button', { name: 'Salvar registro' }).click()
    await expect(page.locator('.miniatura-ra').first()).toBeVisible()
  })
})
