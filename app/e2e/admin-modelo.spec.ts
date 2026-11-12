import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

// Modelos 3D no site de administração (fixture): um IFC pequeno convertido no navegador pelo
// Web Worker (web-ifc + IfcImporter, os mesmos do script) e o .frag real da HTO enviado pronto.
test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false })

const IFC_TESTE = fileURLToPath(new URL('./fixtures/TESTE-01-EST-R01.ifc', import.meta.url))
const FRAG_HTO = fileURLToPath(new URL('../public/modelos/hto/ARQ.frag', import.meta.url))

test('converte um IFC no navegador, envia um .frag pronto, retira e mostra o histórico', async ({ page }) => {
  test.setTimeout(180_000)
  const erros: string[] = []
  page.on('pageerror', (e) => erros.push(e.message))

  await page.goto('/admin/obras/hto')
  await page.getByRole('link', { name: 'Modelos 3D' }).click()
  await expect(page.getByRole('heading', { name: 'Modelos 3D · HTO' })).toBeVisible()
  await expect(page.getByText(/Nenhum modelo publicado/)).toBeVisible()

  // IFC: sigla e revisão pelo nome; a conversão roda no worker e gera o .frag.
  await page.getByLabel(/Arquivo do modelo/).setInputFiles(IFC_TESTE)
  await expect(page.getByLabel('Sigla da disciplina')).toHaveValue('EST')
  await expect(page.getByLabel('Revisão', { exact: true })).toHaveValue('R01')
  await page.getByRole('button', { name: 'Converter' }).click()
  await expect(page.getByText(/Convertido: \.frag com/)).toBeVisible({ timeout: 120_000 })
  await page.getByRole('button', { name: 'Publicar EST' }).click()
  await expect(page.getByText(/Publicado: EST, revisão R01/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('modelo-EST')).toContainText('R01')

  // .frag pronto (nome fora do padrão: sigla e revisão à mão).
  await page.getByLabel(/Arquivo do modelo/).setInputFiles(FRAG_HTO)
  await expect(page.getByText('.frag pronto')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Publicar modelo' })).toBeDisabled()
  await page.getByLabel('Sigla da disciplina').fill('arq')
  await page.getByLabel('Revisão', { exact: true }).fill('R06')
  await page.getByRole('button', { name: 'Publicar ARQ' }).click()
  await expect(page.getByText(/Publicado: ARQ, revisão R06 \(11,9 MB\)/)).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId('modelo-ARQ')).toContainText('11,9 MB')

  // Retirar pede confirmação; o histórico registra as três ações.
  await page.getByRole('button', { name: 'Retirar EST' }).click()
  await page.getByRole('button', { name: 'Confirmar: retirar EST' }).click()
  await expect(page.getByTestId('modelo-EST')).toHaveCount(0)
  const historico = page.getByRole('region', { name: 'Histórico' })
  await expect(historico.getByRole('row')).toHaveCount(4)
  await expect(historico.getByRole('row').nth(1)).toContainText('Retirado EST')
  await expect(historico.getByRole('row').nth(3)).toContainText('convertido no site')
  expect(erros).toEqual([])
})
