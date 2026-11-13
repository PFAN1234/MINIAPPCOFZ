import { expect, test } from '@playwright/test'

// Arquivar e excluir obra no site de administração (fixture).
test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false })

test('arquiva e desarquiva a COFZ e exclui a HTO digitando o nome', async ({ page }) => {
  const erros: string[] = []
  page.on('pageerror', (e) => erros.push(e.message))

  await page.goto('/admin/obras/cofz')
  await page.getByRole('button', { name: 'Arquivar obra' }).click()
  await page.getByRole('button', { name: 'Confirmar: arquivar COFZ' }).click()
  await expect(page.getByText(/Obra arquivada em/)).toBeVisible()
  await page.getByRole('link', { name: '← Etapas' }).click()
  await expect(page.getByRole('table', { name: 'Obras arquivadas' }).getByRole('link', { name: 'COFZ' })).toBeVisible()
  await page.getByRole('table', { name: 'Obras arquivadas' }).getByRole('link', { name: 'COFZ' }).click()
  await page.getByRole('button', { name: 'Desarquivar obra' }).click()
  await expect(page.getByRole('button', { name: 'Arquivar obra' })).toBeVisible()

  await page.getByRole('link', { name: '← Etapas' }).click()
  await page.getByRole('link', { name: 'HTO' }).click()
  await page.getByRole('button', { name: 'Excluir obra…' }).click()
  await expect(page.getByRole('list', { name: 'O que será apagado' })).toContainText('87 ambientes')
  const excluir = page.getByRole('button', { name: 'Excluir HTO definitivamente' })
  await expect(excluir).toBeDisabled()
  await page.getByLabel(/digite o nome da obra/).fill('HTO')
  await excluir.click()
  await expect(page.getByText('Obra HTO excluída, com todos os dados e arquivos.')).toBeVisible()
  await expect(page.getByRole('table', { name: 'Obras de 2ª ETAPA' }).getByRole('link', { name: 'HTO' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Obras excluídas' })).toContainText('HTO')
  expect(erros).toEqual([])
})
