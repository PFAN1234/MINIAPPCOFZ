import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type Locator, type Page } from '@playwright/test'

const URL_TELEGRAM_JS = 'https://telegram.org/js/telegram-web-app.js'
const FOTO_COM_GPS = fileURLToPath(new URL('./fixtures/com-gps.jpg', import.meta.url))
const LEGENDA = 'Quadro de distribuição sem identificação dos circuitos.'

/** Medidas da foto que o app enviou, lidas dentro do navegador. */
interface AnaliseFoto {
  tipo: string
  inicio: string
  temExif: boolean
  temApp1: boolean
  largura: number
  altura: number
}

test.beforeEach(async ({ page }) => {
  // Mesmo tratamento do navegacao.spec.ts: o script oficial do Telegram não entra no teste.
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

async function abrirNovoRegistro(page: Page) {
  await page.goto('/obras/hto/ambientes/terreo-apto-101')
  await expect(page.getByRole('heading', { name: 'Apto. 101', level: 2 })).toBeVisible()
  await page.getByRole('button', { name: 'Novo registro' }).click()
  await expect(page).toHaveURL(/\/obras\/hto\/ambientes\/terreo-apto-101\/novo$/)
  await expect(page.getByRole('heading', { name: 'Novo registro', level: 2 })).toBeVisible()
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

/** Lê a foto (blob) mostrada na miniatura do registro e mede os bytes e as dimensões dentro do navegador. */
async function analisarFotoDaMiniatura(miniatura: Locator): Promise<AnaliseFoto> {
  const src = await miniatura.getAttribute('src')
  if (!src) throw new Error('A miniatura não tem src')
  return miniatura.page().evaluate(async (url): Promise<AnaliseFoto> => {
    const blob = await (await fetch(url)).blob()
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const contem = (padrao: number[]) => {
      for (let i = 0; i + padrao.length <= bytes.length; i++) {
        if (padrao.every((b, j) => bytes[i + j] === b)) return true
      }
      return false
    }
    const bmp = await createImageBitmap(blob)
    const { width: largura, height: altura } = bmp
    bmp.close()
    const hex = (n: number) => n.toString(16).padStart(2, '0')
    return {
      tipo: blob.type,
      inicio: `${hex(bytes[0])}${hex(bytes[1])}`,
      temExif: contem([0x45, 0x78, 0x69, 0x66]), // "Exif"
      temApp1: contem([0xff, 0xe1]), // marcador APP1
      largura,
      altura,
    }
  }, src)
}

test('o arquivo de teste tem EXIF com GPS (pré-condição do teste de compressão)', () => {
  const bytes = readFileSync(FOTO_COM_GPS)
  expect(bytes.length).toBeLessThan(300 * 1024)
  expect(bytes.subarray(0, 2).toString('hex')).toBe('ffd8')
  expect(bytes.includes(Buffer.from('Exif', 'ascii'))).toBe(true)
  expect(bytes.includes(Buffer.from([0xff, 0xe1]))).toBe(true)
})

test('Novo registro: foto da Galeria, Pendência, legenda e Salvar volta ao Histórico com o registro', async ({
  page,
}) => {
  await abrirNovoRegistro(page)
  await anexarFoto(page)
  await escolherTipo(page, 'Pendência')
  await page.getByLabel('Legenda').fill(LEGENDA)
  await expect(botaoSalvar(page)).toBeEnabled()
  await botaoSalvar(page).click()

  // Volta ao Ambiente, na aba Histórico (sem `aba` na URL), com o aviso.
  await expect(page).toHaveURL(/\/obras\/hto\/ambientes\/terreo-apto-101$/)
  await expect(page.getByRole('status').filter({ hasText: 'Registro salvo no aparelho' })).toBeVisible()

  const item = page.locator('.registro-item', { hasText: LEGENDA })
  await expect(item).toBeVisible()
  await expect(item.locator('.registro-legenda')).toHaveText(LEGENDA)
  await expect(item.locator('.selo')).toHaveText('Pendência aberta')
  await expect(item.locator('.publicacao')).toHaveText('Salvo no servidor · aguardando publicação')

  // A miniatura é o blob que o app enviou (o repositório fixture o devolve por createObjectURL).
  const miniatura = item.locator('.miniatura-registro img')
  await expect(miniatura).toBeVisible()
  const analise = await analisarFotoDaMiniatura(miniatura)

  expect(analise.tipo).toBe('image/jpeg')
  expect(analise.inicio).toBe('ffd8')
  expect(analise.temExif, 'o blob enviado não pode conter "Exif" (inclusive GPS)').toBe(false)
  expect(analise.temApp1, 'o blob enviado não pode conter o marcador APP1 (FF E1)').toBe(false)
  // A foto de origem é 2400×1600; reduzida a 1920 de lado maior, mantém 3:2.
  expect(Math.max(analise.largura, analise.altura)).toBeLessThanOrEqual(1920)
  expect(analise.largura).toBeGreaterThan(analise.altura)
  expect(Math.abs(analise.largura - analise.altura * 1.5)).toBeLessThanOrEqual(1)
})

test('"Salvar registro" fica desabilitado sem foto', async ({ page }) => {
  await abrirNovoRegistro(page)
  await expect(botaoSalvar(page)).toBeDisabled()

  await escolherTipo(page, 'Pendência')
  await page.getByLabel('Legenda').fill('Legenda sem foto')
  await expect(botaoSalvar(page)).toBeDisabled()

  await anexarFoto(page)
  await expect(botaoSalvar(page)).toBeEnabled()
})

test('"Salvar registro" fica desabilitado sem tipo', async ({ page }) => {
  await abrirNovoRegistro(page)
  await anexarFoto(page)
  await page.getByLabel('Legenda').fill('Legenda sem tipo')
  await expect(botaoSalvar(page)).toBeDisabled()

  await escolherTipo(page, 'Serviço')
  await expect(botaoSalvar(page)).toBeEnabled()
})

test('"Salvar registro" fica desabilitado com legenda vazia ou só com espaços', async ({ page }) => {
  await abrirNovoRegistro(page)
  await anexarFoto(page)
  await escolherTipo(page, 'Pendência')
  await expect(botaoSalvar(page)).toBeDisabled()

  await page.getByLabel('Legenda').fill('   ')
  await expect(botaoSalvar(page)).toBeDisabled()

  await page.getByLabel('Legenda').fill('Ok')
  await expect(botaoSalvar(page)).toBeEnabled()
})

test('Voltar com formulário preenchido pede confirmação; cancelar permanece no formulário', async ({
  page,
}) => {
  await abrirNovoRegistro(page)
  await page.getByLabel('Legenda').fill('Texto que não pode sumir')

  const dialogos: string[] = []
  page.on('dialog', (d) => {
    dialogos.push(d.message())
    void d.dismiss()
  })

  await page.getByRole('button', { name: 'Voltar' }).click()
  await expect.poll(() => dialogos.length).toBe(1)
  expect(dialogos[0]).toBe('Descartar este registro?')
  await expect(page).toHaveURL(/\/obras\/hto\/ambientes\/terreo-apto-101\/novo$/)
  await expect(page.getByLabel('Legenda')).toHaveValue('Texto que não pode sumir')
})

test('Voltar com formulário preenchido e confirmação aceita sai para o Ambiente', async ({ page }) => {
  await abrirNovoRegistro(page)
  await page.getByLabel('Legenda').fill('Texto a descartar')

  const dialogos: string[] = []
  page.on('dialog', (d) => {
    dialogos.push(d.message())
    void d.accept()
  })

  await page.getByRole('button', { name: 'Voltar' }).click()
  await expect(page).toHaveURL(/\/obras\/hto\/ambientes\/terreo-apto-101$/)
  expect(dialogos).toEqual(['Descartar este registro?'])
})
