import { existsSync, readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

const FRAG_LOCAL = new URL('../public/modelos/hto/ARQ.frag', import.meta.url)
const MANIFESTO = {
  modelos: [{ sigla: 'ARQ', revisao: 'R06', arquivo: 'ARQ.frag', bytes: 1, hash: 'e2e' }],
}

async function simularManifesto(page: Page) {
  await page.route('**/modelos/hto/manifesto.json', (rota) =>
    rota.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MANIFESTO) }),
  )
}

test('sem modelos publicados, avisa e deixa todos os chips desabilitados', async ({ page }) => {
  await page.goto('/obras/hto/modelo')
  await expect(page.getByText('Esta obra ainda não tem modelos 3D publicados.')).toBeVisible()
  const chips = page.getByRole('list', { name: 'Modelos' }).getByRole('button')
  await expect(chips).toHaveCount(9)
  for (const chip of await chips.all()) await expect(chip).toBeDisabled()
})

test('falha ao baixar o .frag mostra o erro no visualizador', async ({ page }) => {
  await simularManifesto(page)
  await page.route('**/modelos/hto/ARQ.frag*', (rota) => rota.fulfill({ status: 500, body: 'erro' }))
  await page.goto('/obras/hto/modelo')
  await expect(page.getByRole('alert')).toHaveText('Falha ao baixar ARQ.')
  await expect(page.getByRole('button', { name: 'Enquadrar' })).toHaveCount(0)
})

test('o botão do cartão da obra leva ao modelo federado', async ({ page }) => {
  await page.goto('/obras/hto')
  await page.getByRole('link', { name: /Visualizar modelo federado/ }).tap()
  await expect(page).toHaveURL(/\/obras\/hto\/modelo$/)
  await expect(page.getByRole('heading', { name: 'Modelo federado', level: 1 })).toBeVisible()
})

// O .frag é gerado a partir do IFC (fora do Git): `npm run modelos -- --obra hto`.
test.describe('com o ARQ.frag gerado localmente', () => {
  test.skip(!existsSync(FRAG_LOCAL), 'ARQ.frag ausente: rode `npm run modelos -- --obra hto`')

  test('carrega o modelo em 3D, sem a marca da biblioteca, e o chip liga e desliga o ARQ', async ({ page }) => {
    await simularManifesto(page)
    await page.route('**/modelos/hto/ARQ.frag*', (rota) =>
      rota.fulfill({ status: 200, contentType: 'application/octet-stream', body: readFileSync(FRAG_LOCAL) }),
    )
    await page.goto('/obras/hto/modelo')

    const enquadrar = page.getByRole('button', { name: 'Enquadrar' })
    await expect(enquadrar).toBeVisible({ timeout: 60_000 })
    await expect(page.getByRole('img', { name: 'Modelo 3D federado' }).locator('canvas')).toBeVisible()
    await expect(page.locator('[data-thatopen-logo]')).toBeHidden()

    const arq = page.getByRole('button', { name: 'ARQ', exact: true })
    await expect(arq).toHaveAttribute('aria-pressed', 'true')
    await arq.tap()
    await expect(arq).toHaveAttribute('aria-pressed', 'false')
    await arq.tap()
    await expect(arq).toHaveAttribute('aria-pressed', 'true')
    await enquadrar.tap()
  })
})
