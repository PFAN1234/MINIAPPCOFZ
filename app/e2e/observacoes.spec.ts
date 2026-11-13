import { expect, test, type Locator, type Page } from '@playwright/test'

const URL_TELEGRAM_JS = 'https://telegram.org/js/telegram-web-app.js'

test.beforeEach(async ({ page }) => {
  await page.route(URL_TELEGRAM_JS, (rota) =>
    rota.fulfill({ status: 200, contentType: 'application/javascript', body: '' }),
  )
})

/** Abre a HTO e devolve o cartão "Observações do dia" com as duas observações da fixture. */
async function abrirCartao(page: Page): Promise<Locator> {
  await page.goto('/obras/hto')
  await expect(page.getByRole('heading', { name: 'HTO', level: 1 })).toBeVisible()
  const cartao = page.locator('section', {
    has: page.getByRole('heading', { name: 'Observações do dia', level: 3 }),
  })
  await expect(cartao.getByRole('listitem')).toHaveCount(2)
  await expect(cartao.getByText(/· CP PATRICIO$/)).toBeVisible()
  return cartao
}

async function escrever(cartao: Locator, texto: string) {
  await cartao.getByLabel('Adicionar observação').fill(texto)
  await cartao.getByRole('button', { name: 'Salvar', exact: true }).click()
}

test('adiciona uma observação com sinal: aparece com hora e autor e fica no servidor', async ({ page }) => {
  const cartao = await abrirCartao(page)
  const texto = `Chuva forte às 15h ${Date.now()}`
  await escrever(cartao, texto)

  const item = cartao.getByRole('listitem').filter({ hasText: texto })
  await expect(item).toHaveCount(1)
  await expect(item.getByText(/^\d{2}:\d{2} · Você \(teste\)$/)).toBeVisible()
  await expect(cartao.getByText(/aguardando envio/)).toHaveCount(0)
  await expect(cartao.getByLabel('Adicionar observação')).toHaveValue('')
  // A observação é minha: pode ser editada e excluída.
  await expect(item.getByRole('button', { name: /^Editar observação/ })).toBeEnabled()

  await page.reload()
  await expect(cartao.getByRole('listitem').filter({ hasText: texto })).toHaveCount(1)
  await expect(cartao.getByRole('listitem')).toHaveCount(3)
})

test('sem sinal: salva no aparelho como "aguardando envio" e envia ao voltar o sinal, sem duplicar', async ({
  page,
  context,
}) => {
  const cartao = await abrirCartao(page)
  const texto = `Sem sinal no canteiro ${Date.now()}`

  await context.setOffline(true)
  // Editar e excluir precisam de conexão.
  const minha = cartao.getByRole('listitem').filter({ hasText: 'Equipe de elétrica' })
  await expect(minha.getByRole('button', { name: /^Editar observação/ })).toBeDisabled()
  await expect(minha.getByText('Precisa de conexão')).toBeVisible()

  await escrever(cartao, texto)
  const item = cartao.getByRole('listitem').filter({ hasText: texto })
  await expect(item).toContainText('Salvo no aparelho · aguardando envio')
  await expect(page.getByRole('status').filter({ hasText: '1 item aguardando envio' })).toBeVisible()

  await context.setOffline(false)
  await expect(item).not.toContainText('aguardando envio', { timeout: 15_000 })
  await expect(page.getByText('1 item aguardando envio')).toHaveCount(0)
  await expect(cartao.getByRole('listitem').filter({ hasText: texto })).toHaveCount(1)
  await expect(item.getByRole('button', { name: /^Editar observação/ })).toBeEnabled()

  // Recarregado, continua uma só (o mesmo id em toda tentativa).
  await page.reload()
  await expect(cartao.getByRole('listitem')).toHaveCount(3)
  await expect(cartao.getByRole('listitem').filter({ hasText: texto })).toHaveCount(1)
})
