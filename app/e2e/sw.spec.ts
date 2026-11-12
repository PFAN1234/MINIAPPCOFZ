import { expect, test } from '@playwright/test'

// A config bloqueia service workers por padrão; este teste precisa dele ativo.
test.use({ serviceWorkers: 'allow' })

test('app abre offline pelo service worker, inclusive em rota profunda', async ({ page, context }) => {
  await page.goto('/')
  await page.evaluate(() => navigator.serviceWorker.ready)

  const manifesto = await page.evaluate(() =>
    fetch('/precache-manifest.json', { cache: 'no-store' }).then((r) => r.json() as Promise<{ versao: string; arquivos: string[] }>),
  )
  expect(manifesto.arquivos).toContain('/index.html')

  // Espera o precache completo no cache `app-<versao>`.
  await expect
    .poll(async () =>
      page.evaluate(async (m) => {
        const c = await caches.open(`app-${m.versao}`)
        const chaves = (await c.keys()).map((r) => new URL(r.url).pathname)
        return m.arquivos.every((a) => chaves.includes(a))
      }, manifesto),
    )
    .toBe(true)

  // Recarrega online para a página ficar controlada pelo SW.
  await page.reload()
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)

  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: /obras/i }).first()).toBeVisible()

  await page.goto('/obras/hto')
  await expect(page.locator('#root')).not.toBeEmpty()
  await expect(page.getByRole('heading').first()).toBeVisible()
  await context.setOffline(false)
})

test('o precache do Mini App traz as fontes do app (.woff2), sem a reserva .woff', async ({ request }) => {
  const resposta = await request.get('/precache-manifest.json')
  expect(resposta.ok()).toBe(true)
  const { arquivos } = (await resposta.json()) as { arquivos: string[] }

  for (const fonte of [
    'barlow-latin-400',
    'barlow-latin-500',
    'barlow-latin-600',
    'barlow-latin-700',
    'barlow-semi-condensed-latin-600',
    'barlow-semi-condensed-latin-700',
  ]) {
    expect(arquivos.filter((a) => a.startsWith(`/assets/${fonte}-normal-`) && a.endsWith('.woff2'))).toHaveLength(1)
  }
  expect(arquivos.filter((a) => a.endsWith('.woff'))).toEqual([])
  // Só os pesos usados: nada além das seis fontes.
  expect(arquivos.filter((a) => /\.(woff2?|ttf|otf)$/.test(a))).toHaveLength(6)
})
