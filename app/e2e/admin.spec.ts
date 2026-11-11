import { expect, test } from '@playwright/test'

// Site de administração: layout de computador, sem Telegram.
test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false })

test('abre /admin/, lista as obras, cria uma obra e edita o pavimento', async ({ page }) => {
  await page.goto('/admin/')
  await expect(page.getByRole('heading', { name: 'Obras' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'HTO' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'COFZ' })).toBeVisible()
  // nada do Mini App nesta página
  await expect(page.getByRole('link', { name: 'Pendências' })).toHaveCount(0)

  await page.getByRole('link', { name: 'Nova obra' }).click()
  await page.getByLabel('Slug').fill('obra-e2e')
  await page.getByLabel('Nome').fill('Obra E2E')
  await page.getByRole('button', { name: 'Criar obra' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Obra E2E' })).toBeVisible()
  await expect(page).toHaveURL(/\/admin\/obras\/obra-e2e$/)

  await page.getByRole('button', { name: 'Incluir pavimento' }).click()
  await page.getByLabel('Código do pavimento 1').fill('terreo')
  await page.getByLabel('Nome do pavimento 1').fill('Térreo')
  await page.getByRole('button', { name: 'Salvar pavimentos' }).click()
  await expect(page.getByText('Pavimentos salvos.')).toBeVisible()

  await page.getByLabel('Nome do pavimento 1').fill('Pavimento térreo')
  await page.getByRole('button', { name: 'Salvar pavimentos' }).click()
  await expect(page.getByText('Pavimentos salvos.')).toBeVisible()

  await page.getByRole('link', { name: '← Obras' }).click()
  const linha = page.getByRole('row', { name: /Obra E2E/ })
  await expect(linha).toContainText('obra-e2e')
  await expect(linha).toContainText('Pavimento térreo')
  await expect(linha).toContainText('Sem configuração')
})

test('link #entrar= é lido e some da URL; rota profunda abre direto', async ({ page }) => {
  await page.goto('/admin/admins#entrar=fixture')
  await expect(page.getByRole('heading', { name: 'Admins' })).toBeVisible()
  await expect(page).toHaveURL(/\/admin\/admins$/)
})

test('o precache do Mini App não inclui o site de administração', async ({ page }) => {
  await page.goto('/admin/')
  const manifesto = await page.evaluate(() =>
    fetch('/precache-manifest.json', { cache: 'no-store' }).then((r) => r.json() as Promise<{ arquivos: string[] }>),
  )
  expect(manifesto.arquivos).toContain('/index.html')
  expect(manifesto.arquivos.filter((a) => a.includes('admin'))).toEqual([])
  // pdf.js, worker, fontes, WASM e o editor de planta são só do site de administração.
  expect(manifesto.arquivos.filter((a) => /pdf|webp_enc|wasm|Foxit|Liberation|servicoNavegador/i.test(a))).toEqual([])
})
