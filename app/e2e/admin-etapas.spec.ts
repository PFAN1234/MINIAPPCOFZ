import { expect, test } from '@playwright/test'

// Etapas e organização no site de administração (fixture).
test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false })

// PNG 1×1 vermelho.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64',
)

test('cria etapa e obra nela, arquiva, desarquiva e exclui a etapa digitando o nome', async ({ page }) => {
  const erros: string[] = []
  page.on('pageerror', (e) => erros.push(e.message))

  await page.goto('/admin/')
  await expect(page.getByRole('region', { name: '2ª ETAPA' }).getByRole('link', { name: 'HTO' })).toBeVisible()
  await page.getByRole('link', { name: 'Nova etapa' }).click()
  await page.getByLabel('Slug').fill('5a-etapa')
  await page.getByLabel('Nome').fill('5ª ETAPA')
  await page.getByLabel('Ordem').fill('5')
  await page.getByRole('button', { name: 'Criar etapa' }).click()
  await expect(page).toHaveURL(/\/admin\/etapas\/5a-etapa$/)
  await expect(page.getByRole('heading', { level: 1, name: '5ª ETAPA' })).toBeVisible()
  await expect(page.getByText('/vincular_etapa 5a-etapa')).toBeVisible()

  // Nova obra já na etapa.
  await page.getByRole('region', { name: 'Obras da etapa' }).getByRole('link', { name: 'Nova obra' }).click()
  await expect(page).toHaveURL(/\/admin\/nova-obra\?etapa=5a-etapa$/)
  await expect(page.getByRole('combobox', { name: 'Etapa' })).toHaveValue(/etapa-nova-/)
  await page.getByLabel('Slug').fill('bloco-e2e')
  await page.getByLabel('Nome').fill('Bloco E2E')
  await page.getByRole('button', { name: 'Criar obra' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Bloco E2E' })).toBeVisible()
  await expect(page.getByRole('link', { name: '5ª ETAPA' })).toHaveAttribute('href', '/admin/etapas/5a-etapa')

  // Na tela inicial, a obra aparece na etapa dela.
  await page.getByRole('link', { name: '← Etapas' }).click()
  const cartao = page.getByRole('region', { name: '5ª ETAPA' })
  await expect(cartao.getByRole('link', { name: 'Bloco E2E' })).toBeVisible()
  await cartao.getByRole('link', { name: 'Abrir etapa 5ª ETAPA' }).click()

  // Arquivar e desarquivar.
  await page.getByRole('button', { name: 'Arquivar etapa' }).click()
  await page.getByRole('button', { name: 'Confirmar: arquivar 5ª ETAPA' }).click()
  await expect(page.getByText(/Etapa arquivada em/)).toBeVisible()
  await page.getByRole('link', { name: '← Etapas' }).click()
  const arquivadas = page.getByRole('table', { name: 'Etapas arquivadas' })
  await expect(arquivadas.getByRole('link', { name: '5ª ETAPA' })).toBeVisible()
  await expect(page.getByRole('region', { name: '5ª ETAPA' })).toHaveCount(0)
  await arquivadas.getByRole('link', { name: '5ª ETAPA' }).click()
  await page.getByRole('button', { name: 'Desarquivar etapa' }).click()
  await expect(page.getByRole('button', { name: 'Arquivar etapa' })).toBeVisible()
  await expect(page.getByText(/Etapa arquivada em/)).toHaveCount(0)

  // Excluir digitando o nome.
  await page.getByRole('button', { name: 'Excluir etapa…' }).click()
  await expect(page.getByRole('list', { name: 'Obras que serão apagadas' })).toContainText('Bloco E2E')
  await expect(page.getByRole('list', { name: 'O que será apagado' })).toContainText('0 registros')
  const excluir = page.getByRole('button', { name: 'Excluir 5ª ETAPA definitivamente' })
  await expect(excluir).toBeDisabled()
  await page.getByLabel(/digite o nome da etapa/).fill('5a etapa')
  await expect(excluir).toBeDisabled()
  await page.getByLabel(/digite o nome da etapa/).fill('5ª ETAPA')
  await excluir.click()
  await expect(page).toHaveURL(/\/admin\/?$/)
  await expect(page.getByText('Etapa 5ª ETAPA excluída com 1 obra, com todos os dados e arquivos.')).toBeVisible()
  await expect(page.getByRole('region', { name: '5ª ETAPA' })).toHaveCount(0)
  const excluidas = page.getByRole('region', { name: 'Obras excluídas' })
  await expect(excluidas.getByRole('row', { name: /Bloco E2E/ })).toContainText('5ª ETAPA (excluída junto)')
  expect(erros).toEqual([])
})

test('troca o nome e o logo da OM, que aparecem na barra do topo, e remove o logo', async ({ page }) => {
  const erros: string[] = []
  page.on('pageerror', (e) => erros.push(e.message))

  await page.goto('/admin/')
  await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Organização' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Organização' })).toBeVisible()
  await expect(page.getByLabel('Nome da OM')).toHaveValue('CO-FZ')
  await expect(page.getByText('Sem logo')).toBeVisible()

  await page.getByLabel('Nome da OM').fill('CO-FZ Fortaleza')
  await page.getByLabel('Enviar logo…').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG })
  await expect(page.getByRole('img', { name: 'Pré-visualização do logo novo' })).toBeVisible()
  await page.getByRole('button', { name: 'Salvar organização' }).click()
  await expect(page.getByText('Organização salva.')).toBeVisible()
  const barra = page.getByRole('banner')
  await expect(barra.getByRole('img', { name: 'Logo da CO-FZ Fortaleza' })).toBeVisible()
  await expect(barra).toContainText('CO-FZ Fortaleza')
  await expect(page.getByRole('img', { name: 'Logo atual da OM' })).toBeVisible()

  // Arquivo fora do tipo é recusado no navegador.
  await page.getByLabel('Trocar logo…').setInputFiles({ name: 'logo.gif', mimeType: 'image/gif', buffer: PNG })
  await expect(page.getByRole('alert')).toHaveText('O logo precisa ser PNG, JPEG ou WebP.')

  await page.getByRole('button', { name: 'Remover logo' }).click()
  await page.getByRole('button', { name: 'Salvar organização' }).click()
  await expect(page.getByText('Organização salva.')).toBeVisible()
  await expect(page.getByText('Sem logo')).toBeVisible()
  await expect(barra.getByRole('img')).toHaveCount(0)
  expect(erros).toEqual([])
})
