import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

// Editor de planta do site de administração (fixture): o PDF real da COFZ, processado pelo
// pdf.js no navegador, e a publicação no repositório em memória.
test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false })

const PDF_COFZ = fileURLToPath(new URL('../../DOCS COFZ/PDF/CE01-01PE02-ARQ-DE009-R06.pdf', import.meta.url))

test('envia o PDF da COFZ, confere os ambientes, arrasta e acrescenta pinos e publica', async ({ page }) => {
  test.setTimeout(240_000)
  const erros: string[] = []
  page.on('pageerror', (e) => erros.push(e.message))

  await page.goto('/admin/obras/cofz')
  await page.getByRole('link', { name: 'Planta de Térreo' }).click()
  await expect(page.getByRole('heading', { name: 'Planta · COFZ · Térreo' })).toBeVisible()

  // 1. Arquivo: o pdf.js (worker local) lê o PDF; a revisão vem do nome do arquivo.
  await page.getByLabel(/PDF da planta de arquitetura/).setInputFiles(PDF_COFZ)
  await expect(page.getByText(/1 página\(s\)/)).toBeVisible({ timeout: 60_000 })
  await expect(page.getByLabel(/^Revisão/)).toHaveValue('R06')
  await page.getByRole('button', { name: 'Ler a página' }).click()

  // 2. Recorte e máscaras (os da configuração da obra), sobre a página desenhada.
  await expect(page.getByRole('heading', { name: 'Recorte e máscaras' })).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole('img', { name: 'Página 1 do PDF' })).toBeVisible({ timeout: 60_000 })
  await expect(page.getByLabel('Recorte do edifício x1')).toHaveValue('0.89')
  await expect(page.getByLabel('Máscara 1 x0')).toHaveValue('0.815')
  await page.getByRole('button', { name: 'Continuar' }).click()

  // 3. Ambientes: os 19 da COFZ (17 rótulos + 2 manuais) e a planta recortada.
  await expect(page.getByRole('heading', { name: 'Ambientes' })).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('tr[data-testid^="linha-terreo-"]')).toHaveCount(19)
  await expect(page.getByLabel('Nome operacional de Circulação 1')).toBeVisible()
  await expect(page.getByText('3 caso(s) para conferir')).toBeVisible()
  await expect(page.getByRole('img', { name: 'Planta recortada' })).toBeVisible({ timeout: 60_000 })

  // Arrasta o pino da copa 40 px para a direita.
  const pino = page.getByTestId('pino-terreo-copa-0')
  const caixa = (await pino.boundingBox())!
  await page.mouse.move(caixa.x + caixa.width / 2, caixa.y + caixa.height / 2)
  await page.mouse.down()
  await page.mouse.move(caixa.x + caixa.width / 2 + 20, caixa.y + caixa.height / 2, { steps: 4 })
  await page.mouse.move(caixa.x + caixa.width / 2 + 40, caixa.y + caixa.height / 2, { steps: 4 })
  await page.mouse.up()
  const linhaCopa = page.getByTestId('linha-terreo-copa')
  await expect(linhaCopa.getByRole('button', { name: 'Voltar pinos ao rótulo' })).toBeVisible()
  const depois = (await pino.boundingBox())!
  expect(depois.x - caixa.x).toBeGreaterThan(30)

  // Acrescenta um pino à Sala DA clicando 60 px à direita do pino dela: a ponta fica no clique.
  const pinoDa = (await page.getByTestId('pino-terreo-sala-da-0').boundingBox())!
  await page.getByTestId('linha-terreo-sala-da').getByRole('button', { name: 'Adicionar pino' }).click()
  await expect(page.getByText(/Clique na planta onde fica o novo pino de/)).toBeVisible()
  const alvo = { x: pinoDa.x + pinoDa.width / 2 + 60, y: pinoDa.y + pinoDa.height }
  await page.mouse.click(alvo.x, alvo.y)
  const novoPino = (await page.getByTestId('pino-terreo-sala-da-1').boundingBox())!
  expect(Math.abs(novoPino.x + novoPino.width / 2 - alvo.x)).toBeLessThan(3)
  expect(Math.abs(novoPino.y + novoPino.height - alvo.y)).toBeLessThan(3)
  await expect(page.getByTestId('linha-terreo-sala-da').getByRole('button', { name: 'Remover pino 2' })).toBeVisible()
  await page.getByRole('button', { name: 'Continuar' }).click()

  // 4. Nova revisão: comparada com o banco, só o pino da copa mudou.
  await expect(page.getByRole('heading', { name: 'Nova revisão' })).toBeVisible()
  await expect(page.getByRole('heading', { name: /Pino deslocado/ })).toBeVisible()
  await expect(page.getByText(/^Copa: 0,0/)).toBeVisible()
  await expect(page.getByRole('heading', { name: /Removidos/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Continuar' }).click()

  // 5. Prova e publicar.
  await expect(page.getByRole('img', { name: /Prova/ })).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: 'Publicar', exact: true }).click()
  await expect(page.getByText('Publicado: Térreo, revisão R06, 19 ambiente(s).')).toBeVisible({ timeout: 180_000 })
  await page.getByRole('button', { name: 'Marcar como revisado' }).click()
  await expect(page.getByText('Marcada como revisada.')).toBeVisible()

  // Histórico na página da obra e o PDF guardado para reabrir.
  await page.getByRole('link', { name: 'Voltar para a obra' }).click()
  const historico = page.getByRole('region', { name: 'Publicações da planta' })
  await expect(historico.getByRole('row', { name: /Térreo R06/ })).toContainText('CE01-01PE02-ARQ-DE009-R06.pdf')
  await expect(page.getByLabel('Status da revisão humana')).toHaveValue('revisado')
  await page.getByRole('link', { name: 'Planta de Térreo' }).click()
  await page.getByRole('button', { name: /Reabrir o PDF guardado/ }).click()
  await expect(page.getByText(/1 página\(s\)/)).toBeVisible({ timeout: 60_000 })

  // Atalho da lista de pavimentos: direto nos ambientes, com o pino a mais da Sala DA.
  await page.getByRole('link', { name: 'Pavimentos' }).click()
  await page.getByRole('link', { name: 'Ajustar ambientes e pinos de Térreo' }).click()
  await expect(page.getByRole('heading', { name: 'Ambientes' })).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId('pino-terreo-sala-da-1')).toBeVisible({ timeout: 60_000 })
  expect(erros).toEqual([])
})
