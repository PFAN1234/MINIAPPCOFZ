import { fileURLToPath } from 'node:url'
import { expect, test, type Locator, type Page } from '@playwright/test'

// Os testes deste arquivo precisam do service worker ativo (o precache é o que permite abrir sem sinal).
test.use({ serviceWorkers: 'allow' })

const URL_TELEGRAM_JS = 'https://telegram.org/js/telegram-web-app.js'
const FOTO_COM_GPS = fileURLToPath(new URL('./fixtures/com-gps.jpg', import.meta.url))
const ROTA_AMBIENTE = '/obras/hto/ambientes/terreo-apto-101'
const ROTA_NOVO = `${ROTA_AMBIENTE}/novo`

test.beforeEach(async ({ page }) => {
  // Mesmo tratamento dos outros e2e: o script oficial do Telegram não entra no teste.
  await page.route(URL_TELEGRAM_JS, (rota) =>
    rota.fulfill({ status: 200, contentType: 'application/javascript', body: '' }),
  )
})

function galeria(page: Page): Locator {
  return page.locator('input[type="file"][aria-label="Escolher fotos da galeria"]')
}

function botaoSalvar(page: Page): Locator {
  return page.getByRole('button', { name: 'Salvar registro' })
}

function cabecalhoAmbiente(page: Page): Locator {
  return page.getByRole('heading', { name: 'Apto. 101', level: 1 })
}

/** Anexa a foto pela Galeria e espera a miniatura deixar de estar "preparando…". */
async function anexarFoto(page: Page) {
  await galeria(page).setInputFiles(FOTO_COM_GPS)
  await expect(page.getByRole('img', { name: 'Foto 1' })).toBeVisible()
  await expect(page.getByText('Preparando…')).toHaveCount(0)
}

async function escolherTipo(page: Page, tipo: 'Serviço' | 'Pendência') {
  // O input do rádio é invisível (opacity 0); o rótulo visível é o que recebe o toque.
  await page.getByText(tipo, { exact: true }).click()
  await expect(page.getByLabel(tipo, { exact: true })).toBeChecked()
}

/** Espera o precache completo no cache `app-<versao>`, como em sw.spec.ts. */
async function esperarPrecache(page: Page) {
  const manifesto = await page.evaluate(() =>
    fetch('/precache-manifest.json', { cache: 'no-store' }).then((r) => r.json() as Promise<{ versao: string; arquivos: string[] }>),
  )
  await expect
    .poll(async () =>
      page.evaluate(async (m) => {
        const c = await caches.open(`app-${m.versao}`)
        const chaves = (await c.keys()).map((r) => new URL(r.url).pathname)
        return m.arquivos.every((a) => chaves.includes(a))
      }, manifesto),
    )
    .toBe(true)
}

/** Espera o cache de consultas aparecer no IndexedDB (a gravação tem debounce de 1 s). */
async function esperarCacheNoAparelho(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<boolean>((resolve) => {
            try {
              const pedido = indexedDB.open('diario-obra')
              pedido.onerror = () => resolve(false)
              pedido.onsuccess = () => {
                const db = pedido.result
                try {
                  const contagem = db.transaction('cache').objectStore('cache').count()
                  contagem.onsuccess = () => {
                    db.close()
                    resolve(contagem.result > 0)
                  }
                  contagem.onerror = () => {
                    db.close()
                    resolve(false)
                  }
                } catch {
                  db.close()
                  resolve(false)
                }
              }
            } catch {
              resolve(false)
            }
          }),
      ),
    )
    .toBe(true)
}

/**
 * Deixa o app pronto para abrir sem sinal: service worker ativo, precache completo,
 * página controlada pelo SW e cache de consultas gravado no aparelho.
 */
async function prepararAparelhoParaOffline(page: Page) {
  await page.goto(ROTA_AMBIENTE)
  await expect(cabecalhoAmbiente(page)).toBeVisible()
  await page.evaluate(() => navigator.serviceWorker.ready)
  await esperarPrecache(page)

  // Recarrega uma vez online para a página ficar controlada pelo SW.
  await page.reload()
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
  await expect(cabecalhoAmbiente(page)).toBeVisible()
  await esperarCacheNoAparelho(page)
}

/** Sem sinal, a faixa (região `status`, com o botão "Enviar") mostra o aviso de envio pendente. */
function avisoAguardandoEnvio(page: Page, quantidade: string): Locator {
  return page.getByRole('status').filter({ hasText: new RegExp(`^${quantidade} registros? aguardando envio`) })
}

test('fluxo completo: salva sem sinal, sobrevive a recarga offline e envia ao voltar o sinal', async ({
  page,
  context,
}) => {
  const legenda = `Quadro sem sinal ${Date.now()}`

  await prepararAparelhoParaOffline(page)
  await context.setOffline(true)

  // Novo registro sem sinal: a navegação é pelo app, já que o Ambiente está em memória.
  await page.getByRole('button', { name: 'Novo registro' }).click()
  await expect(page).toHaveURL(new RegExp(`${ROTA_NOVO}$`))
  await expect(page.getByRole('heading', { name: 'Novo registro', level: 1 })).toBeVisible()
  await anexarFoto(page)
  await escolherTipo(page, 'Pendência')
  await page.getByLabel('Legenda').fill(legenda)
  await expect(botaoSalvar(page)).toBeEnabled()
  await botaoSalvar(page).click()

  // Volta ao Histórico com o aviso e o item local, ainda sem envio.
  await expect(page).toHaveURL(new RegExp(`${ROTA_AMBIENTE}$`))
  await expect(page.getByRole('status').filter({ hasText: 'Registro salvo no aparelho' })).toBeVisible()

  const item = page.locator('.registro-item', { hasText: legenda })
  await expect(item).toBeVisible()
  await expect(item.locator('.publicacao')).toHaveText('Salvo no aparelho · aguardando envio')
  await expect(avisoAguardandoEnvio(page, '1')).toBeVisible()
  // "Enviar" na faixa: alvo de toque de pelo menos 44 px.
  const enviar = (await avisoAguardandoEnvio(page, '1').getByRole('button', { name: 'Enviar' }).boundingBox())!
  expect(enviar.height).toBeGreaterThanOrEqual(44)
  expect(enviar.width).toBeGreaterThanOrEqual(44)

  // Recarrega offline: o app abre pelo service worker e o registro continua no aparelho.
  await page.reload()
  await expect(cabecalhoAmbiente(page)).toBeVisible()
  const itemRecarregado = page.locator('.registro-item', { hasText: legenda })
  await expect(itemRecarregado).toBeVisible()
  await expect(itemRecarregado.locator('.publicacao')).toHaveText('Salvo no aparelho · aguardando envio')
  await expect(avisoAguardandoEnvio(page, '1')).toBeVisible()

  // Volta o sinal: o evento online dispara o envio; o item passa ao servidor e a barra some.
  await context.setOffline(false)
  await expect(itemRecarregado.locator('.publicacao')).toHaveText('Salvo no servidor · aguardando publicação', {
    timeout: 15_000,
  })
  await expect(page.getByText('aguardando envio', { exact: false })).toHaveCount(0)
  await expect(avisoAguardandoEnvio(page, '1')).toHaveCount(0)

  // Recarrega logo em seguida: o cache restaurado pode ser anterior ao envio, mas é
  // refeito ao montar; a legenda aparece uma única vez (sem duplicar o local e o servidor).
  await page.reload()
  await expect(cabecalhoAmbiente(page)).toBeVisible()
  await expect(page.locator('.registro-item', { hasText: legenda })).toHaveCount(1)
})

test('sem sinal, as fontes do app (Barlow) carregam do service worker', async ({ page, context }) => {
  await prepararAparelhoParaOffline(page)

  // As seis fontes (.woff2) estão no cache do app (precache, ver também sw.spec.ts).
  const fontesNoCache = await page.evaluate(async () => {
    const nome = (await caches.keys()).filter((n) => n.startsWith('app-')).pop()!
    const chaves = (await (await caches.open(nome)).keys()).map((r) => new URL(r.url).pathname)
    return new Set(chaves.filter((c) => c.endsWith('.woff2'))).size
  })
  expect(fontesNoCache).toBe(6)

  await context.setOffline(true)
  const fontesPelaRede: string[] = []
  page.on('response', (r) => {
    if (/\.woff2?$/.test(new URL(r.url()).pathname) && !r.fromServiceWorker()) fontesPelaRede.push(r.url())
  })
  await page.reload()
  await expect(cabecalhoAmbiente(page)).toBeVisible()

  const fontes = await page.evaluate(async () => {
    await document.fonts.ready
    return {
      texto: document.fonts.check('16px Barlow'),
      titulo: document.fonts.check('700 16px "Barlow Semi Condensed"'),
      carregadas: [...document.fonts]
        .filter((f) => f.status === 'loaded')
        .map((f) => `${f.family.replace(/["']/g, '')} ${f.weight}`),
    }
  })
  expect(fontes.texto).toBe(true)
  expect(fontes.titulo).toBe(true)
  // check() também dá true quando a fonte nem existe: confere que as faces foram mesmo carregadas.
  expect(fontes.carregadas).toContain('Barlow 400')
  expect(fontes.carregadas).toContain('Barlow Semi Condensed 700')
  expect(fontesPelaRede).toEqual([])
  await context.setOffline(false)
})

test('cota de armazenamento: alerta "Sem espaço no aparelho" e o formulário continua preenchido', async ({
  page,
}) => {
  const legenda = `Legenda sem cota ${Date.now()}`

  // Simula um aparelho com 100 bytes livres (quota 1000, uso 900).
  await page.addInitScript(() => {
    if (!navigator.storage) return
    Object.defineProperty(navigator.storage, 'estimate', {
      configurable: true,
      value: async () => ({ quota: 1000, usage: 900 }),
    })
  })

  await page.goto(ROTA_NOVO)
  await expect(page.getByRole('heading', { name: 'Novo registro', level: 1 })).toBeVisible()
  await anexarFoto(page)
  await escolherTipo(page, 'Pendência')
  await page.getByLabel('Legenda').fill(legenda)
  await expect(botaoSalvar(page)).toBeEnabled()
  await botaoSalvar(page).click()

  const alerta = page.getByRole('alert')
  await expect(alerta).toContainText('Sem espaço no aparelho')
  await expect(page.getByRole('heading', { name: 'Novo registro', level: 1 })).toBeVisible()
  await expect(page.getByLabel('Legenda')).toHaveValue(legenda)
  await expect(page).toHaveURL(new RegExp(`${ROTA_NOVO}$`))
})
